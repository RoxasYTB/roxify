import { native } from './native.js';
import { EncodeOptions } from './types.js';

function normalizeNativeFileList(fileList: EncodeOptions['fileList']): string {
  if (!fileList) return '[]';
  return JSON.stringify(fileList.map((entry: any) => {
    if (typeof entry === 'string') {
      return { name: entry, size: 0 };
    }
    if (entry && typeof entry === 'object') {
      if (entry.name) return { name: entry.name, size: entry.size ?? 0 };
      if (entry.path) return { name: entry.path, size: entry.size ?? 0 };
    }
    return { name: String(entry), size: 0 };
  }));
}

/**
 * Encode a buffer or array of buffers into a PNG image (ROX format).
 * This function uses the Rust native implementation exclusively.
 *
 * @param input - The buffer or array of buffers to encode.
 * @param opts - Optional encoding options.
 * @returns A Promise that resolves to a PNG Buffer containing the encoded data.
 */
export async function encodeBinaryToPng(
  input: Buffer | Buffer[],
  opts: EncodeOptions = {},
): Promise<Buffer> {
  const compressionLevel = opts.compressionLevel ?? 19;
  const inputBuf = Array.isArray(input) ? Buffer.concat(input) : input;
  const fileName = opts.name || undefined;
  const fileListJson = opts.includeFileList && opts.fileList
    ? normalizeNativeFileList(opts.fileList)
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
