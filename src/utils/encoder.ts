import { native } from './native.js';
import { EncodeOptions } from './types.js';

/**
 * Encode a buffer or array of buffers into a PNG image (ROX format).
 * This function uses the native Rust encoder directly.
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
  const fileName = opts.name || undefined;
  const fileListJson = opts.includeFileList && opts.fileList
    ? normalizeNativeFileList(opts.fileList as Array<{ name: string; size?: number }>)
    : undefined;

  // --- PNG container via native Rust encoder ---
  if (opts.container === 'sound') {
    if (opts.passphrase) {
      const encryptType = opts.encrypt && opts.encrypt !== 'auto' ? opts.encrypt : 'aes';
      const result = native.nativeEncodeWavWithEncryptionNameAndFilelist(
        inputBuf,
        compressionLevel,
        opts.passphrase,
        encryptType,
        fileName,
        fileListJson,
      );
      return Buffer.from(result);
    } else {
      const result = native.nativeEncodeWavWithNameAndFilelist(
        inputBuf,
        compressionLevel,
        fileName,
        fileListJson,
      );
      return Buffer.from(result);
    }
  } else {
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
      return Buffer.from(result);
    } else {
      const result = native.nativeEncodePngWithNameAndFilelist(
        inputBuf,
        compressionLevel,
        fileName,
        fileListJson,
      );
      return Buffer.from(result);
    }
  }
}

function normalizeNativeFileList(fileList: Array<{ name: string; size?: number }>): string {
  return JSON.stringify(fileList);
}
