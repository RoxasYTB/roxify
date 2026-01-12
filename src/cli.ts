#!/usr/bin/env node

import cliProgress from 'cli-progress';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { open } from 'fs/promises';
import { basename, dirname, join, resolve } from 'path';
import {
  DataFormatError,
  decodePngToBinary,
  encodeBinaryToPng,
  hasPassphraseInPng,
  IncorrectPassphraseError,
  listFilesInPng,
  PassphraseRequiredError,
} from './index.js';
import { packPathsGenerator, unpackBuffer, VFSIndexEntry } from './pack.js';
import {
  encodeWithRustCLI,
  isRustBinaryAvailable,
} from './utils/rust-cli-wrapper.js';

const VERSION = '1.3.2';

async function readLargeFile(filePath: string): Promise<Buffer> {
  const st = statSync(filePath);

  if (st.size <= 2 * 1024 * 1024 * 1024) {
    return readFileSync(filePath);
  }

  const chunkSize = 64 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let position = 0;

  const fd = await open(filePath, 'r');

  try {
    while (position < st.size) {
      const currentChunkSize = Math.min(chunkSize, st.size - position);
      const buffer = Buffer.alloc(currentChunkSize);

      const { bytesRead } = await fd.read(
        buffer,
        0,
        currentChunkSize,
        position,
      );
      chunks.push(buffer.slice(0, bytesRead));
      position += bytesRead;
    }
  } finally {
    await fd.close();
  }

  return Buffer.concat(chunks);
}

function showHelp() {
  console.log(`
ROX CLI — Encode/decode binary in PNG

Usage:
  npx rox <command> [options]

Commands:
  encode <input>... [output]   Encode one or more files/directories into a PNG
  decode <input> [output]   Decode PNG to original file
  list <input>               List files in a Rox PNG archive
  havepassphrase <input>     Check whether the PNG requires a passphrase

Options:
  -p, --passphrase <pass>   Use passphrase (AES-256-GCM)
  -m, --mode <mode>         Mode: screenshot (default)
  -e, --encrypt <type>      auto|aes|xor|none
  --no-compress             Disable compression
  --force-ts                Force TypeScript encoder (slower but supports encryption)
  -o, --output <path>       Output file path
  -s, --sizes               Show file sizes in 'list' output (default)
  --no-sizes                Disable file size reporting in 'list'
  --files <list>            Extract only specified files (comma-separated)
  --view-reconst            Export the reconstituted PNG for debugging
  --debug                   Export debug images (doubled.png, reconstructed.png)
  -v, --verbose             Show detailed errors

Run "npx rox help" for this message.
`);
}

function parseArgs(args: string[]) {
  const parsed: Record<string, any> = { _: [] };
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'no-compress') {
        parsed.noCompress = true;
        i++;
      } else if (key === 'verbose') {
        parsed.verbose = true;
        i++;
      } else if (key === 'view-reconst') {
        parsed.viewReconst = true;
        i++;
      } else if (key === 'sizes') {
        parsed.sizes = true;
        i++;
      } else if (key === 'no-sizes') {
        parsed.sizes = false;
        i++;
      } else if (key === 'debug') {
        parsed.debug = true;
        i++;
      } else if (key === 'force-ts') {
        parsed.forceTs = true;
        i++;
      } else if (key === 'debug-dir') {
        parsed.debugDir = args[i + 1];
        i += 2;
      } else if (key === 'files') {
        parsed.files = args[i + 1].split(',');
        i += 2;
      } else {
        const value = args[i + 1];
        parsed[key] = value;
        i += 2;
      }
    } else if (arg.startsWith('-')) {
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
    } else {
      parsed._.push(arg);
      i++;
    }
  }

  return parsed;
}

