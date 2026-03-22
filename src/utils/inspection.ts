import * as zlib from 'zlib';
import {
  CHUNK_TYPE,
  ENC_AES,
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
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return (parsedFiles as string[]).sort();
}

function tryExtractFileListFromChunks(chunks: any[]): { name: string; size: number }[] | string[] | null {
  const rxfl = chunks.find((c: any) => c.name === 'rXFL');
  if (rxfl) {
    return parseFileList(JSON.parse(Buffer.from(rxfl.data).toString('utf8')));
  }

  const meta = chunks.find((c: any) => c.name === CHUNK_TYPE);
  if (meta) {
    const dataBuf = Buffer.from(meta.data);
    const markerIdx = dataBuf.indexOf(Buffer.from('rXFL'));
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

export async function listFilesInPng(
  pngBuf: Buffer,
  opts: { includeSizes?: boolean } = {},
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
        let buffer = Buffer.alloc(0);
        let resolved = false;

        inflate.on('data', (chunk: Buffer) => {
          if (resolved) return;
          buffer = Buffer.concat([buffer, chunk]);

          const cleanBuffer = Buffer.alloc(buffer.length);
          let cleanPtr = 0;
          let ptr = 0;

          while (ptr < buffer.length) {
            const rowPos = ptr % rowLen;
            if (rowPos === 0) {
              ptr++;
            } else {
              const remainingInRow = rowLen - rowPos;
              const available = buffer.length - ptr;
              const toCopy = Math.min(remainingInRow, available);
              buffer.copy(cleanBuffer, cleanPtr, ptr, ptr + toCopy);
              cleanPtr += toCopy;
              ptr += toCopy;
            }
          }

          const validClean = cleanBuffer.slice(0, cleanPtr);
          if (validClean.length < 12) return;
          if (!validClean.slice(8, 12).equals(PIXEL_MAGIC)) {
            resolved = true;
            inflate.destroy();
            resolve(null);
            return;
          }

          let idx = 12;
          if (validClean.length < idx + 2) return;
          idx++;
          const nameLen = validClean[idx++];
          if (validClean.length < idx + nameLen + 4) return;
          idx += nameLen;
          idx += 4;
          if (validClean.length < idx + 4) return;

          if (validClean.slice(idx, idx + 4).toString('utf8') === 'rXFL') {
            idx += 4;
            if (validClean.length < idx + 4) return;
            const jsonLen = validClean.readUInt32BE(idx);
            idx += 4;
            if (validClean.length < idx + jsonLen) return;
            try {
              resolved = true;
              inflate.destroy();
              resolve(parseFileList(JSON.parse(validClean.slice(idx, idx + jsonLen).toString('utf8'))));
            } catch {
              resolve(null);
            }
          } else {
            resolved = true;
            inflate.destroy();
            resolve(null);
          }
        });

        inflate.on('error', () => { if (!resolved) resolve(null); });
        inflate.on('end', () => { if (!resolved) resolve(null); });

        for (const chunk of idatChunks) {
          if (resolved) break;
          inflate.write(Buffer.from(chunk.data));
        }
        inflate.end();
      });

      if (files) return files;
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
      return flag === ENC_AES || flag === ENC_XOR;
    }

    const chunks = native.extractPngChunks(pngBuf);

    const target = chunks.find((c: any) => c.name === CHUNK_TYPE);
    if (target) {
      const data = Buffer.isBuffer(target.data) ? target.data : Buffer.from(target.data as Uint8Array);
      if (data.length >= 1) {
        const nameLen = data.readUInt8(0);
        const payloadStart = 1 + nameLen;
        if (payloadStart < data.length) {
          return data[payloadStart] === ENC_AES || data[payloadStart] === ENC_XOR;
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
        let buffer = Buffer.alloc(0);
        let resolved = false;

        inflate.on('data', (chunk: Buffer) => {
          if (resolved) return;
          buffer = Buffer.concat([buffer, chunk]);

          const cleanBuffer = Buffer.alloc(buffer.length);
          let cleanPtr = 0;
          let ptr = 0;
          while (ptr < buffer.length) {
            const rowPos = ptr % rowLen;
            if (rowPos === 0) { ptr++; }
            else {
              const rem = rowLen - rowPos;
              const avail = buffer.length - ptr;
              const toCopy = Math.min(rem, avail);
              buffer.copy(cleanBuffer, cleanPtr, ptr, ptr + toCopy);
              cleanPtr += toCopy;
              ptr += toCopy;
            }
          }

          const valid = cleanBuffer.slice(0, cleanPtr);
          if (valid.length < 12) return;
          if (!valid.slice(8, 12).equals(PIXEL_MAGIC)) {
            resolved = true;
            inflate.destroy();
            resolve(false);
            return;
          }

          let idx = 12;
          if (valid.length < idx + 2) return;
          idx++;
          const nameLen = valid[idx++];
          if (valid.length < idx + nameLen + 4) return;
          idx += nameLen;

          if (valid.length < idx + 4 + 1) return;
          const payloadLen = valid.readUInt32BE(idx);
          idx += 4;

          if (valid.length < idx + 1) return;
          const flag = valid[idx];
          resolved = true;
          inflate.destroy();
          resolve(flag === ENC_AES || flag === ENC_XOR);
        });

        inflate.on('error', () => { if (!resolved) resolve(false); });
        inflate.on('end', () => { if (!resolved) resolve(false); });

        for (const chunk of idatChunks) {
          if (resolved) break;
          inflate.write(Buffer.from(chunk.data));
        }
        inflate.end();
      });
    }
  } catch (e) { }
  return false;
}
