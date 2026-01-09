#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { basename, resolve } from 'path';
import { DataFormatError, decodePngToBinary, encodeBinaryToPng, IncorrectPassphraseError, PassphraseRequiredError, } from './index.js';
const VERSION = '1.0.4';
function showHelp() {
    console.log(`
rox CLI — Encode/decode binary in PNG

Usage:
  npx rox <command> [options]

Commands:
  encode <input> [output]   Encode file to PNG
  decode <input> [output]   Decode PNG to original file

Options:
  -p, --passphrase <pass>   Use passphrase (AES-256-GCM)
  -m, --mode <mode>         Mode: compact|chunk|pixel|screenshot (default: screenshot)
  -q, --quality <0-11>      Brotli quality (default: 4)
  -e, --encrypt <type>      auto|aes|xor|none
  --no-compress             Disable compression
  -o, --output <path>       Output file path
  -v, --verbose             Show detailed errors

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
                    parsed.mode = value;
                    i += 2;
                    break;
                case 'q':
                    parsed.quality = parseInt(value, 10);
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
    const [inputPath, outputPath] = parsed._;
    if (!inputPath) {
        console.error('Error: Input file required');
        console.log('Usage: npx rox encode <input> [output] [options]');
        process.exit(1);
    }
    const resolvedInput = resolve(inputPath);
    const resolvedOutput = parsed.output || outputPath || inputPath.replace(/(\.[^.]+)?$/, '.png');
    try {
        console.log(`Reading: ${resolvedInput}`);
        const startRead = Date.now();
        const inputBuffer = readFileSync(resolvedInput);
        const readTime = Date.now() - startRead;
        console.log(`Read ${(inputBuffer.length / 1024 / 1024).toFixed(2)} MB in ${readTime}ms`);
        const options = {
            mode: parsed.mode || 'screenshot',
            name: basename(resolvedInput),
            brQuality: parsed.quality !== undefined ? parsed.quality : 4,
        };
        if (parsed.noCompress) {
            options.compression = 'none';
        }
        if (parsed.passphrase) {
            options.passphrase = parsed.passphrase;
            options.encrypt = parsed.encrypt || 'aes';
        }
        console.log(`Encoding ${basename(resolvedInput)} -> ${resolvedOutput}`);
        const startEncode = Date.now();
        const output = await encodeBinaryToPng(inputBuffer, options);
        const encodeTime = Date.now() - startEncode;
        writeFileSync(resolvedOutput, output);
        const outputSize = (output.length / 1024 / 1024).toFixed(2);
        const inputSize = (inputBuffer.length / 1024 / 1024).toFixed(2);
        const ratio = ((output.length / inputBuffer.length) * 100).toFixed(1);
        console.log(`\nSuccess!`);
        console.log(`  Input:  ${inputSize} MB`);
        console.log(`  Output: ${outputSize} MB (${ratio}% of original)`);
        console.log(`  Time:   ${encodeTime}ms`);
        console.log(`  Saved:  ${resolvedOutput}`);
    }
    catch (err) {
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
        console.error('Error: Input PNG file required');
        console.log('Usage: npx rox decode <input> [output] [options]');
        process.exit(1);
    }
    const resolvedInput = resolve(inputPath);
    try {
        console.log(`Reading: ${resolvedInput}`);
        const inputBuffer = readFileSync(resolvedInput);
        const options = {};
        if (parsed.passphrase) {
            options.passphrase = parsed.passphrase;
        }
        console.log(`Decoding...`);
        const startDecode = Date.now();
        const result = await decodePngToBinary(inputBuffer, options);
        const decodeTime = Date.now() - startDecode;
        const resolvedOutput = parsed.output || outputPath || result.meta?.name || 'decoded.bin';
        writeFileSync(resolvedOutput, result.buf);
        const outputSize = (result.buf.length / 1024 / 1024).toFixed(2);
        console.log(`\nSuccess!`);
        if (result.meta?.name) {
            console.log(`  Original name: ${result.meta.name}`);
        }
        console.log(`  Output size:   ${outputSize} MB`);
        console.log(`  Time:          ${decodeTime}ms`);
        console.log(`  Saved:         ${resolvedOutput}`);
    }
    catch (err) {
        if (err instanceof PassphraseRequiredError ||
            (err.message && err.message.includes('passphrase') && !parsed.passphrase)) {
            console.error('File appears to be encrypted. Provide a passphrase with -p');
        }
        else if (err instanceof IncorrectPassphraseError ||
            (err.message && err.message.includes('Incorrect passphrase'))) {
            console.error('Incorrect passphrase');
        }
        else if (err instanceof DataFormatError ||
            (err.message &&
                (err.message.includes('decompression failed') ||
                    err.message.includes('missing ROX1') ||
                    err.message.includes('Pixel payload truncated') ||
                    err.message.includes('Marker START not found') ||
                    err.message.includes('Brotli decompression failed')))) {
            console.error('Data corrupted or unsupported format. Use --verbose for details.');
        }
        else {
            console.error('Failed to decode file. Use --verbose for details.');
        }
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
        default:
            console.error(`Unknown command: ${command}`);
            console.log('Run "npx rox help" for usage information');
            process.exit(1);
    }
}
main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
