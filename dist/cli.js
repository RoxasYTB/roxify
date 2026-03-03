#!/usr/bin/env node
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, } from 'fs';
import { open } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import { DataFormatError, decodePngToBinary, encodeBinaryToPng, hasPassphraseInPng, IncorrectPassphraseError, listFilesInPng, PassphraseRequiredError, } from './index.js';
import { packPathsGenerator, unpackBuffer } from './pack.js';
import * as cliProgress from './stub-progress.js';
import { encodeWithRustCLI, isRustBinaryAvailable, } from './utils/rust-cli-wrapper.js';
const VERSION = '1.6.1';
function getDirectorySize(dirPath) {
    let totalSize = 0;
    try {
        const entries = readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = join(dirPath, entry.name);
            if (entry.isDirectory()) {
                totalSize += getDirectorySize(fullPath);
            }
            else if (entry.isFile()) {
                try {
                    totalSize += statSync(fullPath).size;
                }
                catch (e) { }
            }
        }
    }
    catch (e) { }
    return totalSize;
}
async function readLargeFile(filePath) {
    const st = statSync(filePath);
    if (st.size <= 2 * 1024 * 1024 * 1024) {
        return readFileSync(filePath);
    }
    const chunkSize = 64 * 1024 * 1024;
    const chunks = [];
    let position = 0;
    const fd = await open(filePath, 'r');
    try {
        while (position < st.size) {
            const currentChunkSize = Math.min(chunkSize, st.size - position);
            const buffer = Buffer.alloc(currentChunkSize);
            const { bytesRead } = await fd.read(buffer, 0, currentChunkSize, position);
            chunks.push(buffer.slice(0, bytesRead));
            position += bytesRead;
        }
    }
    finally {
        await fd.close();
    }
    return Buffer.concat(chunks);
}
function showHelp() {
    console.log(`
ROX CLI — Encode/decode binary in PNG or WAV

Usage:
  npx rox <command> [options]

Commands:
  encode <input>... [output]   Encode one or more files/directories
  decode <input> [output]      Decode PNG/WAV to original file
  list <input>                 List files in a Rox archive
  havepassphrase <input>       Check whether the archive requires a passphrase

Options:
  --image                   Use PNG container (default)
  --sound                   Use WAV audio container (smaller overhead, faster)
  -p, --passphrase <pass>   Use passphrase (AES-256-GCM)
  -m, --mode <mode>         Mode: screenshot (default)
  -e, --encrypt <type>      auto|aes|xor|none
  --no-compress             Disable compression
  --dict <file>             Use zstd dictionary when compressing
  --force-ts                Force TypeScript encoder (slower but supports encryption)
  -o, --output <path>       Output file path
  -s, --sizes               Show file sizes in 'list' output (default)
  --no-sizes                Disable file size reporting in 'list'
  --files <list>            Extract only specified files (comma-separated)
  --view-reconst            Export the reconstituted PNG for debugging
  --debug                   Export debug images (doubled.png, reconstructed.png)
  -v, --verbose             Show detailed errors

Lossy-Resilient Encoding:
  --lossy-resilient         Enable lossy-resilient mode (survives JPEG/MP3)
  --ecc-level <level>       ECC redundancy: low|medium|quartile|high (default: medium)
  --block-size <n>          Robust image block size: 2-8 pixels (default: 4)

  When --lossy-resilient is active, data is encoded with Reed-Solomon ECC
  and rendered as a QR-code-style grid (image) or MFSK tones (audio).
  Use --sound or --image to choose the container format.

Examples:
  npx rox encode secret.pdf                      Encode to PNG
  npx rox encode secret.pdf --sound               Encode to WAV
  npx rox encode secret.pdf --lossy-resilient     Lossy-resilient PNG
  npx rox encode secret.pdf --lossy-resilient --sound --ecc-level high
  npx rox decode secret.pdf.png                   Decode back
  npx rox decode secret.pdf.wav                   Decode WAV back

Run "npx rox help" for this message.
`);
}
function parseArgs(args) {
    const parsed = { _: [] };
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.startsWith('--')) {
            const key = arg.slice(2);
            if (key === 'no-compress') {
                parsed.noCompress = true;
                i++;
            }
            else if (key === 'verbose') {
                parsed.verbose = true;
                i++;
            }
            else if (key === 'view-reconst') {
                parsed.viewReconst = true;
                i++;
            }
            else if (key === 'sizes') {
                parsed.sizes = true;
                i++;
            }
            else if (key === 'no-sizes') {
                parsed.sizes = false;
                i++;
            }
            else if (key === 'debug') {
                parsed.debug = true;
                i++;
            }
            else if (key === 'force-ts') {
                parsed.forceTs = true;
                i++;
            }
            else if (key === 'lossy-resilient') {
                parsed.lossyResilient = true;
                i++;
            }
            else if (key === 'ecc-level') {
                const lvl = args[i + 1];
                if (!['low', 'medium', 'quartile', 'high'].includes(lvl)) {
                    console.error(`Invalid --ecc-level: ${lvl}. Must be low|medium|quartile|high`);
                    process.exit(1);
                }
                parsed.eccLevel = lvl;
                i += 2;
            }
            else if (key === 'block-size') {
                const bs = parseInt(args[i + 1], 10);
                if (isNaN(bs) || bs < 2 || bs > 8) {
                    console.error(`Invalid --block-size: ${args[i + 1]}. Must be 2-8`);
                    process.exit(1);
                }
                parsed.blockSize = bs;
                i += 2;
            }
            else if (key === 'sound') {
                parsed.container = 'sound';
                i++;
            }
            else if (key === 'image') {
                parsed.container = 'image';
                i++;
            }
            else if (key === 'debug-dir') {
                parsed.debugDir = args[i + 1];
                i += 2;
            }
            else if (key === 'files') {
                parsed.files = args[i + 1].split(',');
                i += 2;
            }
            else if (key === 'dict') {
                parsed.dict = args[i + 1];
                i += 2;
            }
            else {
                const value = args[i + 1];
                parsed[key] = value;
                i += 2;
            }
        }
        else if (arg.startsWith('-')) {
            const flag = arg.slice(1);
            const value = args[i + 1];
            switch (flag) {
                case 'p':
                    parsed.passphrase = value;
                    i += 2;
                    break;
                case 'm':
                    i += 2;
                    break;
                case 'e':
                    parsed.encrypt = value;
                    i += 2;
                    break;
                case 'o':
                    parsed.output = value;
                    i += 2;
                    break;
                case 'v':
                    parsed.verbose = true;
                    i += 1;
                    break;
                case 's':
                    parsed.sizes = true;
                    i += 1;
                    break;
                    break;
                case 'd':
                    parsed.debugDir = value;
                    i += 2;
                    break;
                default:
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
            }
        }
        else {
            parsed._.push(arg);
            i++;
        }
    }
    return parsed;
}
async function encodeCommand(args) {
    const parsed = parseArgs(args);
    const inputPaths = parsed.output ? parsed._
        : parsed._.length > 1 ? parsed._.slice(0, -1)
            : parsed._;
    const outputPath = parsed.output ? undefined
        : parsed._.length > 1 ? parsed._[parsed._.length - 1]
            : undefined;
    const firstInput = inputPaths[0];
    if (!firstInput) {
        console.log(' ');
        console.error('Error: Input file required');
        console.log('Usage: npx rox encode <input> [output] [options]');
        process.exit(1);
    }
    let safeCwd = '/';
    try {
        safeCwd = process.cwd();
    }
    catch (e) {
        safeCwd = '/';
    }
    const resolvedInputs = inputPaths.map((p) => resolve(safeCwd, p));
    const containerMode = parsed.container || 'image'; // default: image (PNG)
    const containerExt = containerMode === 'sound' ? '.wav' : '.png';
    let outputName = inputPaths.length === 1 ? basename(firstInput) : 'archive';
    if (inputPaths.length === 1 && !statSync(resolvedInputs[0]).isDirectory()) {
        outputName = outputName.replace(/(\.[^.]+)?$/, containerExt);
    }
    else {
        outputName += containerExt;
    }
    let resolvedOutput;
    try {
        resolvedOutput = resolve(safeCwd, parsed.output || outputPath || outputName);
    }
    catch (e) {
        resolvedOutput = join('/', parsed.output || outputPath || outputName);
    }
    try {
        const anyDir = inputPaths.some((p) => {
            try {
                return statSync(resolve(safeCwd, p)).isDirectory();
            }
            catch (e) {
                return false;
            }
        });
        if (anyDir) {
            const { index } = await packPathsGenerator(inputPaths, undefined, () => { });
            if (!index || index.length === 0) {
                console.log(' ');
                console.error('Error: No files found in specified input paths.');
                process.exit(1);
            }
        }
    }
    catch (e) { }
    let anyInputDir = false;
    try {
        anyInputDir = resolvedInputs.some((p) => statSync(p).isDirectory());
    }
    catch (e) {
        anyInputDir = false;
    }
    if (isRustBinaryAvailable() && !parsed.forceTs && containerMode !== 'sound') {
        try {
            console.log(`Encoding to ${resolvedOutput} (Using native Rust encoder)\n`);
            const startTime = Date.now();
            const encodeBar = new cliProgress.SingleBar({ format: ' {bar} {percentage}% | {step} | {elapsed}s' }, cliProgress.Presets.shades_classic);
            let barValue = 0;
            encodeBar.start(100, 0, { step: 'Encoding', elapsed: '0' });
            const progressInterval = setInterval(() => {
                barValue = Math.min(barValue + 1, 99);
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                encodeBar.update(barValue, {
                    step: 'Encoding',
                    elapsed: String(elapsed),
                });
            }, 500);
            const encryptType = parsed.encrypt === 'xor' ? 'xor' : 'aes';
            const fileName = basename(inputPaths[0]);
            await encodeWithRustCLI(inputPaths.length === 1 ? resolvedInputs[0] : resolvedInputs[0], resolvedOutput, 19, parsed.passphrase, encryptType, fileName);
            clearInterval(progressInterval);
            const encodeTime = Date.now() - startTime;
            encodeBar.update(100, {
                step: 'done',
                elapsed: String(Math.floor(encodeTime / 1000)),
            });
            encodeBar.stop();
            const { statSync: fstatSync } = await import('fs');
            let inputSize = 0;
            if (inputPaths.length === 1 &&
                fstatSync(resolvedInputs[0]).isDirectory()) {
                inputSize = getDirectorySize(resolvedInputs[0]);
            }
            else {
                inputSize = fstatSync(resolvedInputs[0]).size;
            }
            const outputSize = fstatSync(resolvedOutput).size;
            const ratio = ((outputSize / inputSize) * 100).toFixed(1);
            console.log(`\nSuccess!`);
            console.log(`  Input:  ${(inputSize / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Output: ${(outputSize / 1024 / 1024).toFixed(2)} MB (${ratio}% of original)`);
            console.log(`  Time:   ${encodeTime}ms`);
            console.log(`  Saved:  ${resolvedOutput}`);
            console.log(' ');
            return;
        }
        catch (err) {
            console.warn('\nRust encoder failed, falling back to TypeScript encoder...');
            console.warn(`Reason: ${err.message}\n`);
        }
    }
    let options = {};
    if (parsed.dict) {
        try {
            options.dict = readFileSync(parsed.dict);
        }
        catch (e) {
            console.error(`failed to read dictionary file: ${parsed.dict}`);
            process.exit(1);
        }
    }
    try {
        const encodeBar = new cliProgress.SingleBar({
            format: ' {bar} {percentage}% | {step} | {elapsed}s',
        }, cliProgress.Presets.shades_classic);
        let barStarted = false;
        const startEncode = Date.now();
        let currentEncodeStep = 'Starting';
        let displayedPct = 0;
        let targetPct = 0;
        const TICK_MS = 100;
        const PCT_STEP = 1;
        const encodeHeartbeat = setInterval(() => {
            const elapsed = Date.now() - startEncode;
            if (!barStarted) {
                encodeBar.start(100, Math.floor(displayedPct), {
                    step: currentEncodeStep,
                    elapsed: '0',
                });
                barStarted = true;
            }
            if (displayedPct < targetPct) {
                displayedPct = Math.min(displayedPct + PCT_STEP, targetPct);
            }
            else if (displayedPct < 99) {
                displayedPct = Math.min(displayedPct + PCT_STEP, 99);
            }
            encodeBar.update(Math.floor(displayedPct), {
                step: currentEncodeStep,
                elapsed: String(Math.floor(elapsed / 1000)),
            });
        }, TICK_MS);
        const mode = 'screenshot';
        Object.assign(options, {
            mode,
            name: parsed.outputName || 'archive',
            skipOptimization: false,
            compressionLevel: 19,
            outputFormat: 'auto',
            container: containerMode,
        });
        if (parsed.verbose)
            options.verbose = true;
        if (parsed.noCompress)
            options.compression = 'none';
        if (parsed.passphrase) {
            options.passphrase = parsed.passphrase;
            options.encrypt = parsed.encrypt || 'aes';
        }
        if (parsed.lossyResilient) {
            options.lossyResilient = true;
            if (parsed.eccLevel)
                options.eccLevel = parsed.eccLevel;
            if (parsed.blockSize)
                options.robustBlockSize = parsed.blockSize;
        }
        console.log(`Encoding to ${resolvedOutput} (Mode: ${mode}, Container: ${containerMode === 'sound' ? 'WAV' : 'PNG'})\n`);
        let inputData;
        let inputSizeVal = 0;
        let displayName;
        let totalBytes = 0;
        const onProgress = (readBytes, total, currentFile) => {
            if (totalBytes === 0)
                totalBytes = total;
            const packPct = Math.floor((readBytes / totalBytes) * 25);
            targetPct = Math.max(targetPct, packPct);
            currentEncodeStep =
                currentFile ? `Reading files: ${currentFile}` : 'Reading files';
        };
        if (inputPaths.length > 1) {
            currentEncodeStep = 'Reading files';
            const { index, stream, totalSize } = await packPathsGenerator(inputPaths, undefined, onProgress);
            if (!index || index.length === 0) {
                console.log(' ');
                console.error('Error: No files found in specified input paths.');
                process.exit(1);
            }
            inputData = stream;
            inputSizeVal = totalSize;
            displayName = parsed.outputName || 'archive';
            options.includeFileList = true;
            options.fileList = index.map((e) => ({
                name: e.path,
                size: e.size,
            }));
        }
        else {
            const resolvedInput = resolvedInputs[0];
            const st = statSync(resolvedInput);
            if (st.isDirectory()) {
                currentEncodeStep = 'Reading files';
                const { index, stream, totalSize } = await packPathsGenerator([resolvedInput], dirname(resolvedInput), onProgress);
                if (!index || index.length === 0) {
                    console.log(' ');
                    console.error(`Error: No files found in ${resolvedInput}`);
                    process.exit(1);
                }
                inputData = stream;
                inputSizeVal = totalSize;
                displayName = parsed.outputName || basename(resolvedInput);
                options.includeFileList = true;
                options.fileList = index.map((e) => ({
                    name: e.path,
                    size: e.size,
                }));
            }
            else {
                inputData = await readLargeFile(resolvedInput);
                inputSizeVal = inputData.length;
                displayName = basename(resolvedInput);
                options.includeFileList = true;
                options.fileList = [{ name: basename(resolvedInput), size: st.size }];
            }
        }
        options.name = displayName;
        options.onProgress = (info) => {
            let stepLabel = 'Processing';
            let pct = 0;
            if (info.phase === 'compress_start') {
                pct = 25;
                stepLabel = 'Compressing';
            }
            else if (info.phase === 'compress_progress') {
                pct = 25 + Math.floor((info.loaded / info.total) * 50);
                stepLabel = 'Compressing';
            }
            else if (info.phase === 'compress_done') {
                pct = 75;
                stepLabel = 'Compressed';
            }
            else if (info.phase === 'encrypt_start') {
                pct = 76;
                stepLabel = 'Encrypting';
            }
            else if (info.phase === 'encrypt_done') {
                pct = 80;
                stepLabel = 'Encrypted';
            }
            else if (info.phase === 'meta_prep_done') {
                pct = 82;
                stepLabel = 'Preparing';
            }
            else if (info.phase === 'png_gen') {
                if (info.loaded !== undefined && info.total !== undefined) {
                    pct = 82 + Math.floor((info.loaded / info.total) * 16);
                }
                else {
                    pct = 98;
                }
                stepLabel = 'Generating PNG';
            }
            else if (info.phase === 'optimizing') {
                if (info.loaded !== undefined && info.total !== undefined) {
                    pct = 82 + Math.floor((info.loaded / info.total) * 18);
                }
                else {
                    pct = 98;
                }
                stepLabel = 'Optimizing PNG';
            }
            else if (info.phase === 'done') {
                pct = 100;
                stepLabel = 'Done';
            }
            targetPct = Math.max(targetPct, pct);
            currentEncodeStep = stepLabel;
        };
        let inputBuffer;
        if (typeof inputData[Symbol.asyncIterator] === 'function') {
            const chunks = [];
            for await (const chunk of inputData) {
                chunks.push(chunk);
            }
            inputBuffer = chunks;
        }
        else {
            inputBuffer = inputData;
        }
        const output = await encodeBinaryToPng(inputBuffer, options);
        const encodeTime = Date.now() - startEncode;
        clearInterval(encodeHeartbeat);
        if (barStarted) {
            encodeBar.update(100, {
                step: 'done',
                elapsed: String(Math.floor(encodeTime / 1000)),
            });
            encodeBar.stop();
        }
        writeFileSync(resolvedOutput, output);
        const outputSize = (output.length / 1024 / 1024).toFixed(2);
        const inputSize = (inputSizeVal / 1024 / 1024).toFixed(2);
        const ratio = ((output.length / inputSizeVal) * 100).toFixed(1);
        console.log(`\nSuccess!`);
        console.log(`  Input:  ${inputSize} MB`);
        console.log(`  Output: ${outputSize} MB (${ratio}% of original)`);
        console.log(`  Time:   ${encodeTime}ms`);
        console.log(`  Saved:  ${resolvedOutput}`);
        console.log(' ');
    }
    catch (err) {
        console.log(' ');
        console.error('Error: Failed to encode file. Use --verbose for details.');
        if (parsed.verbose)
            console.error('Details:', err.stack || err.message);
        process.exit(1);
    }
}
async function decodeCommand(args) {
    const parsed = parseArgs(args);
    const [inputPath, outputPath] = parsed._;
    if (!inputPath) {
        console.log(' ');
        console.error('Error: Input PNG file required');
        console.log('Usage: npx rox decode <input> [output] [options]');
        process.exit(1);
    }
    const resolvedInput = resolve(inputPath);
    const resolvedOutput = parsed.output || outputPath || 'decoded.bin';
    try {
        const options = {};
        if (parsed.passphrase) {
            options.passphrase = parsed.passphrase;
        }
        if (parsed.debug) {
            options.debugDir = dirname(resolvedInput);
        }
        if (parsed.files) {
            options.files = parsed.files;
        }
        if (parsed.dict) {
            try {
                options.dict = readFileSync(parsed.dict);
            }
            catch (e) {
                console.error(`Failed to read dictionary file: ${parsed.dict}`);
                process.exit(1);
            }
        }
        console.log(' ');
        console.log(`Decoding...`);
        console.log(' ');
        const decodeBar = new cliProgress.SingleBar({
            format: ' {bar} {percentage}% | {step} | {elapsed}s',
        }, cliProgress.Presets.shades_classic);
        let barStarted = false;
        const startDecode = Date.now();
        let currentPct = 0;
        let targetPct = 0;
        let currentStep = 'Decoding';
        const heartbeat = setInterval(() => {
            if (currentPct < targetPct) {
                currentPct = Math.min(currentPct + 2, targetPct);
            }
            if (!barStarted && targetPct > 0) {
                decodeBar.start(100, Math.floor(currentPct), {
                    step: currentStep,
                    elapsed: String(Math.floor((Date.now() - startDecode) / 1000)),
                });
                barStarted = true;
            }
            else if (barStarted) {
                decodeBar.update(Math.floor(currentPct), {
                    step: currentStep,
                    elapsed: String(Math.floor((Date.now() - startDecode) / 1000)),
                });
            }
        }, 100);
        options.onProgress = (info) => {
            if (info.phase === 'decompress_start') {
                targetPct = 50;
                currentStep = 'Decompressing';
            }
            else if (info.phase === 'decompress_progress' &&
                info.loaded &&
                info.total) {
                targetPct = 50 + Math.floor((info.loaded / info.total) * 40);
                currentStep = `Decompressing (${info.loaded}/${info.total})`;
            }
            else if (info.phase === 'decompress_done') {
                targetPct = 90;
                currentStep = 'Decompressed';
            }
            else if (info.phase === 'done') {
                targetPct = 100;
                currentStep = 'Done';
            }
        };
        const inputBuffer = await readLargeFile(resolvedInput);
        const result = await decodePngToBinary(inputBuffer, options);
        const decodeTime = Date.now() - startDecode;
        clearInterval(heartbeat);
        if (barStarted) {
            currentPct = 100;
            decodeBar.update(100, {
                step: 'done',
                elapsed: String(Math.floor(decodeTime / 1000)),
            });
            decodeBar.stop();
        }
        if (result.files) {
            const baseDir = parsed.output || outputPath || '.';
            const totalBytes = result.files.reduce((s, f) => s + f.buf.length, 0);
            const extractBar = new cliProgress.SingleBar({ format: ' {bar} {percentage}% | {step} | {elapsed}s' }, cliProgress.Presets.shades_classic);
            const extractStart = Date.now();
            extractBar.start(totalBytes, 0, { step: 'Writing files', elapsed: '0' });
            let written = 0;
            for (const file of result.files) {
                const fullPath = join(baseDir, file.path);
                const dir = dirname(fullPath);
                mkdirSync(dir, { recursive: true });
                writeFileSync(fullPath, file.buf);
                written += file.buf.length;
                extractBar.update(written, {
                    step: `Writing ${file.path}`,
                    elapsed: String(Math.floor((Date.now() - extractStart) / 1000)),
                });
            }
            extractBar.update(totalBytes, {
                step: 'Done',
                elapsed: String(Math.floor((Date.now() - extractStart) / 1000)),
            });
            extractBar.stop();
            console.log(`\nSuccess!`);
            console.log(`Unpacked ${result.files.length} files to directory : ${resolve(baseDir)}`);
            console.log(`Time: ${decodeTime}ms`);
        }
        else if (result.buf) {
            const unpacked = unpackBuffer(result.buf);
            if (unpacked) {
                const baseDir = parsed.output || outputPath || '.';
                for (const file of unpacked.files) {
                    const fullPath = join(baseDir, file.path);
                    const dir = dirname(fullPath);
                    mkdirSync(dir, { recursive: true });
                    writeFileSync(fullPath, file.buf);
                }
                console.log(`\nSuccess!`);
                console.log(`Time: ${decodeTime}ms`);
                console.log(`Unpacked ${unpacked.files.length} files to current directory`);
            }
            else {
                let finalOutput = resolvedOutput;
                if (!parsed.output && !outputPath && result.meta?.name) {
                    finalOutput = result.meta.name;
                }
                writeFileSync(finalOutput, result.buf);
                console.log(`\nSuccess!`);
                if (result.meta?.name) {
                    console.log(`  Original name: ${result.meta.name}`);
                }
                const outputSize = (result.buf.length / 1024 / 1024).toFixed(2);
                console.log(`  Output size:   ${outputSize} MB`);
                console.log(`  Time:          ${decodeTime}ms`);
                console.log(`  Saved:         ${finalOutput}`);
            }
        }
        else {
            console.log(`\nSuccess!`);
            console.log(`Time: ${decodeTime}ms`);
        }
        console.log(' ');
    }
    catch (err) {
        if (err instanceof PassphraseRequiredError ||
            (err.message && err.message.includes('passphrase') && !parsed.passphrase)) {
            console.log(' ');
            console.error('File appears to be encrypted. Provide a passphrase with -p');
        }
        else if (err instanceof IncorrectPassphraseError ||
            (err.message && err.message.includes('Incorrect passphrase'))) {
            console.log(' ');
            console.error('Incorrect passphrase');
        }
        else if (err instanceof DataFormatError ||
            (err.message &&
                (err.message.includes('decompression failed') ||
                    err.message.includes('missing ROX1') ||
                    err.message.includes('Pixel payload truncated') ||
                    err.message.includes('Marker START not found')))) {
            console.log(' ');
            console.error('Data corrupted or unsupported format. Use --verbose for details.');
        }
        else {
            console.log(' ');
            console.error('Failed to decode file. Use --verbose for details.');
        }
        if (parsed.verbose) {
            console.error('Details:', err.stack || err.message);
        }
        process.exit(1);
    }
}
async function listCommand(args) {
    const parsed = parseArgs(args);
    const [inputPath] = parsed._;
    if (!inputPath) {
        console.log(' ');
        console.error('Error: Input PNG file required');
        console.log('Usage: npx rox list <input>');
        process.exit(1);
    }
    const resolvedInput = resolve(inputPath);
    if (isRustBinaryAvailable()) {
        try {
            const { findRustBinary } = await import('./utils/rust-cli-wrapper.js');
            const cliPath = findRustBinary();
            if (cliPath) {
                const { execSync } = await import('child_process');
                try {
                    const help = execSync(`"${cliPath}" --help`, { encoding: 'utf-8' });
                    if (!help.includes('list')) {
                        throw new Error('native CLI does not support list');
                    }
                    const output = execSync(`"${cliPath}" list "${resolvedInput}"`, {
                        encoding: 'utf-8',
                        stdio: ['pipe', 'pipe', 'inherit'],
                        timeout: 30000,
                    });
                    const fileList = JSON.parse(output.trim());
                    console.log(`Files in ${resolvedInput}:`);
                    for (const file of fileList) {
                        if (typeof file === 'string') {
                            console.log(`  ${file}`);
                        }
                        else {
                            console.log(`  ${file.name} (${file.size} bytes)`);
                        }
                    }
                    return;
                }
                catch (e) { }
            }
        }
        catch (err) { }
    }
    try {
        const inputBuffer = readFileSync(resolvedInput);
        const fileList = await listFilesInPng(inputBuffer, {
            includeSizes: parsed.sizes !== false,
        });
        if (fileList) {
            console.log(`Files in ${resolvedInput}:`);
            for (const file of fileList) {
                if (typeof file === 'string') {
                    console.log(`  ${file}`);
                }
                else {
                    console.log(`  ${file.name} (${file.size} bytes)`);
                }
            }
        }
        else {
            console.log('No file list found in the archive.');
        }
    }
    catch (err) {
        console.log(' ');
        console.error('Failed to list files. Use --verbose for details.');
        if (parsed.verbose) {
            console.error('Details:', err.stack || err.message);
        }
        process.exit(1);
    }
}
async function havePassphraseCommand(args) {
    const parsed = parseArgs(args);
    const [inputPath] = parsed._;
    if (!inputPath) {
        console.log(' ');
        console.error('Error: Input PNG file required');
        console.log('Usage: npx rox havepassphrase <input>');
        process.exit(1);
    }
    const resolvedInput = resolve(inputPath);
    try {
        const inputBuffer = readFileSync(resolvedInput);
        const has = await hasPassphraseInPng(inputBuffer);
        console.log(has ? 'Passphrase detected.' : 'No passphrase detected.');
    }
    catch (err) {
        console.log(' ');
        console.error('Failed to check passphrase. Use --verbose for details.');
        if (parsed.verbose)
            console.error('Details:', err.stack || err.message);
        process.exit(1);
    }
}
async function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
        showHelp();
        return;
    }
    if (args[0] === 'version' || args[0] === '--version') {
        console.log(VERSION);
        return;
    }
    const command = args[0];
    const commandArgs = args.slice(1);
    switch (command) {
        case 'encode':
            await encodeCommand(commandArgs);
            break;
        case 'decode':
            await decodeCommand(commandArgs);
            break;
        case 'list':
            await listCommand(commandArgs);
            break;
        case 'havepassphrase':
            await havePassphraseCommand(commandArgs);
            break;
        default:
            console.error(`Unknown command: ${command}`);
            console.log('Run "npx rox help" for usage information');
            process.exit(1);
    }
}
main().catch((err) => {
    console.log(' ');
    console.error('Fatal error:', err);
    process.exit(1);
});
