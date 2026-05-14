import { readFileSync } from 'fs';
import { native } from './native.js';
import { DecodeOptions, DecodeResult } from './types.js';
import { unpackBuffer } from '../pack.js';
import { tryDecryptIfNeeded } from './helpers.js';

/**
 * Find PXL1 magic in pixel buffer
 */
function findPxl1Offset(pixels: Buffer): number {
  for (let i = 0; i <= pixels.length - 4; i++) {
    if (pixels[i] === 0x50 && pixels[i + 1] === 0x58 &&
      pixels[i + 2] === 0x4c && pixels[i + 3] === 0x31) {
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

  const payload = Buffer.from(native.extractPayloadFromPng(pngBuf));
  let name: string | undefined;

  // Single-pass name lookup: ask the native side (which already keeps a
  // decoded RGB cache during extract_payload_from_png) instead of decoding
  // pixels again from TS.
  try {
    const fromNative = (native as any).extractNameFromPng?.(pngBuf);
    if (typeof fromNative === 'string' && fromNative.length > 0) {
      name = fromNative;
    }
  } catch { }
  if (!name) {
    // Older native binaries don't expose extractNameFromPng; fall back to the
    // previous TS path (re-decodes pixels, kept only for compat).
    try {
      const rgbResult = native.pngToRgb(pngBuf);
      const pixels = Buffer.from(rgbResult.pixels);
      ({ name } = extractPayloadFromPixels(pixels));
    } catch { }
  }

  if (payload.length === 0) {
    throw new Error('Empty payload extracted');
  }

  // Handle encryption flag (first byte): 0x00 none, 0x01 XOR, 0x02 AES-GCM, 0x03 AES-CTR.
  // tryDecryptIfNeeded handles 0x00/0x01/0x02; 0x03 (streaming AES-CTR) needs native path.
  let data: Buffer;
  const flag = payload[0];
  if (flag === 0x03) {
    throw new Error('AES-CTR streaming payload requires the native decoder');
  }
  data = tryDecryptIfNeeded(payload, opts.passphrase);

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

/**
 * Detect and reverse simple pixel-stretching where each logical pixel
 * is repeated in an Fx×Fy block. Returns { width, height, data } or null.
 */
export function unstretchImage(pixels: Buffer, width: number, height: number) {
  if (!Buffer.isBuffer(pixels)) return null;
  if (pixels.length !== width * height * 3) return null;

  try {
    let allWhite = true;
    for (let i = 0; i < pixels.length; i += 3) {
      if (!(pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255)) { allWhite = false; break; }
    }
    if (allWhite) return null;

    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 3;
        if (!(pixels[idx] === 255 && pixels[idx + 1] === 255 && pixels[idx + 2] === 255)) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;

    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;

    const colSig: string[] = [];
    for (let x = 0; x < cropW; x++) {
      const parts: number[] = [];
      for (let y = 0; y < cropH; y++) {
        const idx = ((minY + y) * width + (minX + x)) * 3;
        parts.push(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
      }
      colSig.push(parts.join(','));
    }

    const colGroups: { start: number; len: number }[] = [];
    for (let x = 0; x < colSig.length; x++) {
      if (x === 0 || colSig[x] !== colSig[x - 1]) colGroups.push({ start: x, len: 1 });
      else colGroups[colGroups.length - 1].len++;
    }

    const rowSig: string[] = [];
    for (let y = 0; y < cropH; y++) {
      const parts: number[] = [];
      for (let x = 0; x < cropW; x++) {
        const idx = ((minY + y) * width + (minX + x)) * 3;
        parts.push(pixels[idx], pixels[idx + 1], pixels[idx + 2]);
      }
      rowSig.push(parts.join(','));
    }

    const rowGroups: { start: number; len: number }[] = [];
    for (let y = 0; y < rowSig.length; y++) {
      if (y === 0 || rowSig[y] !== rowSig[y - 1]) rowGroups.push({ start: y, len: 1 });
      else rowGroups[rowGroups.length - 1].len++;
    }

    const outW = colGroups.length;
    const outH = rowGroups.length;
    const hasRun = colGroups.some(g => g.len > 1) || rowGroups.some(g => g.len > 1);
    if (!hasRun) return null;

    const out = Buffer.alloc(outW * outH * 3);
    for (let gy = 0; gy < outH; gy++) {
      for (let gx = 0; gx < outW; gx++) {
        const sx = minX + colGroups[gx].start;
        const sy = minY + rowGroups[gy].start;
        const baseIdx = (sy * width + sx) * 3;
        const r = pixels[baseIdx], g = pixels[baseIdx + 1], b = pixels[baseIdx + 2];
        for (let ry = 0; ry < rowGroups[gy].len; ry++) {
          for (let rx = 0; rx < colGroups[gx].len; rx++) {
            const ix = ((sy + ry) * width + (sx + rx)) * 3;
            if (pixels[ix] !== r || pixels[ix + 1] !== g || pixels[ix + 2] !== b) return null;
          }
        }
        const outIdx = (gy * outW + gx) * 3;
        out[outIdx] = r; out[outIdx + 1] = g; out[outIdx + 2] = b;
      }
    }

    return { width: outW, height: outH, data: out };
  } catch {
    return null;
  }
}
