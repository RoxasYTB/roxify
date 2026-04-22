import { readFileSync } from 'fs';
import { native } from './native.js';
import { DecodeOptions, DecodeResult } from './types.js';
import { unpackBuffer } from '../pack.js';

/**
 * Decode a ROX PNG or buffer into the original binary payload or files list.
 * This function uses the Rust native implementation exclusively.
 *
 * @param input - Buffer or path to a PNG file.
 * @param opts - Optional decode options.
 * @returns A Promise resolving to DecodeResult ({ buf, meta } or { files }).
 */
export async function decodePngToBinary(
  input: Buffer | string,
  opts: DecodeOptions = {},
): Promise<DecodeResult> {
  let pngBuf: Buffer;
  if (Buffer.isBuffer(input)) {
    pngBuf = input;
  } else {
    pngBuf = readFileSync(input);
  }

  // --- Native decoder: let Rust handle extraction/decompression/decryption ---
  const payload = Buffer.from(native.extractPayloadFromPng(pngBuf));
  
  if (payload.length === 0) {
    throw new Error('No payload found in PNG');
  }

  // Extract name from payload header (version byte, name length, name)
  let name: string | undefined;
  let dataOffset = 0;
  
  if (payload.length > 2) {
    const version = payload[0];
    const nameLen = payload[1];
    dataOffset = 2;
    
    if (nameLen > 0 && payload.length >= 2 + nameLen + 8) {
      name = payload.subarray(2, 2 + nameLen).toString('utf8');
      dataOffset = 2 + nameLen;
    }
    
    // Read payload length (8 bytes, big-endian, after name)
    const payloadLen = Number(payload.readBigUInt64BE(dataOffset));
    dataOffset += 8;
    
    // The actual compressed/encrypted data starts at dataOffset
    let compressedData = payload.subarray(dataOffset, dataOffset + payloadLen);
    
    // Try to decompress with zstd if needed
    let decompressed: Buffer;
    try {
      decompressed = Buffer.from(native.nativeZstdDecompress(compressedData));
    } catch {
      // If decompression fails, use raw data
      decompressed = compressedData;
    }
    
    // Check for ROX1 magic
    if (decompressed.length >= 4 && decompressed.subarray(0, 4).toString() === 'ROX1') {
      decompressed = decompressed.subarray(4);
    }
    
    // Try to unpack as multi-file archive
    try {
      const unpacked = unpackBuffer(decompressed);
      if (unpacked && unpacked.files && unpacked.files.length > 0) {
        return { files: unpacked.files, meta: { name } };
      }
    } catch {
      // Fall through to raw buffer return
    }
    
    return { buf: decompressed, meta: { name } };
  }
  
  return { buf: payload, meta: { name } };
}
