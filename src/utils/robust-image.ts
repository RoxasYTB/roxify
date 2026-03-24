/**
 * Lossy-Resilient Image Encoding (PNG container).
 *
 * Encodes binary data using QR-code-inspired techniques:
 * - Large pixel blocks (configurable 2×2 to 8×8) for JPEG/WebP resilience.
 * - Binary encoding (black/white) with threshold detection.
 * - Finder patterns at corners for automatic alignment.
 * - Reed-Solomon error correction with configurable redundancy.
 * - Byte-level interleaving to spread burst errors across RS blocks.
 *
 * The resulting image looks like a structured data pattern (similar to
 * a QR code) and can be recovered even after JPEG recompression at
 * quality levels as low as 30–50.
 */

import { eccDecode, eccEncode, EccLevel } from './ecc.js';
import { native } from './native.js';

// ─── Configuration ──────────────────────────────────────────────────────────

/** Finder pattern (7×7 blocks, like QR codes). */
const FINDER_SIZE = 7;

/** Alignment pattern (5×5 blocks). */
const ALIGNMENT_SIZE = 5;

/** Quiet zone around finder patterns (blocks). */
const QUIET_ZONE = 1;

/** Header area width in blocks (next to top-left finder). */
const HEADER_BLOCKS = 20;

/** Magic bytes for robust image format. */
const ROBUST_IMG_MAGIC = Buffer.from('RBI1');

// ─── Finder Pattern ─────────────────────────────────────────────────────────

/**
 * Generate a 7×7 finder pattern (same as QR code finder).
 * Returns a 2D boolean grid (true = black, false = white).
 */
function finderPattern(): boolean[][] {
  const p: boolean[][] = [];
  for (let y = 0; y < FINDER_SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < FINDER_SIZE; x++) {
      const border =
        y === 0 || y === 6 || x === 0 || x === 6;
      const inner =
        y >= 2 && y <= 4 && x >= 2 && x <= 4;
      row.push(border || inner);
    }
    p.push(row);
  }
  return p;
}

/**
 * Generate a 5×5 alignment pattern.
 */
function alignmentPattern(): boolean[][] {
  const p: boolean[][] = [];
  for (let y = 0; y < ALIGNMENT_SIZE; y++) {
    const row: boolean[] = [];
    for (let x = 0; x < ALIGNMENT_SIZE; x++) {
      const border =
        y === 0 || y === 4 || x === 0 || x === 4;
      const center = y === 2 && x === 2;
      row.push(border || center);
    }
    p.push(row);
  }
  return p;
}

// ─── Image Grid Management ──────────────────────────────────────────────────

interface GridLayout {
  /** Total width in blocks. */
  gridW: number;
  /** Total height in blocks. */
  gridH: number;
  /** Ordered list of (bx, by) positions for data blocks. */
  dataPositions: Array<[number, number]>;
}

/**
 * Compute grid layout: place finder patterns, quiet zones, and determine
 * which block positions are available for data.
 * Optimized: uses flat boolean array instead of Set<string> for reserved lookup.
 */
function computeLayout(dataBlocks: number): GridLayout {
  // Minimum grid to fit data + finder patterns + quiet zones
  const finderFootprint = FINDER_SIZE + QUIET_ZONE;

  // Start with a square grid and expand if needed
  let side = Math.ceil(Math.sqrt(dataBlocks + 4 * finderFootprint * finderFootprint));
  side = Math.max(side, finderFootprint * 2 + 4); // minimum for finders

  const gridW = side;
  const gridH = side;

  // Determine reserved regions (finder patterns + quiet zones) using flat array
  const reserved = new Uint8Array(gridW * gridH);

  // Top-left finder
  for (let y = 0; y < finderFootprint; y++) {
    for (let x = 0; x < finderFootprint; x++) {
      reserved[y * gridW + x] = 1;
    }
  }

  // Top-right finder
  for (let y = 0; y < finderFootprint; y++) {
    for (let x = gridW - finderFootprint; x < gridW; x++) {
      reserved[y * gridW + x] = 1;
    }
  }

  // Bottom-left finder
  for (let y = gridH - finderFootprint; y < gridH; y++) {
    for (let x = 0; x < finderFootprint; x++) {
      reserved[y * gridW + x] = 1;
    }
  }

  // Bottom-right finder
  for (let y = gridH - finderFootprint; y < gridH; y++) {
    for (let x = gridW - finderFootprint; x < gridW; x++) {
      reserved[y * gridW + x] = 1;
    }
  }

  // Collect available data positions (row-by-row)
  const dataPositions: Array<[number, number]> = [];
  for (let y = 0; y < gridH; y++) {
    const rowBase = y * gridW;
    for (let x = 0; x < gridW; x++) {
      if (!reserved[rowBase + x]) {
        dataPositions.push([x, y]);
      }
    }
  }

  return { gridW, gridH, dataPositions };
}

