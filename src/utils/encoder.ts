import { native } from './native.js';
import { EncodeOptions } from './types.js';

/**
 * Encode a buffer or array of buffers into a PNG image (ROX format).
 * This function uses the native Rust encoder directly.
 *
 * @example
 * ```js
 * import { readFileSync, writeFileSync } from 'fs';
 * import { encodeBinaryToPng } from 'roxify';
 *
 * // Encode a file with a custom filename
 * const input = readFileSync('config.json');
 * const png = await encodeBinaryToPng(input, { name: 'config.json' });
 * writeFileSync('config.png', png);
 * ```
 *
 * @example
 * ```js
 * // Encode without filename
 * const input = Buffer.from('Hello World');
 * const png = await encodeBinaryToPng(input);
 * ```
 *
 * @example
 * ```js
 * // Encode with encryption (AES)
 * const input = readFileSync('secret.txt');
 * const png = await encodeBinaryToPng(input, {
 *   name: 'secret.txt',
 *   passphrase: 'my-secret-key',
 *   encrypt: 'aes'
 * });
 * ```
 *
 * @param input - The buffer or array of buffers to encode.
 * @param opts - Optional encoding options.
 * @returns A Promise that resolves to a PNG Buffer containing the encoded data.
 */
export async function encodeBinaryToPng(
  input: Buffer | Buffer[],
  opts: EncodeOptions = {},
): Promise<Buffer> {
  const inputBuf = Array.isArray(input)
    ? (input.length === 1 ? input[0] : Buffer.concat(input, input.reduce((n, b) => n + b.length, 0)))
    : input;
  const compressionLevel = opts.compressionLevel ?? 3;
  const fileName = opts.name || undefined;
  const fileListJson = opts.includeFileList && opts.fileList
    ? normalizeNativeFileList(opts.fileList as Array<{ name: string; size?: number }>)
    : undefined;

  if (opts.passphrase) {
      const encryptType = opts.encrypt && opts.encrypt !== 'auto' ? opts.encrypt : 'aes';
      const result = native.nativeEncodePngWithEncryptionNameAndFilelist(
        inputBuf,
        compressionLevel,
        opts.passphrase,
        encryptType,
        fileName,
        fileListJson,
      );
      return asBufferZeroCopy(result);
    } else {
      const result = native.nativeEncodePngWithNameAndFilelist(
        inputBuf,
        compressionLevel,
        fileName,
        fileListJson,
      );
      return asBufferZeroCopy(result);
  }
}

function asBufferZeroCopy(u8: Uint8Array): Buffer {
  if (Buffer.isBuffer(u8)) return u8 as Buffer;
  return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);
}

function normalizeNativeFileList(fileList: Array<{ name: string; size?: number }>): string {
  return JSON.stringify(fileList);
}
