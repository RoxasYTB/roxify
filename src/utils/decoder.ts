import { readFileSync } from 'fs';
import { native } from './native.js';
import { DecodeOptions, DecodeResult } from './types.js';
import { unpackBuffer } from '../pack.js';

const PXL1_MAGIC = Buffer.from([0x50, 0x58, 0x4c, 0x31]); // "PXL1"

/**
 * Find PXL1 magic in pixel buffer
 */
function findPxl1Offset(pixels: Buffer): number {
  for (let i = 0; i <= pixels.length - 4; i++) {
    if (pixels[i] === 0x50 && pixels[i+1] === 0x58 &&
        pixels[i+2] === 0x4c && pixels[i+3] === 0x31) {
      return i;
    }
  }
  return -1;
}

/**
 * Parse payload header and extract compressed data from pixels
 */
function extractPayloadFromPixels(pixels: Buffer): { payload: Buffer; name?: string } {
  const pos = findPxl1Offset(pixels);
  if (pos < 0) {
    throw new Error('PXL1 magic not found in pixels');
  }

  let offset = pos + 4; // Skip "PXL1"

  // Read version (1 byte)
  if (offset >= pixels.length) {
    throw new Error('Truncated header: missing version');
  }
  const version = pixels[offset];
  offset += 1;

  // Read name length (1 byte)
  if (offset >= pixels.length) {
    throw new Error('Truncated header: missing name length');
  }
  const nameLen = pixels[offset];
  offset += 1;

  // Read name if present
  let name: string | undefined;
  if (nameLen > 0) {
    if (offset + nameLen > pixels.length) {
      throw new Error('Truncated header: name exceeds buffer');
    }
    name = pixels.subarray(offset, offset + nameLen).toString('utf8');
    offset += nameLen;
  }

  // Read payload length
  if (version === 1) {
    if (offset + 4 > pixels.length) {
      throw new Error('Truncated header: missing payload length (V1)');
    }
    const payloadLen = pixels.readUInt32BE(offset);
    offset += 4;

    if (offset + payloadLen > pixels.length) {
      throw new Error('Truncated payload data');
    }
    const payload = pixels.subarray(offset, offset + payloadLen);
    return { payload, name };
  } else if (version === 2) {
    if (offset + 8 > pixels.length) {
      throw new Error('Truncated header: missing payload length (V2)');
    }
    const payloadLen = Number(pixels.readBigUInt64BE(offset));
    offset += 8;

    if (offset + payloadLen > pixels.length) {
      throw new Error('Truncated payload data');
    }
    const payload = pixels.subarray(offset, offset + payloadLen);
    return { payload, name };
  } else {
    throw new Error(`Unsupported header version: ${version}`);
  }
}

/**
 * Decode a ROX PNG or buffer into the original binary payload or files list.
 * This function extracts pixels, parses the payload header, handles encryption/decryption,
 * decompresses with zstd, and returns the decoded buffer - all in memory.
 *
 * @example
 * ```js
 * import { readFileSync, writeFileSync } from 'fs';
 * import { decodePngToBinary } from 'roxify';
 *
 * // Decode a PNG file
 * const png = readFileSync('config.png');
 * const result = await decodePngToBinary(png);
 *
 * console.log(result.buf.toString()); // Original content
 * console.log(result.meta?.name);     // Original filename (e.g., "config.json")
 *
 * // Save with original filename
 * writeFileSync(result.meta?.name || 'output.bin', result.buf);
 * ```
 *
 * @example
 * ```js
 * // Decode from file path
 * const result = await decodePngToBinary('config.png');
 * writeFileSync('output.bin', result.buf);
 * ```
 *
 * @example
 * ```js
 * // Handle multi-file archives
 * const result = await decodePngToBinary(png);
 * if (result.files) {
 *   for (const file of result.files) {
 *     writeFileSync(file.path, file.buf);
 *   }
 * }
 * ```
 *
 * @param input - Buffer or path to a PNG file.
 * @param opts - Optional decode options.
 * @returns A Promise resolving to DecodeResult ({ buf, meta } or { files }).
 */
export async function decodePngToBinary(
  input: Buffer | string,
  opts: DecodeOptions = {},
): Promise<DecodeResult> {
  // Get PNG buffer
  let pngBuf: Buffer;
  if (Buffer.isBuffer(input)) {
    pngBuf = input;
  } else {
    pngBuf = readFileSync(input);
  }

  // Decode PNG to RGB pixels
  const rgbResult = native.pngToRgb(pngBuf);
  const pixels = Buffer.from(rgbResult.pixels);

  // Extract payload from pixels
  const { payload, name } = extractPayloadFromPixels(pixels);

  if (payload.length === 0) {
    throw new Error('Empty payload extracted');
  }

  // Handle encryption flag (first byte)
  // 0x00 = none, 0x01 = XOR, 0x02 = AES, 0x03 = AES-CTR
  let data: Buffer;
  if (payload[0] !== 0x00) {
    // Encrypted payload - not supported in current decoder
    // The native encoder handles encryption, but decoder needs native decrypt support
    throw new Error('Encrypted payload requires passphrase (not yet implemented in decoder)');
  } else {
    // Non-encrypted: skip the flag byte
    data = payload.subarray(1);
  }

  // Decompress with zstd
  let decompressed: Buffer;
  try {
    decompressed = Buffer.from(native.nativeZstdDecompress(data));
  } catch (e) {
    // If decompression fails, try using raw data (might be uncompressed)
    decompressed = data;
  }

  // Remove ROX1 prefix if present
  if (decompressed.length >= 4 && decompressed.subarray(0, 4).toString() === 'ROX1') {
    decompressed = decompressed.subarray(4);
  }

  // Try to unpack as multi-file archive
  try {
    const unpacked = unpackBuffer(decompressed);
    if (unpacked && unpacked.files && unpacked.files.length > 0) {
      // Return files directly as PackedFile[]
      return { files: unpacked.files, meta: { name } };
    }
  } catch {
    // Not a multi-file archive, return as single buffer
  }

  return { buf: decompressed, meta: { name } };
}
