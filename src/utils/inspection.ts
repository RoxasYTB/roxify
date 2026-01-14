import * as zlib from 'zlib';
import { unpackBuffer } from '../pack';
import {
  CHUNK_TYPE,
  ENC_AES,
  ENC_XOR,
  MAGIC,
  MARKER_COLORS,
  PIXEL_MAGIC,
} from './constants';
import { decodePngToBinary } from './decoder';
import { PassphraseRequiredError } from './errors';
import { native } from './native';
import { cropAndReconstitute } from './reconstitution';

/**
 * List files stored inside a ROX PNG without fully extracting it.
 * Returns `null` if no file list could be found.
 *
 * @param pngBuf - Buffer containing a PNG file.
 * @param opts - Options to include sizes.
 * @returns Promise resolving to an array of file names or objects with sizes.
 *
 * @example
 * ```js
 * import { listFilesInPng } from 'roxify';
 * const files = await listFilesInPng(fs.readFileSync('out.png'), { includeSizes: true });
 * console.log(files);
 * ```
 */
export async function listFilesInPng(
  pngBuf: Buffer,
  opts: { includeSizes?: boolean } = {},
): Promise<string[] | { name: string; size: number }[] | null> {
  try {
    const chunks = native.extractPngChunks(pngBuf);

    const fileListChunk = chunks.find((c: any) => c.name === 'rXFL');
    if (fileListChunk) {
      const data = Buffer.from(fileListChunk.data);
      const parsedFiles = JSON.parse(data.toString('utf8')) as any[];
      if (
        parsedFiles.length > 0 &&
        typeof parsedFiles[0] === 'object' &&
        (parsedFiles[0].name || parsedFiles[0].path)
      ) {
        const objs = parsedFiles.map((p) => ({
          name: p.name ?? p.path,
          size: typeof p.size === 'number' ? p.size : 0,
        }));
        return objs.sort((a, b) => a.name.localeCompare(b.name));
      }
      const files: string[] = parsedFiles as string[];
      return files.sort();
    }

    const metaChunk = chunks.find((c: any) => c.name === CHUNK_TYPE);
    if (metaChunk) {
      const dataBuf = Buffer.from(metaChunk.data);
      const markerIdx = dataBuf.indexOf(Buffer.from('rXFL'));
      if (markerIdx !== -1 && markerIdx + 8 <= dataBuf.length) {
        const jsonLen = dataBuf.readUInt32BE(markerIdx + 4);
        const jsonStart = markerIdx + 8;
        const jsonEnd = jsonStart + jsonLen;
        if (jsonEnd <= dataBuf.length) {
          const parsedFiles = JSON.parse(
            dataBuf.slice(jsonStart, jsonEnd).toString('utf8'),
          ) as any[];
          if (
            parsedFiles.length > 0 &&
            typeof parsedFiles[0] === 'object' &&
            (parsedFiles[0].name || parsedFiles[0].path)
          ) {
            const objs = parsedFiles.map((p) => ({
              name: p.name ?? p.path,
              size: typeof p.size === 'number' ? p.size : 0,
            }));
            return objs.sort((a, b) => a.name.localeCompare(b.name));
          }
          const files: string[] = parsedFiles as string[];
          return files.sort();
        }
      }
    }

    const ihdr = chunks.find((c: any) => c.name === 'IHDR');
    const idatChunks = chunks.filter((c: any) => c.name === 'IDAT');

    if (ihdr && idatChunks.length > 0) {
      const ihdrData = Buffer.from(ihdr.data);
      const width = ihdrData.readUInt32BE(0);
      const bpp = 3;
      const rowLen = 1 + width * bpp;

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
          const magic = validClean.slice(8, 12);
          if (!magic.equals(PIXEL_MAGIC)) {
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
          const marker = validClean.slice(idx, idx + 4).toString('utf8');

          if (marker === 'rXFL') {
            idx += 4;
            if (validClean.length < idx + 4) return;
            const jsonLen = validClean.readUInt32BE(idx);
            idx += 4;

            if (validClean.length < idx + jsonLen) return;
            const jsonBuf = validClean.slice(idx, idx + jsonLen);
            try {
              const parsedFiles = JSON.parse(jsonBuf.toString('utf8')) as any[];
              resolved = true;
              inflate.destroy();

              if (
                parsedFiles.length > 0 &&
                typeof parsedFiles[0] === 'object' &&
                (parsedFiles[0].name || parsedFiles[0].path)
              ) {
                const objs = parsedFiles.map((p) => ({
                  name: p.name ?? p.path,
                  size: typeof p.size === 'number' ? p.size : 0,
                }));
                resolve(objs.sort((a, b) => a.name.localeCompare(b.name)));
                return;
              }

              const names = parsedFiles as string[];
              resolve(names.sort());
            } catch (e) {
              resolved = true;
              inflate.destroy();
              resolve(null);
            }
          } else {
            resolved = true;
            inflate.destroy();
            resolve(null);
          }
        });

        inflate.on('error', () => {
          if (!resolved) resolve(null);
        });

        inflate.on('end', () => {
          if (!resolved) resolve(null);
        });

        for (const chunk of idatChunks) {
          if (resolved) break;
          inflate.write(Buffer.from(chunk.data));
        }
        inflate.end();
      });

      if (files) return files;
    }
  } catch (e) {
    console.log(' error:', e);
  }

  try {
    try {
      const rawData = native.sharpToRaw(pngBuf);
      const data = rawData.pixels;
      const currentWidth = rawData.width;
      const currentHeight = rawData.height;

      const rawRGB = Buffer.alloc(currentWidth * currentHeight * 3);
      for (let i = 0; i < currentWidth * currentHeight; i++) {
        rawRGB[i * 3] = data[i * 3];
        rawRGB[i * 3 + 1] = data[i * 4 + 1];
        rawRGB[i * 3 + 2] = data[i * 4 + 2];
      }

      const found = rawRGB.indexOf(PIXEL_MAGIC);
      if (found !== -1) {
        let idx = found + PIXEL_MAGIC.length;

        if (idx + 2 <= rawRGB.length) {
          const version = rawRGB[idx++];
          const nameLen = rawRGB[idx++];
          if (process.env.ROX_DEBUG)
            console.log(
              'listFilesInPng: pixel version',
              version,
              'nameLen',
              nameLen,
            );

          if (nameLen > 0 && idx + nameLen <= rawRGB.length) {
            idx += nameLen;
          }

          if (idx + 4 <= rawRGB.length) {
            const payloadLen = rawRGB.readUInt32BE(idx);
            idx += 4;

            const afterPayload = idx + payloadLen;
            if (afterPayload <= rawRGB.length) {
              if (afterPayload + 8 <= rawRGB.length) {
                const marker = rawRGB
                  .slice(afterPayload, afterPayload + 4)
                  .toString('utf8');
                if (marker === 'rXFL') {
                  const jsonLen = rawRGB.readUInt32BE(afterPayload + 4);
                  const jsonStart = afterPayload + 8;
                  const jsonEnd = jsonStart + jsonLen;
                  if (jsonEnd <= rawRGB.length) {
                    const jsonBuf = rawRGB.slice(jsonStart, jsonEnd);
                    const parsedFiles = JSON.parse(
                      jsonBuf.toString('utf8'),
                    ) as any[];
                    if (
                      parsedFiles.length > 0 &&
                      typeof parsedFiles[0] === 'object' &&
                      (parsedFiles[0].name || parsedFiles[0].path)
                    ) {
                      const objs = parsedFiles.map((p) => ({
                        name: p.name ?? p.path,
                        size: typeof p.size === 'number' ? p.size : 0,
                      }));
                      return objs.sort((a, b) => a.name.localeCompare(b.name));
                    }
                    const files: string[] = parsedFiles as string[];
                    return files.sort();
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {}
  } catch (e) {}

  try {
    const reconstructed = await cropAndReconstitute(pngBuf);
    try {
      const rawData = native.sharpToRaw(reconstructed);
      const data = rawData.pixels;
      const currentWidth = rawData.width;
      const currentHeight = rawData.height;

      const rawRGB = Buffer.alloc(currentWidth * currentHeight * 3);
      for (let i = 0; i < currentWidth * currentHeight; i++) {
        rawRGB[i * 3] = data[i * 3];
        rawRGB[i * 3 + 1] = data[i * 3 + 1];
        rawRGB[i * 3 + 2] = data[i * 3 + 2];
      }

      const found = rawRGB.indexOf(PIXEL_MAGIC);
      if (found !== -1) {
        let idx = found + PIXEL_MAGIC.length;

        if (idx + 2 <= rawRGB.length) {
          const version = rawRGB[idx++];
          const nameLen = rawRGB[idx++];
          if (process.env.ROX_DEBUG)
            console.log(
              'listFilesInPng (reconstructed): pixel version',
              version,
              'nameLen',
              nameLen,
            );

          if (nameLen > 0 && idx + nameLen <= rawRGB.length) {
            idx += nameLen;
          }

          if (idx + 4 <= rawRGB.length) {
            const payloadLen = rawRGB.readUInt32BE(idx);
            idx += 4;

            const afterPayload = idx + payloadLen;
            if (afterPayload <= rawRGB.length) {
              if (afterPayload + 8 <= rawRGB.length) {
                const marker = rawRGB
                  .slice(afterPayload, afterPayload + 4)
                  .toString('utf8');
                if (marker === 'rXFL') {
                  const jsonLen = rawRGB.readUInt32BE(afterPayload + 4);
                  const jsonStart = afterPayload + 8;
                  const jsonEnd = jsonStart + jsonLen;
                  if (jsonEnd <= rawRGB.length) {
                    const jsonBuf = rawRGB.slice(jsonStart, jsonEnd);
                    const parsedFiles = JSON.parse(
                      jsonBuf.toString('utf8'),
                    ) as any[];
                    if (
                      parsedFiles.length > 0 &&
                      typeof parsedFiles[0] === 'object' &&
                      (parsedFiles[0].name || parsedFiles[0].path)
                    ) {
                      const objs = parsedFiles.map((p) => ({
                        name: p.name ?? p.path,
                        size: typeof p.size === 'number' ? p.size : 0,
                      }));
                      return objs.sort((a, b) => a.name.localeCompare(b.name));
                    }
                    const files: string[] = parsedFiles as string[];
                    return files.sort();
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {}

    try {
      const chunks = native.extractPngChunks(reconstructed);
      const fileListChunk = chunks.find((c: any) => c.name === 'rXFL');
      if (fileListChunk) {
        const data = Buffer.from(fileListChunk.data);
        const parsedFiles = JSON.parse(data.toString('utf8')) as any[];
        if (
          parsedFiles.length > 0 &&
          typeof parsedFiles[0] === 'object' &&
          (parsedFiles[0].name || parsedFiles[0].path)
        ) {
          const objs = parsedFiles.map((p) => ({
            name: p.name ?? p.path,
            size: typeof p.size === 'number' ? p.size : 0,
          }));
          return objs.sort((a, b) => a.name.localeCompare(b.name));
        }
        const files: string[] = parsedFiles as string[];
        if (opts.includeSizes) {
          const sizes = await getFileSizesFromPng(pngBuf);
          if (sizes) {
            return files
              .map((f) => ({ name: f, size: sizes[f] ?? 0 }))
              .sort((a, b) => a.name.localeCompare(b.name));
          }
        }
        return files.sort();
      }

      const metaChunk = chunks.find((c: any) => c.name === CHUNK_TYPE);
      if (metaChunk) {
        const dataBuf = Buffer.from(metaChunk.data);
        const markerIdx = dataBuf.indexOf(Buffer.from('rXFL'));
        if (markerIdx !== -1 && markerIdx + 8 <= dataBuf.length) {
          const jsonLen = dataBuf.readUInt32BE(markerIdx + 4);
          const jsonStart = markerIdx + 8;
          const jsonEnd = jsonStart + jsonLen;
          if (jsonEnd <= dataBuf.length) {
            const parsedFiles = JSON.parse(
              dataBuf.slice(jsonStart, jsonEnd).toString('utf8'),
            ) as any[];
            if (
              parsedFiles.length > 0 &&
              typeof parsedFiles[0] === 'object' &&
              (parsedFiles[0].name || parsedFiles[0].path)
            ) {
              const objs = parsedFiles.map((p) => ({
                name: p.name ?? p.path,
                size: typeof p.size === 'number' ? p.size : 0,
              }));
              return objs.sort((a, b) => a.name.localeCompare(b.name));
            }
            const files: string[] = parsedFiles as string[];
            return files.sort();
          }
        }
      }
    } catch (e) {}
  } catch (e) {}

  try {
    const chunks = native.extractPngChunks(pngBuf);
    const fileListChunk = chunks.find((c: any) => c.name === 'rXFL');
    if (fileListChunk) {
      const data = Buffer.from(fileListChunk.data);
      const parsedFiles = JSON.parse(data.toString('utf8')) as any[];
      if (
        parsedFiles.length > 0 &&
        typeof parsedFiles[0] === 'object' &&
        (parsedFiles[0].name || parsedFiles[0].path)
      ) {
        const objs = parsedFiles.map((p) => ({
          name: p.name ?? p.path,
          size: typeof p.size === 'number' ? p.size : 0,
        }));
        return objs.sort((a, b) => a.name.localeCompare(b.name));
      }
      const files: string[] = parsedFiles as string[];
      return files.sort();
    }

    const metaChunk = chunks.find((c: any) => c.name === CHUNK_TYPE);
    if (metaChunk) {
      const dataBuf = Buffer.from(metaChunk.data);
      const markerIdx = dataBuf.indexOf(Buffer.from('rXFL'));
      if (markerIdx !== -1 && markerIdx + 8 <= dataBuf.length) {
        const jsonLen = dataBuf.readUInt32BE(markerIdx + 4);
        const jsonStart = markerIdx + 8;
        const jsonEnd = jsonStart + jsonLen;
        if (jsonEnd <= dataBuf.length) {
          const parsedFiles = JSON.parse(
            dataBuf.slice(jsonStart, jsonEnd).toString('utf8'),
          ) as any[];
          if (
            parsedFiles.length > 0 &&
            typeof parsedFiles[0] === 'object' &&
            (parsedFiles[0].name || parsedFiles[0].path)
          ) {
            const objs = parsedFiles.map((p) => ({
              name: p.name ?? p.path,
              size: typeof p.size === 'number' ? p.size : 0,
            }));
            return objs.sort((a, b) => a.name.localeCompare(b.name));
          }
          const files: string[] = parsedFiles as string[];
          return files.sort();
        }
      }
    }
  } catch (e) {}
  return null;
}

async function getFileSizesFromPng(
  pngBuf: Buffer,
): Promise<Record<string, number> | null> {
  try {
    const res: any = await decodePngToBinary(pngBuf, { showProgress: false });
    if (res && res.files) {
      const map: Record<string, number> = {};
      for (const f of res.files) map[f.path] = f.buf.length;
      return map;
    }
    if (res && res.buf) {
      const unpack = unpackBuffer(res.buf);
      if (unpack) {
        const map: Record<string, number> = {};
        for (const f of unpack.files) map[f.path] = f.buf.length;
        return map;
      }
    }
  } catch (e) {}
  return null;
}

/**
 * Check if a PNG contains an encrypted payload requiring a passphrase.
 *
 * @param pngBuf - Buffer containing a PNG file.
 * @returns Promise resolving to `true` if the PNG requires a passphrase.
 *
 * @example
 * ```js
 * import { hasPassphraseInPng } from 'roxify';
 * const needPass = await hasPassphraseInPng(fs.readFileSync('out.png'));
 * console.log('needs passphrase?', needPass);
 * ```
 */
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

    try {
      const chunksRaw = native.extractPngChunks(pngBuf);
      const target = chunksRaw.find((c: any) => c.name === CHUNK_TYPE);
      if (target) {
        const data = Buffer.isBuffer(target.data)
          ? target.data
          : Buffer.from(target.data as Uint8Array);
        if (data.length >= 1) {
          const nameLen = data.readUInt8(0);
          const payloadStart = 1 + nameLen;
          if (payloadStart < data.length) {
            const flag = data[payloadStart];
            return flag === ENC_AES || flag === ENC_XOR;
          }
        }
      }
    } catch (e) {}

    try {
      const rawData = native.sharpToRaw(pngBuf);
      const rawRGB = Buffer.from(rawData.pixels);

      const markerLen = MARKER_COLORS.length * 3;
      for (let i = 0; i <= rawRGB.length - markerLen; i += 3) {
        let ok = true;
        for (let m = 0; m < MARKER_COLORS.length; m++) {
          const j = i + m * 3;
          if (
            rawRGB[j] !== MARKER_COLORS[m].r ||
            rawRGB[j + 1] !== MARKER_COLORS[m].g ||
            rawRGB[j + 2] !== MARKER_COLORS[m].b
          ) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const headerStart = i + markerLen;
        if (headerStart + PIXEL_MAGIC.length >= rawRGB.length) continue;
        if (
          !rawRGB
            .slice(headerStart, headerStart + PIXEL_MAGIC.length)
            .equals(PIXEL_MAGIC)
        )
          continue;
        const metaStart = headerStart + PIXEL_MAGIC.length;

        if (metaStart + 2 >= rawRGB.length) continue;
        const nameLen = rawRGB[metaStart + 1];
        const payloadLenOff = metaStart + 2 + nameLen;
        const payloadStart = payloadLenOff + 4;
        if (payloadStart >= rawRGB.length) continue;
        const flag = rawRGB[payloadStart];
        return flag === ENC_AES || flag === ENC_XOR;
      }
    } catch (e) {}

    try {
      await decodePngToBinary(pngBuf, { showProgress: false });
      return false;
    } catch (e: any) {
      if (e instanceof PassphraseRequiredError) return true;
      if (e.message && e.message.toLowerCase().includes('passphrase'))
        return true;
      return false;
    }
  } catch (e) {
    return false;
  }
}