// ─── Block Rendering ────────────────────────────────────────────────────────

/**
 * Render the block grid into an RGB pixel buffer.
 * Optimized: fills row spans instead of individual pixels.
 *
 * @param grid - 2D grid of block values (0 = black, 255 = white).
 * @param blockSize - Pixel size of each block (e.g., 4 = 4×4 pixels per block).
 * @returns { rgb, width, height } - Raw RGB buffer and pixel dimensions.
 */
function renderGrid(
  grid: Uint8Array[],
  gridW: number,
  gridH: number,
  blockSize: number,
): { rgb: Buffer; width: number; height: number } {
  const width = gridW * blockSize;
  const height = gridH * blockSize;
  const rgb = Buffer.alloc(width * height * 3);
  const stride = width * 3;

  for (let by = 0; by < gridH; by++) {
    const row = grid[by];
    // Build one pixel row for this block row
    const firstRowOffset = by * blockSize * stride;

    for (let bx = 0; bx < gridW; bx++) {
      const val = row[bx];
      const pxStart = firstRowOffset + bx * blockSize * 3;
      // Fill one row of pixel span for this block
      for (let dx = 0; dx < blockSize; dx++) {
        const off = pxStart + dx * 3;
        rgb[off] = val;
        rgb[off + 1] = val;
        rgb[off + 2] = val;
      }
    }

    // Copy the first pixel row to the remaining (blockSize - 1) rows
    const srcStart = firstRowOffset;
    for (let dy = 1; dy < blockSize; dy++) {
      rgb.copy(rgb, firstRowOffset + dy * stride, srcStart, srcStart + stride);
    }
  }

  return { rgb, width, height };
}

/**
 * Place a finder pattern on the grid at a given position.
 */
function placeFinderPattern(
  grid: Uint8Array[],
  startX: number,
  startY: number,
): void {
  const fp = finderPattern();
  for (let y = 0; y < FINDER_SIZE; y++) {
    for (let x = 0; x < FINDER_SIZE; x++) {
      grid[startY + y][startX + x] = fp[y][x] ? 0 : 255;
    }
  }
}

// ─── Read Blocks from Image ─────────────────────────────────────────────────

/**
 * Read block values from an RGB pixel buffer using majority voting.
 * Each block's pixels are averaged, then thresholded to 0 or 255.
 */