async function encodeCommand(args: string[]) {
  const parsed = parseArgs(args);
  const inputPaths = parsed.output
    ? parsed._
    : parsed._.length > 1
    ? parsed._.slice(0, -1)
    : parsed._;
  const outputPath = parsed.output
    ? undefined
    : parsed._.length > 1
    ? parsed._[parsed._.length - 1]
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
  } catch (e) {
    // ENOENT: fallback sur racine
    safeCwd = '/';
  }
  const resolvedInputs = inputPaths.map((p: string) => resolve(safeCwd, p));
  let outputName = inputPaths.length === 1 ? basename(firstInput) : 'archive';
  if (inputPaths.length === 1 && !statSync(resolvedInputs[0]).isDirectory()) {
    outputName = outputName.replace(/(\.[^.]+)?$/, '.png');
  } else {
    outputName += '.png';
  }
  let resolvedOutput;
  try {
    resolvedOutput = resolve(
      safeCwd,
      parsed.output || outputPath || outputName,
    );
  } catch (e) {
    resolvedOutput = join('/', parsed.output || outputPath || outputName);
  }

  if (isRustBinaryAvailable() && !parsed.forceTs) {
    try {
      console.log(
        `Encoding to ${resolvedOutput} (Using native Rust encoder)\n`,
      );
      const startTime = Date.now();

      const encodeBar = new cliProgress.SingleBar(
        { format: ' {bar} {percentage}% | {step} | {elapsed}s' },
        cliProgress.Presets.shades_classic,
      );

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

      await encodeWithRustCLI(
        inputPaths.length === 1 ? resolvedInputs[0] : resolvedInputs[0],
        resolvedOutput,
        3,
        parsed.passphrase,
        encryptType,
      );

      clearInterval(progressInterval);
      const encodeTime = Date.now() - startTime;
      encodeBar.update(100, {
        step: 'done',
        elapsed: String(Math.floor(encodeTime / 1000)),
      });
      encodeBar.stop();

      const { statSync: fstatSync } = await import('fs');
      let inputSize = 0;
      if (
        inputPaths.length === 1 &&
        fstatSync(resolvedInputs[0]).isDirectory()
      ) {
        const { execSync } = await import('child_process');
        const sizeOutput = execSync(`du -sb "${resolvedInputs[0]}"`, {
          encoding: 'utf-8',
        });
        inputSize = parseInt(sizeOutput.split(/\s+/)[0]);
      } else {
        inputSize = fstatSync(resolvedInputs[0]).size;
      }
      const outputSize = fstatSync(resolvedOutput).size;
      const ratio = ((outputSize / inputSize) * 100).toFixed(1);

      console.log(`\nSuccess!`);
      console.log(`  Input:  ${(inputSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(
        `  Output: ${(outputSize / 1024 / 1024).toFixed(
          2,
        )} MB (${ratio}% of original)`,
      );
      console.log(`  Time:   ${encodeTime}ms`);
      console.log(`  Saved:  ${resolvedOutput}`);
      console.log(' ');
      return;
    } catch (err: any) {
      console.warn(
        '\nRust encoder failed, falling back to TypeScript encoder...',
      );
      console.warn(`Reason: ${err.message}\n`);
    }
  }

  let options: any = {};

  try {
    const encodeBar = new cliProgress.SingleBar(
      {
        format: ' {bar} {percentage}% | {step} | {elapsed}s',
      },
      cliProgress.Presets.shades_classic,
    );
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
      } else if (displayedPct < 99) {
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
      skipOptimization: true,
      compressionLevel: 19,
    });

    if (parsed.verbose) options.verbose = true;

    if (parsed.noCompress) options.compression = 'none';
    if (parsed.passphrase) {
      options.passphrase = parsed.passphrase;
      options.encrypt = parsed.encrypt || 'aes';
    }

    console.log(`Encoding to ${resolvedOutput} (Mode: ${mode})\n`);

    let inputData: Buffer | AsyncGenerator<Buffer>;
    let inputSizeVal = 0;
    let displayName: string | undefined;
    let totalBytes = 0;

    const onProgress = (
      readBytes: number,
      total: number,
      currentFile?: string,
    ) => {
      if (totalBytes === 0) totalBytes = total;
      const packPct = Math.floor((readBytes / totalBytes) * 25);
      targetPct = Math.max(targetPct, packPct);
      currentEncodeStep = currentFile
        ? `Reading files: ${currentFile}`
        : 'Reading files';
    };

    if (inputPaths.length > 1) {
      currentEncodeStep = 'Reading files';
      const { index, stream, totalSize } = await packPathsGenerator(
        inputPaths,
        undefined,
        onProgress,
      );
      inputData = stream;
      inputSizeVal = totalSize;
      displayName = parsed.outputName || 'archive';
      options.includeFileList = true;
      options.fileList = index.map((e: VFSIndexEntry) => ({
        name: e.path,
        size: e.size,
      }));
    } else {
      const resolvedInput = resolvedInputs[0];
      const st = statSync(resolvedInput);
      if (st.isDirectory()) {
        currentEncodeStep = 'Reading files';
        const { index, stream, totalSize } = await packPathsGenerator(
          [resolvedInput],
          dirname(resolvedInput),
          onProgress,
        );
        inputData = stream;
        inputSizeVal = totalSize;
        displayName = parsed.outputName || basename(resolvedInput);
        options.includeFileList = true;
        options.fileList = index.map((e: VFSIndexEntry) => ({
          name: e.path,
          size: e.size,
        }));
      } else {
        inputData = await readLargeFile(resolvedInput);
        inputSizeVal = inputData.length;
        displayName = basename(resolvedInput);
        options.includeFileList = true;
        options.fileList = [{ name: basename(resolvedInput), size: st.size }];
      }
    }
    options.name = displayName;

    options.onProgress = (info: any) => {
      let stepLabel = 'Processing';
      let pct = 0;

      if (info.phase === 'compress_start') {
        pct = 25;
        stepLabel = 'Compressing';
      } else if (info.phase === 'compress_progress') {
        pct = 25 + Math.floor((info.loaded / info.total) * 50);
        stepLabel = 'Compressing';
      } else if (info.phase === 'compress_done') {
        pct = 75;
        stepLabel = 'Compressed';
      } else if (info.phase === 'encrypt_start') {
        pct = 76;
        stepLabel = 'Encrypting';
      } else if (info.phase === 'encrypt_done') {
        pct = 80;
        stepLabel = 'Encrypted';
      } else if (info.phase === 'meta_prep_done') {
        pct = 82;
        stepLabel = 'Preparing';
      } else if (info.phase === 'png_gen') {
        if (info.loaded !== undefined && info.total !== undefined) {
          pct = 82 + Math.floor((info.loaded / info.total) * 16);
        } else {
          pct = 98;
        }
        stepLabel = 'Generating PNG';
      } else if (info.phase === 'optimizing') {
        if (info.loaded !== undefined && info.total !== undefined) {
          pct = 82 + Math.floor((info.loaded / info.total) * 18);
        } else {
          pct = 98;
        }
        stepLabel = 'Optimizing PNG';
      } else if (info.phase === 'done') {
        pct = 100;
        stepLabel = 'Done';
      }

      targetPct = Math.max(targetPct, pct);
      currentEncodeStep = stepLabel;
    };

    let inputBuffer: Buffer | Buffer[];
    if (typeof (inputData as any)[Symbol.asyncIterator] === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of inputData as AsyncGenerator<Buffer>) {
        chunks.push(chunk);
      }
      inputBuffer = chunks;
    } else {
      inputBuffer = inputData as Buffer;
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
  } catch (err: any) {
    console.log(' ');
    console.error('Error: Failed to encode file. Use --verbose for details.');
    if (parsed.verbose) console.error('Details:', err.stack || err.message);
    process.exit(1);
  }
}

async function decodeCommand(args: string[]) {
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
    const options: any = {};
    if (parsed.passphrase) {
      options.passphrase = parsed.passphrase;
    }
    if (parsed.debug) {
      options.debugDir = dirname(resolvedInput);
    }
    if (parsed.files) {
      options.files = parsed.files;
    }
    console.log(' ');
    console.log(`Decoding...`);

    console.log(' ');
    const decodeBar = new cliProgress.SingleBar(
      {
        format: ' {bar} {percentage}% | {step} | {elapsed}s',
      },
      cliProgress.Presets.shades_classic,
    );
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
      } else if (barStarted) {
        decodeBar.update(Math.floor(currentPct), {
          step: currentStep,
          elapsed: String(Math.floor((Date.now() - startDecode) / 1000)),
        });
      }
    }, 100);

    options.onProgress = (info: any) => {
      if (info.phase === 'decompress_start') {
        targetPct = 50;
        currentStep = 'Decompressing';
      } else if (
        info.phase === 'decompress_progress' &&
        info.loaded &&
        info.total
      ) {
        targetPct = 50 + Math.floor((info.loaded / info.total) * 40);
        currentStep = `Decompressing (${info.loaded}/${info.total})`;
      } else if (info.phase === 'decompress_done') {
        targetPct = 90;
        currentStep = 'Decompressed';
      } else if (info.phase === 'done') {
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
      const totalBytes = result.files.reduce(
        (s: number, f: any) => s + f.buf.length,
        0,
      );
      const extractBar = new cliProgress.SingleBar(
        { format: ' {bar} {percentage}% | {step} | {elapsed}s' },
        cliProgress.Presets.shades_classic,
      );
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
      console.log(
        `Unpacked ${result.files.length} files to directory : ${resolve(
          baseDir,
        )}`,
      );
      console.log(`Time: ${decodeTime}ms`);
    } else if (result.buf) {
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
        console.log(
          `Unpacked ${unpacked.files.length} files to current directory`,
        );
      } else {
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
    } else {
      console.log(`\nSuccess!`);
      console.log(`Time: ${decodeTime}ms`);
    }

    console.log(' ');
  } catch (err: any) {
    if (
      err instanceof PassphraseRequiredError ||
      (err.message && err.message.includes('passphrase') && !parsed.passphrase)
    ) {
      console.log(' ');
      console.error(
        'File appears to be encrypted. Provide a passphrase with -p',
      );
    } else if (
      err instanceof IncorrectPassphraseError ||
      (err.message && err.message.includes('Incorrect passphrase'))
    ) {
      console.log(' ');
      console.error('Incorrect passphrase');
    } else if (
      err instanceof DataFormatError ||
      (err.message &&
        (err.message.includes('decompression failed') ||
          err.message.includes('missing ROX1') ||
          err.message.includes('Pixel payload truncated') ||
          err.message.includes('Marker START not found')))
    ) {
      console.log(' ');
      console.error(
        'Data corrupted or unsupported format. Use --verbose for details.',
      );
    } else {
      console.log(' ');
      console.error('Failed to decode file. Use --verbose for details.');
    }

    if (parsed.verbose) {
      console.error('Details:', err.stack || err.message);
    }
    process.exit(1);
  }
}

async function listCommand(args: string[]) {
  const parsed = parseArgs(args);
  const [inputPath] = parsed._;

  if (!inputPath) {
    console.log(' ');
    console.error('Error: Input PNG file required');
    console.log('Usage: npx rox list <input>');
    process.exit(1);
  }

  const resolvedInput = resolve(inputPath);

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
        } else {
          console.log(`  ${file.name} (${file.size} bytes)`);
        }
      }
    } else {
      console.log('No file list found in the archive.');
    }
  } catch (err: any) {
    console.log(' ');
    console.error('Failed to list files. Use --verbose for details.');
    if (parsed.verbose) {
      console.error('Details:', err.stack || err.message);
    }
    process.exit(1);
  }
}

async function havePassphraseCommand(args: string[]) {
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
  } catch (err: any) {
    console.log(' ');
    console.error('Failed to check passphrase. Use --verbose for details.');
    if (parsed.verbose) console.error('Details:', err.stack || err.message);
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
