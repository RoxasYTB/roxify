import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { unpackBuffer } from '../pack.js';
import {
  CHUNK_TYPE,
  MAGIC,
  MARKER_END,
  MARKER_START,
  PIXEL_MAGIC,
  PIXEL_MAGIC_BLOCK,
  PNG_HEADER,
} from './constants.js';
import {
  DataFormatError,
  IncorrectPassphraseError,
  PassphraseRequiredError,
} from './errors.js';
import { colorsToBytes, deltaDecode, tryDecryptIfNeeded } from './helpers.js';
import { native } from './native.js';
import { cropAndReconstitute } from './reconstitution.js';
import { DecodeOptions, DecodeResult } from './types.js';
import { parallelZstdDecompress, tryZstdDecompress } from './zstd.js';

async function tryDecompress(
  payload: Buffer,
  onProgress?: (info: {
    phase: string;
    loaded?: number;
    total?: number;
  }) => void,
): Promise<Buffer> {
  return await parallelZstdDecompress(payload, onProgress);
}

function detectImageFormat(buf: Buffer): 'png' | 'webp' | 'jxl' | 'unknown' {
  if (buf.length < 12) return 'unknown';

  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return 'png';
  }

  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp';
  }

  if (buf[0] === 0xff && buf[1] === 0x0a) {
    return 'jxl';
  }

  return 'unknown';
}