function readBlocks(
  rgb: Buffer,
  width: number,
  height: number,
  blockSize: number,
  gridW: number,
  gridH: number,
): Uint8Array[] {
  const grid: Uint8Array[] = [];
  for (let by = 0; by < gridH; by++) {
    const row = new Uint8Array(gridW);
    for (let bx = 0; bx < gridW; bx++) {
      let sum = 0;
      let count = 0;
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const py = by * blockSize + dy;
          const px = bx * blockSize + dx;
          if (py < height && px < width) {
            const idx = (py * width + px) * 3;
            // Average RGB to grayscale
            sum += (rgb[idx] + rgb[idx + 1] + rgb[idx + 2]) / 3;
            count++;
          }
        }
      }
      // Threshold at midpoint (128)
      row[bx] = count > 0 && sum / count > 128 ? 255 : 0;
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Detect finder patterns and extract grid parameters from an image.
 * Returns the estimated block size and grid dimensions.
 */
function detectFinderPatterns(
  rgb: Buffer,
  width: number,
  height: number,
): { blockSize: number; gridW: number; gridH: number } | null {
  // Try each candidate block size (2–8) and look for finder patterns
  for (let bs = 2; bs <= 8; bs++) {
    const gw = Math.floor(width / bs);
    const gh = Math.floor(height / bs);

    if (gw < FINDER_SIZE * 2 + 4 || gh < FINDER_SIZE * 2 + 4) continue;

    // Check top-left corner for finder pattern
    const fp = finderPattern();
    let matchCount = 0;
    let totalChecked = 0;

    for (let fy = 0; fy < FINDER_SIZE; fy++) {
      for (let fx = 0; fx < FINDER_SIZE; fx++) {
        const expected = fp[fy][fx] ? 0 : 255;
        // Sample center of block
        const py = fy * bs + Math.floor(bs / 2);
        const px = fx * bs + Math.floor(bs / 2);
        if (py >= height || px >= width) continue;
        const idx = (py * width + px) * 3;
        const gray = (rgb[idx] + rgb[idx + 1] + rgb[idx + 2]) / 3;
        const actual = gray > 128 ? 255 : 0;
        totalChecked++;
        if (actual === expected) matchCount++;
      }
    }

    // Require ≥80% match for finder detection
    if (totalChecked > 0 && matchCount / totalChecked >= 0.8) {
      return { blockSize: bs, gridW: gw, gridH: gh };
    }
  }

  return null;
}

// ─── Header Encoding ────────────────────────────────────────────────────────

/**
 * Encode header bits into a sequence of data positions.
 * Header: [4B magic] [1B blockSize] [1B eccLevel] [4B dataLen] [2B gridW] [2B gridH]
 * Total: 14 bytes = 112 bits.
 */
function encodeHeader(
  blockSize: number,
  eccLevel: number,
  dataLen: number,
  gridW: number,
  gridH: number,
): Uint8Array {
  const header = Buffer.alloc(14);
  ROBUST_IMG_MAGIC.copy(header, 0);
  header[4] = blockSize;
  header[5] = eccLevel;
  header.writeUInt32BE(dataLen, 6);
  header.writeUInt16BE(gridW, 10);
  header.writeUInt16BE(gridH, 12);
  return new Uint8Array(header);
}

function decodeHeader(bytes: Uint8Array): {
  blockSize: number;
  eccLevel: number;
  dataLen: number;
  gridW: number;
  gridH: number;
} | null {
  if (bytes.length < 14) return null;
  const buf = Buffer.from(bytes);
  if (!buf.subarray(0, 4).equals(ROBUST_IMG_MAGIC)) return null;
  return {
    blockSize: buf[4],
    eccLevel: buf[5],
    dataLen: buf.readUInt32BE(6),
    gridW: buf.readUInt16BE(10),
    gridH: buf.readUInt16BE(12),
  };
}

// ─── Bit/Byte Packing ──────────────────────────────────────────────────────

/**
 * Convert bytes to bits (MSB first within each byte).
 */
function bytesToBits(data: Uint8Array): Uint8Array {
  const bits = new Uint8Array(data.length * 8);
  for (let i = 0; i < data.length; i++) {
    for (let bit = 7; bit >= 0; bit--) {
      bits[i * 8 + (7 - bit)] = (data[i] >> bit) & 1;
    }
  }
  return bits;
}

/**
 * Convert bits back to bytes (MSB first).
 */
function bitsToBytes(bits: Uint8Array): Uint8Array {
  const numBytes = Math.ceil(bits.length / 8);
  const bytes = new Uint8Array(numBytes);
  for (let i = 0; i < numBytes; i++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      const idx = i * 8 + bit;
      if (idx < bits.length && bits[idx]) {
        byte |= 1 << (7 - bit);
      }
    }
    bytes[i] = byte;
  }
  return bytes;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface RobustImageEncodeOptions {
  /** Pixel size per data block (2–8). Higher = more lossy resilience. Default: 4. */
  blockSize?: number;
  /** Error correction level. Default: 'medium'. */
  eccLevel?: EccLevel;
}

export interface RobustImageDecodeResult {
  data: Buffer;
  correctedErrors: number;
}

const ECC_LEVEL_MAP: Record<EccLevel, number> = {
  low: 0,
  medium: 1,
  quartile: 2,
  high: 3,
};

const ECC_LEVEL_REVERSE: Record<number, EccLevel> = {
  0: 'low',
  1: 'medium',
  2: 'quartile',
  3: 'high',
};

/**
 * Encode binary data into a lossy-resilient PNG image.
 *
 * The output uses QR-code-like techniques:
 * - Finder patterns for alignment after re-encoding.
 * - Large pixel blocks for JPEG/WebP resilience.
 * - Reed-Solomon ECC for automatic error correction.
 *
 * @param data - Raw data to encode.
 * @param opts - Encoding options.
 * @returns PNG image as a Buffer.
 */
export function encodeRobustImage(
  data: Buffer,
  opts: RobustImageEncodeOptions = {},
): Buffer {
  const blockSize = opts.blockSize ?? 4;
  const eccLevel = opts.eccLevel ?? 'medium';

  if (blockSize < 2 || blockSize > 8) {
    throw new Error(`Block size must be 2–8, got ${blockSize}`);
  }

  // 1. Protect with ECC
  const protectedData = eccEncode(data, eccLevel);

  // 2. Convert header + protected data to bits
  const headerBytes = encodeHeader(
    blockSize,
    ECC_LEVEL_MAP[eccLevel],
    data.length,
    0, // gridW placeholder (filled after layout)
    0, // gridH placeholder
  );

  // Total payload: header (14 bytes) + protected data
  const payload = Buffer.concat([Buffer.from(headerBytes), protectedData]);
  const bits = bytesToBits(new Uint8Array(payload));

  // 3. Compute layout
  const layout = computeLayout(bits.length);

  // Update header with actual grid dimensions
  const headerFinal = encodeHeader(
    blockSize,
    ECC_LEVEL_MAP[eccLevel],
    data.length,
    layout.gridW,
    layout.gridH,
  );
  const payloadFinal = Buffer.concat([Buffer.from(headerFinal), protectedData]);
  const bitsFinal = bytesToBits(new Uint8Array(payloadFinal));

  // Re-layout with correct size if needed
  const finalLayout = computeLayout(bitsFinal.length);

  if (finalLayout.dataPositions.length < bitsFinal.length) {
    throw new Error(
      `Data too large for image: need ${bitsFinal.length} blocks, have ${finalLayout.dataPositions.length}`,
    );
  }

  // 4. Build the block grid
  const { gridW, gridH, dataPositions } = finalLayout;
  const grid: Uint8Array[] = [];
  for (let y = 0; y < gridH; y++) {
    grid.push(new Uint8Array(gridW).fill(255)); // white background
  }

  // Place finder patterns at 4 corners
  placeFinderPattern(grid, 0, 0);
  placeFinderPattern(grid, gridW - FINDER_SIZE, 0);
  placeFinderPattern(grid, 0, gridH - FINDER_SIZE);
  placeFinderPattern(grid, gridW - FINDER_SIZE, gridH - FINDER_SIZE);

  // Place data bits
  for (let i = 0; i < bitsFinal.length && i < dataPositions.length; i++) {
    const [bx, by] = dataPositions[i];
    grid[by][bx] = bitsFinal[i] ? 0 : 255; // 1 = black, 0 = white
  }

  // 5. Render to pixels
  const { rgb, width, height } = renderGrid(grid, gridW, gridH, blockSize);

  // 6. Encode as PNG
  if (native?.rgbToPng) {
    return Buffer.from(native.rgbToPng(rgb, width, height));
  }

  // Fallback: manual PNG generation (minimal, no compression)
  return manualPngEncode(rgb, width, height);
}

/**
 * Decode binary data from a lossy-resilient PNG image.
 *
 * Handles images that have been re-encoded through JPEG/WebP at various
 * quality levels. The Reed-Solomon ECC layer corrects any bit errors
 * introduced by lossy compression.
 *
 * @param png - PNG (or raw RGB) image buffer.
 * @returns Decoded data and error correction stats.
 */
export function decodeRobustImage(png: Buffer): RobustImageDecodeResult {
  // 1. Get raw pixels
  let width: number;
  let height: number;
  let rgb: Buffer;

  if (native?.sharpMetadata && native?.sharpToRaw) {
    const meta = native.sharpMetadata(png);
    width = meta.width;
    height = meta.height;
    const raw = native.sharpToRaw(png);
    rgb = Buffer.from(raw.pixels);
  } else {
    throw new Error(
      'Robust image decoding requires the native module (sharpMetadata + sharpToRaw)',
    );
  }

  // 2. Detect finder patterns to determine block size and grid
  const detection = detectFinderPatterns(rgb, width, height);
  if (!detection) {
    throw new Error('Could not detect finder patterns — image may be too corrupted');
  }

  const { blockSize, gridW, gridH } = detection;

  // 3. Read block grid
  const grid = readBlocks(rgb, width, height, blockSize, gridW, gridH);

  // 4. Compute layout (same algorithm as encoding)
  const finderFootprint = FINDER_SIZE + QUIET_ZONE;
  const reserved = new Uint8Array(gridW * gridH);
  for (let y = 0; y < finderFootprint; y++) {
    for (let x = 0; x < finderFootprint; x++) {
      reserved[y * gridW + x] = 1;
    }
  }
  for (let y = 0; y < finderFootprint; y++) {
    for (let x = gridW - finderFootprint; x < gridW; x++) {
      reserved[y * gridW + x] = 1;
    }
  }
  for (let y = gridH - finderFootprint; y < gridH; y++) {
    for (let x = 0; x < finderFootprint; x++) {
      reserved[y * gridW + x] = 1;
    }
  }
  for (let y = gridH - finderFootprint; y < gridH; y++) {
    for (let x = gridW - finderFootprint; x < gridW; x++) {
      reserved[y * gridW + x] = 1;
    }
  }

  const dataPositions: Array<[number, number]> = [];
  for (let y = 0; y < gridH; y++) {
    const rowBase = y * gridW;
    for (let x = 0; x < gridW; x++) {
      if (!reserved[rowBase + x]) {
        dataPositions.push([x, y]);
      }
    }
  }

  // 5. Extract bits from data positions
  const bits = new Uint8Array(dataPositions.length);
  for (let i = 0; i < dataPositions.length; i++) {
    const [bx, by] = dataPositions[i];
    if (by < grid.length && bx < grid[by].length) {
      bits[i] = grid[by][bx] === 0 ? 1 : 0; // black = 1, white = 0
    }
  }

  // 6. Convert bits to bytes
  const allBytes = bitsToBytes(bits);

  // 7. Parse header (first 14 bytes)
  const header = decodeHeader(allBytes);
  if (!header) {
    throw new Error('Invalid robust image header — data may be corrupted');
  }

  // 8. Extract ECC-protected payload
  const eccData = Buffer.from(allBytes.subarray(14));

  // 9. Decode ECC
  const { data, totalCorrected } = eccDecode(eccData);

  // 10. Trim to original length
  return {
    data: data.subarray(0, header.dataLen),
    correctedErrors: totalCorrected,
  };
}

/**
 * Check if a PNG buffer contains a robust-image-encoded payload.
 * Looks for finder patterns in the corners.
 */
export function isRobustImage(png: Buffer): boolean {
  try {
    if (!native?.sharpMetadata || !native?.sharpToRaw) return false;
    const meta = native.sharpMetadata(png);
    const raw = native.sharpToRaw(png);
    const rgb = Buffer.from(raw.pixels);
    return detectFinderPatterns(rgb, meta.width, meta.height) !== null;
  } catch {
    return false;
  }
}

// ─── Fallback PNG Encoder ───────────────────────────────────────────────────

/**
 * Minimal PNG encoder for when the native module is unavailable.
 * Uses uncompressed IDAT (zlib stored blocks).
 */
function manualPngEncode(rgb: Buffer, width: number, height: number): Buffer {
  const zlib = require('zlib');

  // Build raw image data with filter byte (0 = None) per row
  const bytesPerRow = width * 3;
  const rawData = Buffer.alloc(height * (1 + bytesPerRow));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + bytesPerRow)] = 0; // filter: None
    rgb.copy(
      rawData,
      y * (1 + bytesPerRow) + 1,
      y * bytesPerRow,
      (y + 1) * bytesPerRow,
    );
  }

  const deflated = zlib.deflateSync(rawData, { level: 0 });

  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  function pngChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);

    const combined = Buffer.concat([typeBuf, data]);
    const { crc32: crc32Fn } = require('./crc.js');
    const crcVal = crc32Fn(data, crc32Fn(typeBuf));
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crcVal >>> 0, 0);

    return Buffer.concat([length, combined, crcBuf]);
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflated),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
