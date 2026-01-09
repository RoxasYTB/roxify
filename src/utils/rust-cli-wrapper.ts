import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function encodeWithRustCLI(
  inputPath: string,
  outputPath: string,
  compressionLevel = 3,
): Promise<void> {
  const cliPath = join(__dirname, '..', 'dist', 'roxify-cli');

  if (!existsSync(cliPath)) {
    throw new Error('Rust CLI binary not found. Run: npm run build:native');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(cliPath, [
      'encode',
      inputPath,
      outputPath,
      '--level',
      String(compressionLevel),
    ]);

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
