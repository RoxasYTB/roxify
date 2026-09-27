import * as zlib from 'zlib';
import {
  CHUNK_TYPE,
  ENC_AES,
  ENC_AES_CTR,
  ENC_XOR,
  MAGIC,
  PIXEL_MAGIC,
} from './constants.js';
import { native } from './native.js';

function parseFileList(parsedFiles: any[]): { name: string; size: number }[] | string[] {
  if (
    parsedFiles.length > 0 &&
    typeof parsedFiles[0] === 'object' &&
    (parsedFiles[0].name || parsedFiles[0].path)
  ) {
    return parsedFiles
      .map((p) => ({ name: p.name ?? p.path, size: typeof p.size === 'number' ? p.size : 0 }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }
  return (parsedFiles as string[]).sort();
}

const RXFL_BUF = Buffer.from('rXFL');

function tryExtractFileListFromChunks(chunks: any[]): { name: string; size: number }[] | string[] | null {
  let rxfl: any = null;
  let meta: any = null;
  for (const c of chunks) {
    if (!rxfl && c.name === 'rXFL') rxfl = c;
    else if (!meta && c.name === CHUNK_TYPE) meta = c;
    if (rxfl && meta) break;
  }
  if (rxfl) {
    return parseFileList(JSON.parse(Buffer.from(rxfl.data).toString('utf8')));
  }

  if (meta) {
    const dataBuf = Buffer.isBuffer(meta.data) ? meta.data : Buffer.from(meta.data);
    const markerIdx = dataBuf.indexOf(RXFL_BUF);
    if (markerIdx !== -1 && markerIdx + 8 <= dataBuf.length) {
      const jsonLen = dataBuf.readUInt32BE(markerIdx + 4);
      const jsonEnd = markerIdx + 8 + jsonLen;
      if (jsonEnd <= dataBuf.length) {
        return parseFileList(JSON.parse(dataBuf.slice(markerIdx + 8, jsonEnd).toString('utf8')));
      }
    }
  }

  return null;
}

/** Incremental scanline-strip parser: O(n) total, no per-event reconcat/refilter. */
class IncrementalPixelProbe {
  private rowLen: number;
  private rowPos = 0;
  private clean: Buffer[];
  private cleanLen = 0;
  private done = false;
  constructor(rowLen: number) {
    this.clean = [];
    this.rowLen = rowLen;
  }
  push(chunk: Buffer): void {
    if (this.done) return;
    // Strip filter bytes on the fly, preserving row alignment across chunks.
    let off = 0;
    while (off < chunk.length) {
      if (this.rowPos === 0) {
        off += 1; // skip filter byte
        this.rowPos = 1;
        if (off > chunk.length) break;
        continue;
      }
      const take = Math.min(this.rowLen - this.rowPos, chunk.length - off);
      this.clean.push(chunk.subarray(off, off + take));
      this.cleanLen += take;
      off += take;
      this.rowPos += take;
      if (this.rowPos === this.rowLen) this.rowPos = 0;
    }
  }
  /** First n clean bytes as one buffer (cheap for small n), or null if short. */
  head(n: number): Buffer | null {
    if (this.cleanLen < n) return null;
    let need = n;
    const parts: Buffer[] = [];
    for (const c of this.clean) {
      if (need <= 0) break;
      const t = c.length > need ? c.subarray(0, need) : c;
      parts.push(t);
      need -= t.length;
    }
    return Buffer.concat(parts, n);
  }
  /** Arbitrary clean slice as one buffer, or null when not fully arrived. */
  range(start: number, end: number): Buffer | null {
    if (end > this.cleanLen || start < 0 || end < start) return null;
    let skip = start;
    let need = end - start;
    const parts: Buffer[] = [];
    for (const c of this.clean) {
      if (need <= 0) break;
      if (skip >= c.length) { skip -= c.length; continue; }
      const t = c.subarray(skip, skip + need);
      parts.push(t);
      need -= t.length;
      skip = 0;
    }
    return Buffer.concat(parts, end - start);
  }
  concatAll(): Buffer {
    return Buffer.concat(this.clean, this.cleanLen);
  }
  get totalClean(): number { return this.cleanLen; }
  markDone(): void { this.done = true; }
  get isDone(): boolean { return this.done; }
}

/**
 * Pixel layout (matches native writers, V1/V2):
 *   markers | 'PXL1' (clean offset 12, legacy 20) | ver u8 | nameLen u8 |
 *   name | payloadLen (u32 BE v1, u64 BE v2) | payload (flag byte first)
 * The rXFL file list, when present in pixels, sits AFTER the payload.
 */
function locatePxl1(head: Buffer): number {
  if (head.length >= 16 && head.subarray(12, 16).equals(PIXEL_MAGIC)) return 12;
  if (head.length >= 24 && head.subarray(20, 24).equals(PIXEL_MAGIC)) return 20;
  return head.indexOf('PXL1');
}

interface PixelHeader {
  payloadStart: number;
  payloadLen: number;
}

function parsePixelHeader(clean: Buffer, pxl1: number): PixelHeader | null {
  if (clean.length < pxl1 + 6) return null;
  const version = clean[pxl1 + 4];
  const nameLen = clean[pxl1 + 5];
  const lenSize = version === 1 ? 4 : version === 2 ? 8 : 0;
  if (lenSize === 0 || clean.length < pxl1 + 6 + nameLen + lenSize) return null;
  const lenOff = pxl1 + 6 + nameLen;
  const payloadLen = lenSize === 4
    ? clean.readUInt32BE(lenOff)
    : Number(clean.readBigUInt64BE(lenOff));
  if (!Number.isSafeInteger(payloadLen)) return null;
  return { payloadStart: lenOff + lenSize, payloadLen };
}

function isEncryptedFlag(flag: number): boolean {
  return flag === ENC_AES || flag === ENC_XOR || flag === ENC_AES_CTR;
}

export async function listFilesInPng(
  pngBuf: Buffer,
  _opts: { includeSizes?: boolean } = {},
): Promise<string[] | { name: string; size: number }[] | null> {
  try {
    const chunks = native.extractPngChunks(pngBuf);
    const result = tryExtractFileListFromChunks(chunks);
    if (result) return result;

    const ihdr = chunks.find((c: any) => c.name === 'IHDR');
    const idatChunks = chunks.filter((c: any) => c.name === 'IDAT');

    if (ihdr && idatChunks.length > 0) {
      const ihdrData = Buffer.from(ihdr.data);
      const width = ihdrData.readUInt32BE(0);
      const rowLen = 1 + width * 3;

      const files = await new Promise<
        string[] | { name: string; size: number }[] | null
      >((resolve) => {
        const inflate = zlib.createInflate();
        const probe = new IncrementalPixelProbe(rowLen);
        let resolved = false;
        const finish = (v: string[] | { name: string; size: number }[] | null) => {
          if (resolved) return;
          resolved = true;
          probe.markDone();
          inflate.destroy();
          resolve(v);
        };

        inflate.on('data', (chunk: Buffer) => {
          if (resolved) return;
          probe.push(chunk);

          // Early exit on magic mismatch once the prefix arrived. The rXFL
          // list sits after the (possibly huge) payload, so full parsing
          // happens once at 'end' — still a single O(n) pass overall.
          if (probe.totalClean >= 64) {
            const head = probe.head(64)!;
            if (locatePxl1(head) < 0) finish(null);
          }
        });

        const parseAtEnd = () => {
          if (resolved) return;
          try {
            const clean = probe.concatAll();
            if (clean.length < 16) { finish(null); return; }
            const pxl1 = locatePxl1(clean.subarray(0, Math.min(clean.length, 1024)));
            if (pxl1 < 0) { finish(null); return; }
            const hdr = parsePixelHeader(clean, pxl1);
            if (!hdr) { finish(null); return; }
            // Scan occurrences after the payload start; the true marker is
            // the trailing one, false positives inside compressed bytes fail
            // JSON.parse below and are skipped.
            let from = hdr.payloadStart;
            while (from < clean.length) {
              const m = clean.indexOf('rXFL', from);
              if (m < 0 || m + 8 > clean.length) break;
              const jsonLen = clean.readUInt32BE(m + 4);
              const jsonEnd = m + 8 + jsonLen;
              if (jsonLen <= 50_000_000 && jsonEnd <= clean.length) {
                try {
                  finish(parseFileList(JSON.parse(clean.subarray(m + 8, jsonEnd).toString('utf8'))));
                  return;
                } catch { /* try next occurrence */ }
              }
              from = m + 4;
            }
            finish(null);
          } catch {
            finish(null);
          }
        };

        inflate.on('error', () => { if (!resolved) resolve(null); });
        inflate.on('end', parseAtEnd);

        for (const chunk of idatChunks) {
          if (resolved) break;
          inflate.write(Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data));
        }
        inflate.end();
      });

      if (files) return files;
    }
  } catch (e) { }

  try {
    const json = native.extractFileListFromPixels(pngBuf);
    if (json) {
      return parseFileList(JSON.parse(json));
    }
  } catch (e) { }

  return null;
}

export async function hasPassphraseInPng(pngBuf: Buffer): Promise<boolean> {
  try {
    if (pngBuf.slice(0, MAGIC.length).equals(MAGIC)) {
      let offset = MAGIC.length;
      if (offset >= pngBuf.length) return false;
      const nameLen = pngBuf.readUInt8(offset);
      offset += 1 + nameLen;
      if (offset >= pngBuf.length) return false;
      const flag = pngBuf[offset];
      return flag === ENC_AES || flag === ENC_XOR || flag === ENC_AES_CTR;
    }

    const chunks = native.extractPngChunks(pngBuf);

    const target = chunks.find((c: any) => c.name === CHUNK_TYPE);
    if (target) {
      const data = Buffer.isBuffer(target.data) ? target.data : Buffer.from(target.data as Uint8Array);
      if (data.length >= 1) {
        const nameLen = data.readUInt8(0);
        const payloadStart = 1 + nameLen;
        if (payloadStart < data.length) {
          return data[payloadStart] === ENC_AES || data[payloadStart] === ENC_XOR || data[payloadStart] === ENC_AES_CTR;
        }
      }
    }

    const ihdr = chunks.find((c: any) => c.name === 'IHDR');
    const idatChunks = chunks.filter((c: any) => c.name === 'IDAT');

    if (ihdr && idatChunks.length > 0) {
      const ihdrData = Buffer.from(ihdr.data);
      const width = ihdrData.readUInt32BE(0);
      const rowLen = 1 + width * 3;

      return await new Promise<boolean>((resolve) => {
        const inflate = zlib.createInflate();
        const probe = new IncrementalPixelProbe(rowLen);
        let resolved = false;
        const finish = (v: boolean) => {
          if (resolved) return;
          resolved = true;
          probe.markDone();
          inflate.destroy();
          resolve(v);
        };

        inflate.on('data', (chunk: Buffer) => {
          if (resolved) return;
          probe.push(chunk);

          // The encryption flag is the first payload byte, right after the
          // tiny header — parse incrementally and exit as soon as it arrives.
          if (probe.totalClean < 16) return;
          const head = probe.head(Math.min(probe.totalClean, 512));
          if (!head) return;
          const pxl1 = locatePxl1(head);
          if (pxl1 < 0) {
            if (probe.totalClean >= 512) finish(false);
            return;
          }
          if (probe.totalClean < pxl1 + 6) return;
          const verName = probe.range(pxl1 + 4, pxl1 + 6)!;
          const lenSize = verName[0] === 1 ? 4 : verName[0] === 2 ? 8 : 0;
          if (lenSize === 0) { finish(false); return; }
          const flagPos = pxl1 + 6 + verName[1] + lenSize;
          const flagByte = probe.range(flagPos, flagPos + 1);
          if (!flagByte) return; // wait for one more byte
          finish(isEncryptedFlag(flagByte[0]));
        });

        inflate.on('error', () => { if (!resolved) resolve(false); });
        inflate.on('end', () => { if (!resolved) resolve(false); });

        for (const chunk of idatChunks) {
          if (resolved) break;
          inflate.write(Buffer.isBuffer(chunk.data) ? chunk.data : Buffer.from(chunk.data));
        }
        inflate.end();
      });
    }
  } catch (e) { }
  return false;
}
