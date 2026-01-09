import {
  compress as zstdCompress,
  decompress as zstdDecompress,
} from '@mongodb-js/zstd';
import encode from 'png-chunks-encode';
import { deflateSync } from 'zlib';

const PIXEL_MAGIC = Buffer.from('MNPG');
const MARKER_START = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, b: 0, g: 255 },
];
const MARKER_END = [...MARKER_START].reverse();

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function zigzagOrderIndices(width: number, height: number): Int32Array {
  const len = width * height;
  const indices = new Int32Array(len);
  let i = 0;
  for (let y = 0; y < height; y++) {
    if (y % 2 === 0) {
      for (let x = 0; x < width; x++) {
        indices[i++] = y * width + x;
      }
    } else {
      for (let x = width - 1; x >= 0; x--) {
        indices[i++] = y * width + x;
      }
    }
  }
  return indices;
}

export async function encodeMinPng(
  rgb: Buffer,
  width: number,
  height: number,
): Promise<Buffer> {
  const w = width,
    h = height;
  const idx = (x: number, y: number) => (y * w + x) * 3;

  const residualR = new Uint8Array(w * h);
  const residualG = new Uint8Array(w * h);
  const residualB = new Uint8Array(w * h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      const r = rgb[i];
      const g = rgb[i + 1];
      const b = rgb[i + 2];
      const leftI = x > 0 ? idx(x - 1, y) : -1;
      const upI = y > 0 ? idx(x, y - 1) : -1;
      const upLeftI = x > 0 && y > 0 ? idx(x - 1, y - 1) : -1;

      const leftR = leftI >= 0 ? rgb[leftI] : 0;
      const upR = upI >= 0 ? rgb[upI] : 0;
      const upLeftR = upLeftI >= 0 ? rgb[upLeftI] : 0;
      const predR = paeth(leftR, upR, upLeftR);
      residualR[y * w + x] = (r - predR + 256) & 0xff;

      const leftG = leftI >= 0 ? rgb[leftI + 1] : 0;
      const upG = upI >= 0 ? rgb[upI + 1] : 0;
      const upLeftG = upLeftI >= 0 ? rgb[upLeftI + 1] : 0;
      const predG = paeth(leftG, upG, upLeftG);
      residualG[y * w + x] = (g - predG + 256) & 0xff;

      const leftB = leftI >= 0 ? rgb[leftI + 2] : 0;
      const upB = upI >= 0 ? rgb[upI + 2] : 0;
      const upLeftB = upLeftI >= 0 ? rgb[upLeftI + 2] : 0;
      const predB = paeth(leftB, upB, upLeftB);
      residualB[y * w + x] = (b - predB + 256) & 0xff;
    }
  }

  const indices = zigzagOrderIndices(w, h);
  const transformed = new Uint8Array(w * h * 3);
  let tIdx = 0;
  for (let i = 0; i < indices.length; i++) {
    const pos = indices[i];
    const g = residualG[pos];
    const r = (residualR[pos] - g + 256) & 0xff;
    const b = (residualB[pos] - g + 256) & 0xff;
    transformed[tIdx++] = g;
    transformed[tIdx++] = r;
    transformed[tIdx++] = b;
  }

  const transformedBuf = Buffer.from(transformed);

  const compressed = Buffer.from(await zstdCompress(transformedBuf, 19));

  const header = Buffer.alloc(4 + 1 + 4 + 4);
  PIXEL_MAGIC.copy(header, 0);
  header[4] = 1;
  header.writeUInt32BE(w, 5);
  header.writeUInt32BE(h, 9);
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(compressed.length, 0);
  const payload = Buffer.concat([header, lenBuf, compressed]);

  const markerStartBytes = Buffer.alloc(MARKER_START.length * 3);
  for (let i = 0; i < MARKER_START.length; i++) {
    markerStartBytes[i * 3] = MARKER_START[i].r;
    markerStartBytes[i * 3 + 1] = MARKER_START[i].g;
    markerStartBytes[i * 3 + 2] = MARKER_START[i].b;
  }
  const markerEndBytes = Buffer.alloc(MARKER_END.length * 3);
  for (let i = 0; i < MARKER_END.length; i++) {
    markerEndBytes[i * 3] = MARKER_END[i].r;
    markerEndBytes[i * 3 + 1] = MARKER_END[i].g;
    markerEndBytes[i * 3 + 2] = MARKER_END[i].b;
  }

  const dataWithMarkers = Buffer.concat([
    markerStartBytes,
    payload,
    markerEndBytes,
  ]);

  const bytesPerPixel = 3;
  const nPixels = Math.ceil(dataWithMarkers.length / bytesPerPixel);
  const side = Math.max(1, Math.ceil(Math.sqrt(nPixels)));
  const widthOut = side;
  const heightOut = Math.ceil(nPixels / widthOut);

  const rowLen = 1 + widthOut * bytesPerPixel;
  const raw = Buffer.alloc(rowLen * heightOut);
  for (let y = 0; y < heightOut; y++) raw[y * rowLen] = 0;
  for (let p = 0; p < nPixels; p++) {
    const srcIdx = p * 3;
    const y = Math.floor(p / widthOut);
    const x = p % widthOut;
    const dst = y * rowLen + 1 + x * 3;
    raw[dst] = srcIdx < dataWithMarkers.length ? dataWithMarkers[srcIdx] : 0;
    raw[dst + 1] =
      srcIdx + 1 < dataWithMarkers.length ? dataWithMarkers[srcIdx + 1] : 0;
    raw[dst + 2] =
      srcIdx + 2 < dataWithMarkers.length ? dataWithMarkers[srcIdx + 2] : 0;
  }

  const idat = deflateSync(raw, { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(widthOut, 0);
  ihdr.writeUInt32BE(heightOut, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const chunks = [
    { name: 'IHDR', data: ihdr },
    { name: 'IDAT', data: idat },
    { name: 'IEND', data: Buffer.alloc(0) },
  ];
  return Buffer.from(encode(chunks));
}

export async function decodeMinPng(
  pngBuf: Buffer,
): Promise<{ buf: Buffer; width: number; height: number } | null> {
  const sharp = await import('sharp');
  const { data, info } = await sharp
    .default(pngBuf)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const currentWidth = info.width as number;
  const currentHeight = info.height as number;

  const rawRGB = Buffer.alloc(currentWidth * currentHeight * 3);
  for (let i = 0; i < currentWidth * currentHeight; i++) {
    rawRGB[i * 3] = data[i * 3];
    rawRGB[i * 3 + 1] = data[i * 3 + 1];
    rawRGB[i * 3 + 2] = data[i * 3 + 2];
  }

  function findMarkerStart(buf: Buffer) {
    for (let i = 0; i <= buf.length - MARKER_START.length * 3; i += 3) {
      let ok = true;
      for (let m = 0; m < MARKER_START.length; m++) {
        const j = i + m * 3;
        if (
          buf[j] !== MARKER_START[m].r ||
          buf[j + 1] !== MARKER_START[m].g ||
          buf[j + 2] !== MARKER_START[m].b
        ) {
          ok = false;
          break;
        }
      }
      if (ok) return i + MARKER_START.length * 3;
    }
    return -1;
  }

  const startIdxBytes = findMarkerStart(rawRGB);
  if (startIdxBytes === -1) return null;

  const headerStart = startIdxBytes;
  if (headerStart + 13 > rawRGB.length) return null;
  if (!rawRGB.subarray(headerStart, headerStart + 4).equals(PIXEL_MAGIC))
    return null;
  const origW = rawRGB.readUInt32BE(headerStart + 5);
  const origH = rawRGB.readUInt32BE(headerStart + 9);
  const compressedLen = rawRGB.readUInt32BE(headerStart + 13);

  const compStart = headerStart + 17;
  if (compStart + compressedLen > rawRGB.length) return null;
  const compressed = rawRGB.subarray(compStart, compStart + compressedLen);

  const decompressed = Buffer.from(await zstdDecompress(compressed));

  const indices = zigzagOrderIndices(origW, origH);
  const residualR = new Uint8Array(origW * origH);
  const residualG = new Uint8Array(origW * origH);
  const residualB = new Uint8Array(origW * origH);

  let p = 0;
  for (let i = 0; i < indices.length; i++) {
    if (p + 3 > decompressed.length) break;
    const g = decompressed[p++];
    const rminusg = decompressed[p++];
    const bminusg = decompressed[p++];
    const pos = indices[i];
    residualG[pos] = g;
    residualR[pos] = (rminusg + g) & 0xff;
    residualB[pos] = (bminusg + g) & 0xff;
  }

  const out = Buffer.alloc(origW * origH * 3);
  for (let y = 0; y < origH; y++) {
    for (let x = 0; x < origW; x++) {
      const pos = y * origW + x;
      const leftPos = x > 0 ? y * origW + (x - 1) : -1;
      const upPos = y > 0 ? (y - 1) * origW + x : -1;
      const upLeftPos = x > 0 && y > 0 ? (y - 1) * origW + (x - 1) : -1;

      const leftR = leftPos >= 0 ? out[leftPos * 3] : 0;
      const upR = upPos >= 0 ? out[upPos * 3] : 0;
      const upLeftR = upLeftPos >= 0 ? out[upLeftPos * 3] : 0;
      const predR = paeth(leftR, upR, upLeftR);
      const r = (residualR[pos] + predR) & 0xff;

      const leftG = leftPos >= 0 ? out[leftPos * 3 + 1] : 0;
      const upG = upPos >= 0 ? out[upPos * 3 + 1] : 0;
      const upLeftG = upLeftPos >= 0 ? out[upLeftPos * 3 + 1] : 0;
      const predG = paeth(leftG, upG, upLeftG);
      const g = (residualG[pos] + predG) & 0xff;

      const leftB = leftPos >= 0 ? out[leftPos * 3 + 2] : 0;
      const upB = upPos >= 0 ? out[upPos * 3 + 2] : 0;
      const upLeftB = upLeftPos >= 0 ? out[upLeftPos * 3 + 2] : 0;
      const predB = paeth(leftB, upB, upLeftB);
      const b = (residualB[pos] + predB) & 0xff;

      out[pos * 3] = r;
      out[pos * 3 + 1] = g;
      out[pos * 3 + 2] = b;
    }
  }

  return { buf: out, width: origW, height: origH };
}

