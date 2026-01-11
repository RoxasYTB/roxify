import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRustBinary(): string | null {
  const possiblePaths = [
    join(__dirname, '..', '..', 'target', 'release', 'roxify_native'),
    join(__dirname, '..', 'dist', 'roxify-cli'),
    '/usr/local/bin/roxify_native',
  ];

  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export function isRustBinaryAvailable(): boolean {
  return findRustBinary() !== null;
}

export async function encodeWithRustCLI(
  inputPath: string,
  outputPath: string,
  compressionLevel = 3,
  passphrase?: string,
  encryptType: 'aes' | 'xor' = 'aes',
): Promise<void> {
  const cliPath = findRustBinary();

  if (!cliPath) {
    throw new Error('Rust CLI binary not found. Run: cargo build --release');
  }

  return new Promise((resolve, reject) => {
    const args = [
      'encode',
      inputPath,
      outputPath,
      '--level',
      String(compressionLevel),
    ];

    if (passphrase) {
      args.push('--passphrase', passphrase);
      args.push('--encrypt', encryptType);
    }

    const proc = spawn(cliPath, args);

    let stderr = '';
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn Rust CLI: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Rust CLI exited with code ${code}: ${stderr}`));
      }
    });
  });
}
