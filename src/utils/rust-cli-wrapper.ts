import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function findRustBinary(): string | null {
  const candidates = [] as string[];

  const binNames =
    process.platform === 'win32'
      ? ['roxify-cli.exe', 'roxify_cli.exe', 'roxify_native.exe']
      : ['roxify-cli', 'roxify_cli', 'roxify_native'];

  // Possible locations relative to this file (works in repo and in packaged dist)
  const relativeDirs = [
    join(__dirname, '..', '..', 'target', 'release'),
    join(__dirname, '..', '..', 'dist'),
    join(__dirname, '..'),
    join(__dirname, '..', '..'),
  ];

  for (const dir of relativeDirs) {
    for (const name of binNames) {
      candidates.push(join(dir, name));
    }
  }

  // Common global paths
  if (process.platform !== 'win32') {
    candidates.push('/usr/local/bin/roxify_native');
    candidates.push('/usr/bin/roxify_native');
  }

  for (const p of candidates) {
    try {
      if (existsSync(p)) return p;
    } catch (e) {}
  }

  // Search in PATH for common binary names
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const { execSync } = require('child_process');
    for (const name of binNames) {
      try {
        const out = execSync(`${which} ${name}`, { encoding: 'utf-8' })
          .split('\n')[0]
          .trim();
        if (out && existsSync(out)) return out;
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {}

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
  name?: string,
): Promise<void> {
  const cliPath = findRustBinary();

  if (!cliPath) {
    throw new Error('Rust CLI binary not found. Run: cargo build --release');
  }

  return new Promise((resolve, reject) => {
    const args = ['encode', '--level', String(compressionLevel)];

    if (name) {
      args.push('--name', name);
    }

    if (passphrase) {
      args.push('--passphrase', passphrase);
      args.push('--encrypt', encryptType);
    }

    args.push(inputPath, outputPath);

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
