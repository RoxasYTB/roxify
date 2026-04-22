#!/usr/bin/env node
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { open } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import * as cliProgress from './stub-progress.js';
import { decodeWithRustCLI, encodeWithRustCLI, havepassphraseWithRustCLI, isRustBinaryAvailable, listWithRustCLI, } from './utils/rust-cli-wrapper.js';
async function loadJsEngine() {
    const indexMod = await import('./index.js');
    const packMod = await import('./pack.js');
    return {
        decodePngToBinary: indexMod.decodePngToBinary,
        encodeBinaryToPng: indexMod.encodeBinaryToPng,
        hasPassphraseInPng: indexMod.hasPassphraseInPng,
        listFilesInPng: indexMod.listFilesInPng,
        DataFormatError: indexMod.DataFormatError,
        IncorrectPassphraseError: indexMod.IncorrectPassphraseError,
        PassphraseRequiredError: indexMod.PassphraseRequiredError,
        packPathsGenerator: packMod.packPathsGenerator,
        unpackBuffer: packMod.unpackBuffer,
        VFSIndexEntry: undefined,
    };
}
const VERSION = '1.13.2';
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
  --bwt-ans                 Use BWT-ANS compression instead of Zstd
  -p, --passphrase <pass>   Use passphrase (AES-256-GCM)
  -m, --mode <mode>         Mode: screenshot (default)
  -e, --encrypt <type>      auto|aes|xor|none
  --no-compress             Disable compression
  --dict <file>             Use zstd dictionary when compressing
  --ram-budget-mb <mb>      Max RAM budget used by native encode/decode paths
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
            else if (key === 'bwt-ans') {
                parsed.compression = 'bwt-ans';
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
            else if (key === 'ram-budget-mb') {
                const v = Number(args[i + 1]);
                if (!Number.isFinite(v) || v <= 0) {
                    console.error(`Invalid --ram-budget-mb: ${args[i + 1]}`);
                    process.exit(1);
                }
                parsed.ramBudgetMb = Math.floor(v);
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
        if (anyDir && !isRustBinaryAvailable()) {
            const js = await loadJsEngine();
            const { index } = await js.packPathsGenerator(inputPaths, undefined, () => { });
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
    if (isRustBinaryAvailable() && !parsed.forceTs && containerMode !== 'sound' && parsed.compression !== 'bwt-ans') {
        try {
            console.log(`Encoding to ${resolvedOutput} (Using native Rust encoder)\n`);
            const startTime = Date.now();
            const encodeBar = new cliProgress.SingleBar({ format: ' {bar} {percentage}% | {step} | {elapsed}s' }, cliProgress.Presets.shades_classic);
            encodeBar.start(100, 0, { step: 'Encoding', elapsed: '0' });
            const encryptType = parsed.encrypt === 'xor' ? 'xor' : 'aes';
            const fileName = basename(inputPaths[0]);
            await encodeWithRustCLI(inputPaths.length === 1 ? resolvedInputs[0] : resolvedInputs[0], resolvedOutput, 19, parsed.passphrase, encryptType, fileName, parsed.ramBudgetMb, (current, total, step) => {
                const pct = total > 0 ? Math.floor((current / total) * 100) : 0;
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                encodeBar.update(Math.min(pct, 99), {
                    step: step || 'Encoding',
                    elapsed: String(elapsed),
                });
            });
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
            const saved = (100 - (outputSize / inputSize) * 100).toFixed(1);
            console.log(`\nSuccess!`);
            console.log(`  Input:  ${(inputSize / 1024 / 1024).toFixed(2)} MB`);
            console.log(`  Output: ${(outputSize / 1024 / 1024).toFixed(2)} MB (${saved}% saved)`);
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
        const js = await loadJsEngine();
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
            compressionLevel: 6,
            outputFormat: 'auto',
            container: containerMode,
        });
        if (parsed.verbose)
            options.verbose = true;
        if (parsed.noCompress)
            options.compression = 'none';
        if (parsed.compression === 'bwt-ans')
            options.compression = 'bwt-ans';
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
            const { index, stream, totalSize } = await js.packPathsGenerator(inputPaths, undefined, onProgress);
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
                const { index, stream, totalSize } = await js.packPathsGenerator([resolvedInput], dirname(resolvedInput), onProgress);
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
        const output = await js.encodeBinaryToPng(inputBuffer, options);
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
        const saved = (100 - (output.length / inputSizeVal) * 100).toFixed(1);
        console.log(`\nSuccess!`);
        console.log(`  Input:  ${inputSize} MB`);
        console.log(`  Output: ${outputSize} MB (${saved}% saved)`);
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
    const resolvedOutput = parsed.output || outputPath || '.';
    if (!isRustBinaryAvailable()) {
        console.error('Error: Rust decoder binary not found');
        process.exit(1);
    }
    try {
        console.log(' ');
        console.log('Decoding... (Using native Rust decoder)\n');
        const startTime = Date.now();
        const decodeBar = new cliProgress.SingleBar({ format: ' {bar} {percentage}% | {step} | {elapsed}s' }, cliProgress.Presets.shades_classic);
        decodeBar.start(100, 0, { step: 'Decoding', elapsed: '0' });
        await decodeWithRustCLI(resolvedInput, resolvedOutput, parsed.passphrase, parsed.files, parsed.dict, parsed.ramBudgetMb, (current, total, step) => {
            const pct = total > 0 ? Math.floor((current / total) * 100) : 0;
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            decodeBar.update(Math.min(pct, 99), {
                step: step || 'Decoding',
                elapsed: String(elapsed),
            });
        });
        const decodeTime = Date.now() - startTime;
        decodeBar.update(100, { step: 'done', elapsed: String(Math.floor(decodeTime / 1000)) });
        decodeBar.stop();
        console.log(`\nSuccess!`);
        console.log(`  Time: ${decodeTime}ms`);
        console.log(`  Output: ${resolve(resolvedOutput)}`);
        console.log(' ');
    }
    catch (err) {
        console.log(' ');
        console.error('Error: Rust decoder failed.');
        console.error(`Reason: ${err.message}`);
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
            const output = await listWithRustCLI(resolvedInput);
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
    try {
        const inputBuffer = readFileSync(resolvedInput);
        const js = await loadJsEngine();
        const fileList = await js.listFilesInPng(inputBuffer, {
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
    if (isRustBinaryAvailable()) {
        try {
            const output = await havepassphraseWithRustCLI(resolvedInput);
            console.log(output.trim());
            return;
        }
        catch (e) { }
    }
    try {
        const inputBuffer = readFileSync(resolvedInput);
        const js = await loadJsEngine();
        const has = await js.hasPassphraseInPng(inputBuffer);
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
