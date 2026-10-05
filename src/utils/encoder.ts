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
  const compressionLevel = opts.compressionLevel ?? 3;
  const fileName = opts.name || undefined;
  const fileListJson = opts.includeFileList && opts.fileList
    ? normalizeNativeFileList(opts.fileList as Array<{ name: string; size?: number }>)
    : undefined;

  const parts = Array.isArray(input) ? input : undefined;
  const totalLength = parts?.reduce((total, part) => total + part.length, 0) ?? 0;
  // N-API conversion costs more than concatenation for many tiny fragments.
  // Stream large parts directly into Zstd; keep small inputs on the bulk path.
  if (parts && parts.length > 1 && totalLength >= 4 * 1024 * 1024 &&
      totalLength / parts.length >= 4096 && typeof native.nativeEncodePngParts === 'function') {
    const encryptType = opts.encrypt && opts.encrypt !== 'auto' ? opts.encrypt : 'aes';
    const result = native.nativeEncodePngParts(
      parts, compressionLevel, opts.passphrase || undefined, encryptType, fileName, fileListJson,
    );
    return Buffer.isBuffer(result) ? result : Buffer.from(result);
  }

  // Older native builds only accept a contiguous input buffer.
  const inputBuf = parts ? (parts.length === 1 ? parts[0] : Buffer.concat(parts, totalLength)) : input as Buffer;

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
      return Buffer.isBuffer(result) ? result : Buffer.from(result);
    } else {
      const result = native.nativeEncodePngWithNameAndFilelist(
        inputBuf,
        compressionLevel,
        fileName,
        fileListJson,
      );
      return Buffer.isBuffer(result) ? result : Buffer.from(result);
  }
}

function normalizeNativeFileList(fileList: Array<{ name: string; size?: number }>): string {
  return JSON.stringify(fileList);
}
