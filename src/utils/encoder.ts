import { mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, renameSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { EncodeOptions } from './types.js';
import { encodeWithRustCLI } from './rust-cli-wrapper.js';

/**
 * Encode a buffer or array of buffers into a PNG image (ROX format).
 * This function uses the Rust CLI directly for 100% compatibility with `rox encode`.
 *
 * @param input - The buffer or array of buffers to encode.
 * @param opts - Optional encoding options.
 * @returns A Promise that resolves to a PNG Buffer containing the encoded data.
 */
export async function encodeBinaryToPng(
  input: Buffer | Buffer[],
  opts: EncodeOptions = {},
): Promise<Buffer> {
  const inputBuf = Array.isArray(input) ? Buffer.concat(input) : input;
  const compressionLevel = opts.compressionLevel ?? 3;
  const fileName = opts.name || 'input.bin';

  // Create temp directory for input/output files
  const tmpDir = mkdtempSync(join(tmpdir(), 'roxify-encode-'));
  const tempInputPath = join(tmpDir, 'temp_input.bin');
  const inputPath = join(tmpDir, fileName);
  const outputPath = join(tmpDir, 'output.png');

  try {
    // Write input buffer to temp file first
    writeFileSync(tempInputPath, inputBuf);

    // Rename to the desired filename so CLI uses the correct name
    renameSync(tempInputPath, inputPath);

    // Determine encrypt type
    let encryptType: 'aes' | 'xor' = 'aes';
    if (opts.encrypt && opts.encrypt !== 'auto') {
      encryptType = opts.encrypt as 'aes' | 'xor';
    }

    // Call Rust CLI encode command (without name param since filename is used)
    await encodeWithRustCLI(
      inputPath,
      outputPath,
      compressionLevel,
      opts.passphrase,
      encryptType,
      undefined, // fileName - not needed since we use the filename
      undefined, // ramBudgetMb
      opts.onProgress ? (current, total, step) => {
        opts.onProgress!({ phase: step, loaded: current, total });
      } : undefined,
    );

    // Read the resulting PNG
    const pngBuffer = readFileSync(outputPath);
    return pngBuffer;
  } finally {
    // Cleanup temp files
    try { unlinkSync(inputPath); } catch { }
    try { unlinkSync(tempInputPath); } catch { }
    try { unlinkSync(outputPath); } catch { }
    try { rmdirSync(tmpDir); } catch { }
  }
}