function convertToPng(buf: Buffer, format: 'webp' | 'jxl'): Buffer {
  const tempDir = mkdtempSync(join(tmpdir(), 'rox-decode-'));
  const inputPath = join(
    tempDir,
    format === 'webp' ? 'input.webp' : 'input.jxl',
  );
  const outputPath = join(tempDir, 'output.png');

  try {
    writeFileSync(inputPath, buf);

    if (format === 'webp') {
      execFileSync('dwebp', [inputPath, '-o', outputPath]);
    } else if (format === 'jxl') {
      execFileSync('djxl', [inputPath, outputPath]);
    }

    const pngBuf = readFileSync(outputPath);
    return pngBuf;
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

export async function decodePngToBinary(
  input: Buffer | string,
  opts: DecodeOptions = {},
): Promise<DecodeResult> {
  let pngBuf: Buffer;
  if (Buffer.isBuffer(input)) {
    pngBuf = input;
  } else {
    try {
      if (native?.sharpMetadata) {
        const inputBuf = readFileSync(input);
        const metadata = native.sharpMetadata(inputBuf);
        const rawBytesEstimate = metadata.width * metadata.height * 4;
        const MAX_RAW_BYTES = 200 * 1024 * 1024;

        if (rawBytesEstimate > MAX_RAW_BYTES) {
          pngBuf = inputBuf;
        } else {
          pngBuf = inputBuf;
        }
      } else {
        pngBuf = readFileSync(input);
      }
    } catch (e) {
      try {
        pngBuf = readFileSync(input);
      } catch (e2) {
        throw e;
      }
    }
  }

  let progressBar: any = null;
  if (opts.showProgress) {
    progressBar = {
      start: () => {},
      update: () => {},
      stop: () => {},
    };
    const startTime = Date.now();
    if (!opts.onProgress) {
      opts.onProgress = (info) => {
        let pct = 0;
        if (info.phase === 'start') {
          pct = 10;
        } else if (info.phase === 'decompress') {
          pct = 50;
        } else if (info.phase === 'done') {
          pct = 100;
        }
      };
    }
  }

  if (opts.onProgress) opts.onProgress({ phase: 'start' });

  let processedBuf = pngBuf;

  try {
    if (native?.sharpMetadata) {
      const info = native.sharpMetadata(pngBuf);
      if (info.width && info.height) {
        const MAX_RAW_BYTES = 1200 * 1024 * 1024;
        const rawBytesEstimate = info.width * info.height * 4;
        if (rawBytesEstimate > MAX_RAW_BYTES) {
          throw new DataFormatError(
            `Image too large to decode in-process (${Math.round(
              rawBytesEstimate / 1024 / 1024,
            )} MB). Increase Node heap or use a smaller image/compact mode.`,
          );
        }
      }
    }
    processedBuf = pngBuf;
  } catch (e) {
    if (e instanceof DataFormatError) throw e;
  }

  if (opts.onProgress) opts.onProgress({ phase: 'processed' });

  if (processedBuf.subarray(0, MAGIC.length).equals(MAGIC)) {
    const d = processedBuf.subarray(MAGIC.length);
    const nameLen = d[0];
    let idx = 1;
    let name: string | undefined;
    if (nameLen > 0) {
      name = d.subarray(idx, idx + nameLen).toString('utf8');
      idx += nameLen;
    }
    const rawPayload = d.subarray(idx);
    let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);

    if (opts.onProgress) opts.onProgress({ phase: 'decompress_start' });
    try {
      payload = await tryDecompress(payload, (info) => {
        if (opts.onProgress) opts.onProgress(info);
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (opts.passphrase)
        throw new IncorrectPassphraseError(
          'Incorrect passphrase (compact mode, zstd failed: ' + errMsg + ')',
        );
      throw new DataFormatError(
        'Compact mode zstd decompression failed: ' + errMsg,
      );
    }

    if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error(
        'Invalid ROX format (ROX direct: missing ROX1 magic after decompression)',
      );
    }

    payload = payload.subarray(MAGIC.length);
    if (opts.onProgress) opts.onProgress({ phase: 'done' });
    progressBar?.stop();
    return { buf: payload, meta: { name } };
  }

  let chunks: Array<{ name: string; data: Buffer }> = [];
  try {
    if (native?.extractPngChunks) {
      const chunksRaw = native.extractPngChunks(processedBuf);
      chunks = chunksRaw.map((c: any) => ({
        name: c.name,
        data: Buffer.from(c.data),
      }));
    } else {
      throw new Error('Native PNG chunk extraction not available');
    }
  } catch (e) {
    try {
      const withHeader = Buffer.concat([PNG_HEADER, pngBuf]);

      if (native?.extractPngChunks) {
        const chunksRaw = native.extractPngChunks(withHeader);
        chunks = chunksRaw.map((c: any) => ({
          name: c.name,
          data: Buffer.from(c.data),
        }));
      } else {
        throw new Error('Native PNG chunk extraction not available');
      }
    } catch (e2) {
      chunks = [];
    }
  }

  const target = chunks.find((c) => c.name === CHUNK_TYPE);
  if (target) {
    const d = target.data;
    const nameLen = d[0];
    let idx = 1;
    let name: string | undefined;
    if (nameLen > 0) {
      name = d.slice(idx, idx + nameLen).toString('utf8');
      idx += nameLen;
    }
    const rawPayload = d.slice(idx);
    if (rawPayload.length === 0)
      throw new DataFormatError('Compact mode payload empty');
    let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);

    if (opts.onProgress) opts.onProgress({ phase: 'decompress_start' });
    try {
      payload = await tryZstdDecompress(payload, (info) => {
        if (opts.onProgress) opts.onProgress(info);
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (opts.passphrase)
        throw new IncorrectPassphraseError(
          'Incorrect passphrase (compact mode, zstd failed: ' + errMsg + ')',
        );
      throw new DataFormatError(
        'Compact mode zstd decompression failed: ' + errMsg,
      );
    }
    if (!payload.slice(0, MAGIC.length).equals(MAGIC)) {
      throw new DataFormatError(
        'Invalid ROX format (compact mode: missing ROX1 magic after decompression)',
      );
    }

    payload = payload.slice(MAGIC.length);
    if (opts.files) {
      const unpacked = unpackBuffer(payload, opts.files);
      if (unpacked) {
        if (opts.onProgress) opts.onProgress({ phase: 'done' });
        progressBar?.stop();
        return { files: unpacked.files, meta: { name } };
      }
    }
    if (opts.onProgress) opts.onProgress({ phase: 'done' });
    progressBar?.stop();
    return { buf: payload, meta: { name } };
  }

  try {
    const metadata = native.sharpMetadata(processedBuf);
    const currentWidth = metadata.width;
    const currentHeight = metadata.height;

    let rawRGB: Buffer = Buffer.alloc(0);
    let isBlockEncoded = false;

    if (currentWidth % 2 === 0 && currentHeight % 2 === 0) {
      const rawData = native.sharpToRaw(processedBuf);
      const testData = rawData.pixels;

      let hasBlockPattern = true;
      for (let y = 0; y < Math.min(2, currentHeight / 2); y++) {
        for (let x = 0; x < Math.min(2, currentWidth / 2); x++) {
          const px00 = (y * 2 * currentWidth + x * 2) * 3;
          const px01 = (y * 2 * currentWidth + (x * 2 + 1)) * 3;
          const px10 = ((y * 2 + 1) * currentWidth + x * 2) * 3;
          const px11 = ((y * 2 + 1) * currentWidth + (x * 2 + 1)) * 3;

          if (
            testData[px00] !== testData[px01] ||
            testData[px00] !== testData[px10] ||
            testData[px00] !== testData[px11] ||
            testData[px00 + 1] !== testData[px01 + 1] ||
            testData[px00 + 1] !== testData[px10 + 1] ||
            testData[px00 + 1] !== testData[px11 + 1]
          ) {
            hasBlockPattern = false;
            break;
          }
        }
        if (!hasBlockPattern) break;
      }

      if (hasBlockPattern) {
        isBlockEncoded = true;
        const blocksWide = currentWidth / 2;
        const blocksHigh = currentHeight / 2;
        rawRGB = Buffer.alloc(blocksWide * blocksHigh * 3);

        const fullRaw = native.sharpToRaw(processedBuf);
        const fullData = fullRaw.pixels;

        let outIdx = 0;
        for (let by = 0; by < blocksHigh; by++) {
          for (let bx = 0; bx < blocksWide; bx++) {
            const pixelOffset = (by * 2 * currentWidth + bx * 2) * 3;
            rawRGB[outIdx++] = fullData[pixelOffset];
            rawRGB[outIdx++] = fullData[pixelOffset + 1];
            rawRGB[outIdx++] = fullData[pixelOffset + 2];
          }
        }
      }
    }

    if (!isBlockEncoded) {
      const rawData = native.sharpToRaw(processedBuf);
      rawRGB = Buffer.from(rawData.pixels);

      if (opts.onProgress) {
        opts.onProgress({
          phase: 'extract_pixels',
          loaded: currentHeight,
          total: currentHeight,
        });
      }
    }

    const firstPixels: Array<{ r: number; g: number; b: number }> = [];
    for (let i = 0; i < Math.min(MARKER_START.length, rawRGB.length / 3); i++) {
      firstPixels.push({
        r: rawRGB[i * 3],
        g: rawRGB[i * 3 + 1],
        b: rawRGB[i * 3 + 2],
      });
    }

    let hasMarkerStart = false;
    if (firstPixels.length === MARKER_START.length) {
      hasMarkerStart = true;
      for (let i = 0; i < MARKER_START.length; i++) {
        if (
          firstPixels[i].r !== MARKER_START[i].r ||
          firstPixels[i].g !== MARKER_START[i].g ||
          firstPixels[i].b !== MARKER_START[i].b
        ) {
          hasMarkerStart = false;
          break;
        }
      }
    }

    let hasPixelMagic = false;
    let hasBlockMagic = false;
    if (rawRGB.length >= 8 + PIXEL_MAGIC.length) {
      const widthFromDim = rawRGB.readUInt32BE(0);
      const heightFromDim = rawRGB.readUInt32BE(4);
      if (
        widthFromDim === currentWidth &&
        heightFromDim === currentHeight &&
        rawRGB.slice(8, 8 + PIXEL_MAGIC.length).equals(PIXEL_MAGIC)
      ) {
        hasPixelMagic = true;
      } else if (
        rawRGB.slice(8, 8 + PIXEL_MAGIC_BLOCK.length).equals(PIXEL_MAGIC_BLOCK)
      ) {
        hasBlockMagic = true;
      }
    }

    let logicalWidth: number;
    let logicalHeight: number;
    let logicalData: Buffer;

    if (hasMarkerStart || hasPixelMagic || hasBlockMagic) {
      logicalWidth = currentWidth;
      logicalHeight = currentHeight;
      logicalData = rawRGB;
    } else {
      if (process.env.ROX_DEBUG || opts.debugDir) {
        console.log(
          'DEBUG: about to call cropAndReconstitute, debugDir=',
          opts.debugDir,
        );
      }
      const reconstructed = await cropAndReconstitute(
        processedBuf,
        opts.debugDir,
      );
      if (process.env.ROX_DEBUG || opts.debugDir) {
        console.log(
          'DEBUG: cropAndReconstitute returned, reconstructed len=',
          reconstructed.length,
        );
      }

      const rawData = native.sharpToRaw(reconstructed);
      if (process.env.ROX_DEBUG || opts.debugDir) {
        console.log(
          'DEBUG: rawData from reconstructed:',
          rawData.width,
          'x',
          rawData.height,
          'pixels=',
          Math.floor(rawData.pixels.length / 3),
        );
      }
      logicalWidth = rawData.width;
      logicalHeight = rawData.height;
      logicalData = Buffer.from(rawData.pixels);
    }
    if (process.env.ROX_DEBUG) {
      console.log(
        'DEBUG: Logical grid reconstructed:',
        logicalWidth,
        'x',
        logicalHeight,
        '=',
        logicalWidth * logicalHeight,
        'pixels',
      );
    }

    if (hasPixelMagic) {
      if (logicalData.length < 8 + PIXEL_MAGIC.length) {
        throw new DataFormatError('Pixel mode data too short');
      }

      let idx = 8 + PIXEL_MAGIC.length;
      const version = logicalData[idx++];
      const nameLen = logicalData[idx++];
      let name: string | undefined;
      if (nameLen > 0 && nameLen < 256) {
        name = logicalData.slice(idx, idx + nameLen).toString('utf8');
        idx += nameLen;
      }

      const payloadLen = logicalData.readUInt32BE(idx);
      idx += 4;

      const available = logicalData.length - idx;
      if (available < payloadLen) {
        throw new DataFormatError(
          `Pixel payload truncated: expected ${payloadLen} bytes but only ${available} available`,
        );
      }

      const rawPayload = logicalData.slice(idx, idx + payloadLen);
      let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);

      try {
        payload = await tryZstdDecompress(payload, (info) => {
          if (opts.onProgress) opts.onProgress(info);
        });
        if (version === 3) {
          payload = deltaDecode(payload);
        }
      } catch (e) {}

      if (!payload.slice(0, MAGIC.length).equals(MAGIC)) {
        throw new DataFormatError(
          'Invalid ROX format (pixel mode: missing ROX1 magic after decompression)',
        );
      }

      payload = payload.slice(MAGIC.length);
      return { buf: payload, meta: { name } };
    }

    const totalPixels = (logicalData.length / 3) | 0;

    let startIdx = -1;
    for (let i = 0; i <= totalPixels - MARKER_START.length; i++) {
      let match = true;
      for (let mi = 0; mi < MARKER_START.length && match; mi++) {
        const offset = (i + mi) * 3;
        if (
          logicalData[offset] !== MARKER_START[mi].r ||
          logicalData[offset + 1] !== MARKER_START[mi].g ||
          logicalData[offset + 2] !== MARKER_START[mi].b
        ) {
          match = false;
        }
      }
      if (match) {
        startIdx = i;
        break;
      }
    }

    if (startIdx === -1) {
      if (process.env.ROX_DEBUG) {
        console.log(
          'DEBUG: MARKER_START not found in grid of',
          totalPixels,
          'pixels',
        );
        console.log('DEBUG: Trying 2D scan for START marker...');
      }

      let found2D = false;
      for (let y = 0; y < logicalHeight && !found2D; y++) {
        for (
          let x = 0;
          x <= logicalWidth - MARKER_START.length && !found2D;
          x++
        ) {
          let match = true;
          for (let mi = 0; mi < MARKER_START.length && match; mi++) {
            const idx = (y * logicalWidth + (x + mi)) * 3;
            if (
              idx + 2 >= logicalData.length ||
              logicalData[idx] !== MARKER_START[mi].r ||
              logicalData[idx + 1] !== MARKER_START[mi].g ||
              logicalData[idx + 2] !== MARKER_START[mi].b
            ) {
              match = false;
            }
          }
          if (match) {
            if (process.env.ROX_DEBUG) {
              console.log(`DEBUG: Found START marker in 2D at (${x}, ${y})`);
            }

            let endX = x + MARKER_START.length - 1;
            let endY = y;
            for (let scanY = y; scanY < logicalHeight; scanY++) {
              let rowHasData = false;
              for (let scanX = x; scanX < logicalWidth; scanX++) {
                const scanIdx = (scanY * logicalWidth + scanX) * 3;
                if (scanIdx + 2 < logicalData.length) {
                  const r = logicalData[scanIdx];
                  const g = logicalData[scanIdx + 1];
                  const b = logicalData[scanIdx + 2];

                  const isBackground =
                    (r === 100 && g === 120 && b === 110) ||
                    (r === 0 && g === 0 && b === 0) ||
                    (r >= 50 &&
                      r <= 220 &&
                      g >= 50 &&
                      g <= 220 &&
                      b >= 50 &&
                      b <= 220 &&
                      Math.abs(r - g) < 70 &&
                      Math.abs(r - b) < 70 &&
                      Math.abs(g - b) < 70);

                  if (!isBackground) {
                    rowHasData = true;
                    if (scanX > endX) {
                      endX = scanX;
                    }
                  }
                }
              }

              if (rowHasData) {
                endY = scanY;
              } else if (scanY > y) {
                break;
              }
            }
            const rectWidth = endX - x + 1;
            const rectHeight = endY - y + 1;

            if (process.env.ROX_DEBUG) {
              console.log(
                `DEBUG: Extracted rectangle: ${rectWidth}x${rectHeight} from (${x},${y})`,
              );
            }

            const newDataLen = rectWidth * rectHeight * 3;
            const newData = Buffer.allocUnsafe(newDataLen);
            let writeIdx = 0;
            for (let ry = y; ry <= endY; ry++) {
              for (let rx = x; rx <= endX; rx++) {
                const idx = (ry * logicalWidth + rx) * 3;
                newData[writeIdx++] = logicalData[idx];
                newData[writeIdx++] = logicalData[idx + 1];
                newData[writeIdx++] = logicalData[idx + 2];
              }
            }

            logicalData = newData;
            logicalWidth = rectWidth;
            logicalHeight = rectHeight;

            startIdx = 0;
            found2D = true;
          }
        }
      }

      if (!found2D) {
        if (process.env.ROX_DEBUG) {
          const first20 = [];
          for (let i = 0; i < Math.min(20, totalPixels); i++) {
            const offset = i * 3;
            first20.push(
              `(${logicalData[offset]},${logicalData[offset + 1]},${
                logicalData[offset + 2]
              })`,
            );
          }
          console.log('DEBUG: First 20 pixels:', first20.join(' '));
        }
        throw new Error('Marker START not found - image format not supported');
      }
    }

    if (process.env.ROX_DEBUG && startIdx === 0) {
      console.log(
        `DEBUG: MARKER_START at index ${startIdx}, grid size: ${totalPixels}`,
      );
    }

    const dataStartPixel = startIdx + MARKER_START.length + 1;

    const curTotalPixels = (logicalData.length / 3) | 0;

    if (curTotalPixels < dataStartPixel + MARKER_END.length) {
      if (process.env.ROX_DEBUG) {
        console.log('DEBUG: grid too small:', curTotalPixels, 'pixels');
      }
      throw new Error(
        'Marker START or END not found - image format not supported',
      );
    }

    for (let i = 0; i < MARKER_START.length; i++) {
      const offset = (startIdx + i) * 3;
      if (
        logicalData[offset] !== MARKER_START[i].r ||
        logicalData[offset + 1] !== MARKER_START[i].g ||
        logicalData[offset + 2] !== MARKER_START[i].b
      ) {
        throw new Error('Marker START not found - image format not supported');
      }
    }

    let compression: 'zstd' = 'zstd';
    if (curTotalPixels > startIdx + MARKER_START.length) {
      const compOffset = (startIdx + MARKER_START.length) * 3;
      const compPixel = {
        r: logicalData[compOffset],
        g: logicalData[compOffset + 1],
        b: logicalData[compOffset + 2],
      };
      if (compPixel.r === 0 && compPixel.g === 255 && compPixel.b === 0) {
        compression = 'zstd';
      } else {
        compression = 'zstd';
      }
    }

    if (process.env.ROX_DEBUG) {
      console.log(`DEBUG: Detected compression: ${compression}`);
    }

    let endStartPixel = -1;

    const lastLineStart = (logicalHeight - 1) * logicalWidth;
    const endMarkerStartCol = logicalWidth - MARKER_END.length;

    if (lastLineStart + endMarkerStartCol < curTotalPixels) {
      let matchEnd = true;
      for (let mi = 0; mi < MARKER_END.length && matchEnd; mi++) {
        const pixelIdx = lastLineStart + endMarkerStartCol + mi;
        if (pixelIdx >= curTotalPixels) {
          matchEnd = false;
          break;
        }
        const offset = pixelIdx * 3;
        if (
          logicalData[offset] !== MARKER_END[mi].r ||
          logicalData[offset + 1] !== MARKER_END[mi].g ||
          logicalData[offset + 2] !== MARKER_END[mi].b
        ) {
          matchEnd = false;
        }
      }

      if (matchEnd) {
        endStartPixel = lastLineStart + endMarkerStartCol - startIdx;
        if (process.env.ROX_DEBUG) {
          console.log(
            `DEBUG: Found END marker at last line, col ${endMarkerStartCol}`,
          );
        }
      }
    }

    if (endStartPixel === -1) {
      if (process.env.ROX_DEBUG) {
        console.log('DEBUG: END marker not found at expected position');
        const lastLinePixels = [];
        for (
          let i = Math.max(0, lastLineStart);
          i < curTotalPixels && i < lastLineStart + 20;
          i++
        ) {
          const offset = i * 3;
          lastLinePixels.push(
            `(${logicalData[offset]},${logicalData[offset + 1]},${
              logicalData[offset + 2]
            })`,
          );
        }
        console.log('DEBUG: Last line pixels:', lastLinePixels.join(' '));
      }
      endStartPixel = curTotalPixels - startIdx;
    }

    const dataPixelCount = endStartPixel - (MARKER_START.length + 1);
    const pixelBytes = Buffer.allocUnsafe(dataPixelCount * 3);

    for (let i = 0; i < dataPixelCount; i++) {
      const srcOffset = (dataStartPixel + i) * 3;
      const dstOffset = i * 3;
      pixelBytes[dstOffset] = logicalData[srcOffset];
      pixelBytes[dstOffset + 1] = logicalData[srcOffset + 1];
      pixelBytes[dstOffset + 2] = logicalData[srcOffset + 2];
    }

    if (process.env.ROX_DEBUG) {
      console.log('DEBUG: extracted len', pixelBytes.length);
      console.log(
        'DEBUG: extracted head',
        pixelBytes.slice(0, 32).toString('hex'),
      );
      const found = pixelBytes.indexOf(PIXEL_MAGIC);
      console.log('DEBUG: PIXEL_MAGIC index:', found);
      if (found !== -1) {
        console.log(
          'DEBUG: PIXEL_MAGIC head:',
          pixelBytes.slice(found, found + 64).toString('hex'),
        );
        const markerEndBytes = colorsToBytes(MARKER_END);
        console.log(
          'DEBUG: MARKER_END index:',
          pixelBytes.indexOf(markerEndBytes),
        );
      }

      if (opts.debugDir) {
        try {
          console.log('DEBUG: writing extracted pixel bytes to', opts.debugDir);
          writeFileSync(
            join(opts.debugDir, 'extracted-pixel-bytes.bin'),
            pixelBytes,
          );
          writeFileSync(
            join(opts.debugDir, 'extracted-pixel-head.hex'),
            pixelBytes.slice(0, 512).toString('hex'),
          );
        } catch (e) {
          console.log(
            'DEBUG: failed writing extracted bytes',
            (e as any)?.message ?? e,
          );
        }
      }
    }

    try {
      let idx = 0;

      if (pixelBytes.length >= PIXEL_MAGIC.length) {
        const at0 = pixelBytes.slice(0, PIXEL_MAGIC.length).equals(PIXEL_MAGIC);
        const at0Block = pixelBytes
          .slice(0, PIXEL_MAGIC_BLOCK.length)
          .equals(PIXEL_MAGIC_BLOCK);
        if (at0) {
          idx = PIXEL_MAGIC.length;
        } else if (at0Block) {
          idx = PIXEL_MAGIC_BLOCK.length;
        } else {
          const found = pixelBytes.indexOf(PIXEL_MAGIC);
          const foundBlock = pixelBytes.indexOf(PIXEL_MAGIC_BLOCK);
          if (found !== -1) {
            idx = found + PIXEL_MAGIC.length;
          } else if (foundBlock !== -1) {
            idx = foundBlock + PIXEL_MAGIC_BLOCK.length;
          }
        }
      }

      if (idx > 0) {
        const version = pixelBytes[idx++];
        const nameLen = pixelBytes[idx++];
        let name: string | undefined;
        if (nameLen > 0 && nameLen < 256) {
          name = pixelBytes.slice(idx, idx + nameLen).toString('utf8');
          idx += nameLen;
        }

        const payloadLen = pixelBytes.readUInt32BE(idx);
        idx += 4;

        if (idx + 4 <= pixelBytes.length) {
          const marker = pixelBytes.slice(idx, idx + 4).toString('utf8');
          if (marker === 'rXFL') {
            idx += 4;
            if (idx + 4 <= pixelBytes.length) {
              const jsonLen = pixelBytes.readUInt32BE(idx);
              idx += 4;
              idx += jsonLen;
            }
          }
        }

        const available = pixelBytes.length - idx;
        if (available < payloadLen) {
          throw new DataFormatError(
            `Pixel payload truncated: expected ${payloadLen} bytes but only ${available} available`,
          );
        }

        const rawPayload = pixelBytes.slice(idx, idx + payloadLen);
        let payload = tryDecryptIfNeeded(rawPayload, opts.passphrase);

        try {
          payload = await tryDecompress(payload, (info) => {
            if (opts.onProgress) opts.onProgress(info);
          });
          if (version === 3) {
            payload = deltaDecode(payload);
          }
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          if (opts.passphrase)
            throw new IncorrectPassphraseError(
              `Incorrect passphrase (screenshot mode, zstd failed: ` +
                errMsg +
                ')',
            );

          // Fallback: try reconstituting the image and re-extracting the pixels
          try {
            if (process.env.ROX_DEBUG)
              console.log(
                'DEBUG: decompress failed, attempting cropAndReconstitute fallback',
              );
            const reconstructed = await cropAndReconstitute(
              processedBuf,
              opts.debugDir,
            );
            const raw2 = native.sharpToRaw(reconstructed);
            let logicalData2 = Buffer.from(raw2.pixels);
            let logicalWidth2 = raw2.width;
            let logicalHeight2 = raw2.height;

            // find startIdx2 (linear)
            let startIdx2 = -1;
            const totalPixels2 = (logicalData2.length / 3) | 0;
            for (let i2 = 0; i2 <= totalPixels2 - MARKER_START.length; i2++) {
              let match2 = true;
              for (let mi2 = 0; mi2 < MARKER_START.length && match2; mi2++) {
                const offset2 = (i2 + mi2) * 3;
                if (
                  logicalData2[offset2] !== MARKER_START[mi2].r ||
                  logicalData2[offset2 + 1] !== MARKER_START[mi2].g ||
                  logicalData2[offset2 + 2] !== MARKER_START[mi2].b
                ) {
                  match2 = false;
                }
              }
              if (match2) {
                startIdx2 = i2;
                break;
              }
            }

            if (startIdx2 === -1) {
              // try 2D scan
              let found2D2 = false;
              for (let y = 0; y < logicalHeight2 && !found2D2; y++) {
                for (
                  let x = 0;
                  x <= logicalWidth2 - MARKER_START.length && !found2D2;
                  x++
                ) {
                  let match = true;
                  for (let mi = 0; mi < MARKER_START.length && match; mi++) {
                    const idx = (y * logicalWidth2 + (x + mi)) * 3;
                    if (
                      idx + 2 >= logicalData2.length ||
                      logicalData2[idx] !== MARKER_START[mi].r ||
                      logicalData2[idx + 1] !== MARKER_START[mi].g ||
                      logicalData2[idx + 2] !== MARKER_START[mi].b
                    ) {
                      match = false;
                    }
                  }
                  if (match) {
                    // compute rectangle
                    let endX = x + MARKER_START.length - 1;
                    let endY = y;
                    for (let scanY = y; scanY < logicalHeight2; scanY++) {
                      let rowHasData = false;
                      for (let scanX = x; scanX < logicalWidth2; scanX++) {
                        const scanIdx = (scanY * logicalWidth2 + scanX) * 3;
                        if (scanIdx + 2 < logicalData2.length) {
                          const r = logicalData2[scanIdx];
                          const g = logicalData2[scanIdx + 1];
                          const b = logicalData2[scanIdx + 2];

                          const isBackground =
                            (r === 100 && g === 120 && b === 110) ||
                            (r === 0 && g === 0 && b === 0) ||
                            (r >= 50 &&
                              r <= 220 &&
                              g >= 50 &&
                              g <= 220 &&
                              b >= 50 &&
                              b <= 220 &&
                              Math.abs(r - g) < 70 &&
                              Math.abs(r - b) < 70 &&
                              Math.abs(g - b) < 70);

                          if (!isBackground) {
                            rowHasData = true;
                            if (scanX > endX) endX = scanX;
                          }
                        }
                      }

                      if (rowHasData) {
                        endY = scanY;
                      } else if (scanY > y) {
                        break;
                      }
                    }

                    const rectWidth = endX - x + 1;
                    const rectHeight = endY - y + 1;

                    const newDataLen = rectWidth * rectHeight * 3;
                    const newData = Buffer.allocUnsafe(newDataLen);
                    let writeIdx = 0;
                    for (let ry = y; ry <= endY; ry++) {
                      for (let rx = x; rx <= endX; rx++) {
                        const idx = (ry * logicalWidth2 + rx) * 3;
                        newData[writeIdx++] = logicalData2[idx];
                        newData[writeIdx++] = logicalData2[idx + 1];
                        newData[writeIdx++] = logicalData2[idx + 2];
                      }
                    }

                    logicalData2 = newData;
                    logicalWidth2 = rectWidth;
                    logicalHeight2 = rectHeight;

                    startIdx2 = 0;
                    found2D2 = true;
                  }
                }
              }

              if (!found2D2)
                throw new DataFormatError(
                  'Screenshot fallback failed: START not found',
                );
            }

            // compute endStartPixel2
            const curTotalPixels2 = (logicalData2.length / 3) | 0;
            const lastLineStart2 = (logicalHeight2 - 1) * logicalWidth2;
            const endMarkerStartCol2 = logicalWidth2 - MARKER_END.length;

            let endStartPixel2 = -1;
            if (lastLineStart2 + endMarkerStartCol2 < curTotalPixels2) {
              let matchEnd2 = true;
              for (let mi = 0; mi < MARKER_END.length && matchEnd2; mi++) {
                const pixelIdx = lastLineStart2 + endMarkerStartCol2 + mi;
                if (pixelIdx >= curTotalPixels2) {
                  matchEnd2 = false;
                  break;
                }
                const offset = pixelIdx * 3;
                if (
                  logicalData2[offset] !== MARKER_END[mi].r ||
                  logicalData2[offset + 1] !== MARKER_END[mi].g ||
                  logicalData2[offset + 2] !== MARKER_END[mi].b
                ) {
                  matchEnd2 = false;
                }
              }

              if (matchEnd2) {
                endStartPixel2 =
                  lastLineStart2 + endMarkerStartCol2 - startIdx2;
                if (process.env.ROX_DEBUG) {
                  console.log(
                    'DEBUG: Found END marker in fallback at last line',
                  );
                }
              }
            }

            if (endStartPixel2 === -1) {
              if (process.env.ROX_DEBUG) {
                console.log(
                  'DEBUG: END marker not found in fallback; using end of grid',
                );
              }
              endStartPixel2 = curTotalPixels2 - startIdx2;
            }

            const dataPixelCount2 = endStartPixel2 - (MARKER_START.length + 1);
            const pixelBytes2 = Buffer.allocUnsafe(dataPixelCount2 * 3);
            for (let i2 = 0; i2 < dataPixelCount2; i2++) {
              const srcOffset = (startIdx2 + MARKER_START.length + 1 + i2) * 3;
              const dstOffset = i2 * 3;
              pixelBytes2[dstOffset] = logicalData2[srcOffset];
              pixelBytes2[dstOffset + 1] = logicalData2[srcOffset + 1];
              pixelBytes2[dstOffset + 2] = logicalData2[srcOffset + 2];
            }

            // try decompressing fallback payload
            const foundPX = pixelBytes2.indexOf(PIXEL_MAGIC);
            if (process.env.ROX_DEBUG)
              console.log('DEBUG: PIXEL_MAGIC index in fallback:', foundPX);

            if (pixelBytes2.length >= PIXEL_MAGIC.length) {
              let ii = 0;
              const at0 = pixelBytes2
                .slice(0, PIXEL_MAGIC.length)
                .equals(PIXEL_MAGIC);
              if (at0) ii = PIXEL_MAGIC.length;
              else {
                const found = pixelBytes2.indexOf(PIXEL_MAGIC);
                if (found !== -1) ii = found + PIXEL_MAGIC.length;
              }

              if (ii > 0) {
                const version2 = pixelBytes2[ii++];
                const nameLen2 = pixelBytes2[ii++];
                const payloadLen2 = pixelBytes2.readUInt32BE(ii + nameLen2);
                const rawPayload2 = pixelBytes2.slice(
                  ii + nameLen2 + 4,
                  ii + nameLen2 + 4 + payloadLen2,
                );
                let payload2 = tryDecryptIfNeeded(rawPayload2, opts.passphrase);
                payload2 = await tryDecompress(payload2, (info) => {
                  if (opts.onProgress) opts.onProgress(info);
                });

                if (!payload2.slice(0, MAGIC.length).equals(MAGIC)) {
                  throw new DataFormatError(
                    'Screenshot fallback failed: missing ROX1 magic after decompression',
                  );
                }

                payload2 = payload2.slice(MAGIC.length);
                if (opts.files) {
                  const unpacked2 = unpackBuffer(payload2, opts.files);
                  if (unpacked2) {
                    if (opts.onProgress) opts.onProgress({ phase: 'done' });
                    progressBar?.stop();
                    return { files: unpacked2.files, meta: { name } };
                  }
                }

                if (opts.onProgress) opts.onProgress({ phase: 'done' });
                progressBar?.stop();
                return { buf: payload2, meta: { name } };
              }
            }

            throw new DataFormatError(
              'Screenshot mode zstd decompression failed: ' + errMsg,
            );
          } catch (e2) {
            // If fallback fails, rethrow original error
            throw new DataFormatError(
              `Screenshot mode zstd decompression failed: ` + errMsg,
            );
          }
        }

        if (!payload.slice(0, MAGIC.length).equals(MAGIC)) {
          throw new DataFormatError(
            'Invalid ROX format (pixel mode: missing ROX1 magic after decompression)',
          );
        }

        payload = payload.slice(MAGIC.length);
        if (opts.files) {
          const unpacked = unpackBuffer(payload, opts.files);
          if (unpacked) {
            if (opts.onProgress) opts.onProgress({ phase: 'done' });
            progressBar?.stop();
            return { files: unpacked.files, meta: { name } };
          }
        }
        if (opts.onProgress) opts.onProgress({ phase: 'done' });
        progressBar?.stop();
        return { buf: payload, meta: { name } };
      }
    } catch (e) {
      if (
        e instanceof PassphraseRequiredError ||
        e instanceof IncorrectPassphraseError ||
        e instanceof DataFormatError
      ) {
        throw e;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      throw new Error('Failed to extract data from screenshot: ' + errMsg);
    }
  } catch (e) {
    if (
      e instanceof PassphraseRequiredError ||
      e instanceof IncorrectPassphraseError ||
      e instanceof DataFormatError
    ) {
      throw e;
    }
    const errMsg = e instanceof Error ? e.message : String(e);
    throw new Error('Failed to decode PNG: ' + errMsg);
  }
  throw new DataFormatError('No valid data found in image');
}
