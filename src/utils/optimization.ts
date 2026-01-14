import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as zlib from 'zlib';
import { PNG_HEADER, PNG_HEADER_HEX } from './constants';

export async function optimizePngBuffer(
  pngBuf: Buffer,
  fast = false,
): Promise<Buffer> {
  const MAX_OPTIMIZE_SIZE = 50 * 1024 * 1024;
  if (pngBuf.length > MAX_OPTIMIZE_SIZE) {
    return pngBuf;
  }

  if (fast) {
    return pngBuf;
  }

  const runCommandAsync = (
    cmd: string,
    args: string[],
    timeout = 120000,
  ): Promise<{ error?: Error; code?: number }> => {
    return new Promise((resolve) => {
      try {
        const child = spawn(cmd, args, { windowsHide: true, stdio: 'ignore' });
        let killed = false;
        const to = setTimeout(() => {
          killed = true;
          try {
            child.kill('SIGTERM');
          } catch (e) {}
        }, timeout);
        child.on('close', (code) => {
          clearTimeout(to);
          if (killed) resolve({ error: new Error('timeout') });
          else resolve({ code: code ?? 0 });
        });
        child.on('error', (err) => {
          clearTimeout(to);
          resolve({ error: err });
        });
      } catch (err: any) {
        resolve({ error: err });
      }
    });
  };
  try {
    const inPath = join(
      tmpdir(),
      `rox_zop_in_${Date.now()}_${Math.random().toString(36).slice(2)}.png`,
    );
    const outPath = inPath + '.out.png';
    writeFileSync(inPath, pngBuf);
    const iterations = fast ? 15 : 40;
    const args = [
      '-y',
      `--iterations=${iterations}`,
      '--filters=01234mepb',
      inPath,
      outPath,
    ];

    const res = await runCommandAsync('zopflipng', args, 120000);
    if (!res.error && existsSync(outPath)) {
      const outBuf = readFileSync(outPath);
      try {
        unlinkSync(inPath);
        unlinkSync(outPath);
      } catch (e) {}
      return outBuf.length < pngBuf.length ? outBuf : pngBuf;
    }
    if (fast) return pngBuf;
  } catch (e) {}

  try {
    const nativeExtract = require('../../libroxify_native.node');
    const chunksRaw = nativeExtract.extractPngChunks(pngBuf);
    const ihdr = chunksRaw.find((c: any) => c.name === 'IHDR');
    if (!ihdr) return pngBuf;
    const ihdrData = Buffer.from(ihdr.data);
    const width = ihdrData.readUInt32BE(0);
    const height = ihdrData.readUInt32BE(4);
    const bitDepth = ihdrData[8];
    const colorType = ihdrData[9];
    if (bitDepth !== 8 || colorType !== 2) return pngBuf;

    const idatChunks = chunksRaw.filter((c: any) => c.name === 'IDAT');
    const idatData = Buffer.concat(
      idatChunks.map((c: any) => Buffer.from(c.data)),
    );
    let raw: Buffer;
    try {
      raw = zlib.inflateSync(idatData);
    } catch (e) {
      return pngBuf;
    }

    const bytesPerPixel = 3;
    const rowBytes = width * bytesPerPixel;
    const inRowLen = rowBytes + 1;
    if (raw.length !== inRowLen * height) return pngBuf;

    function paethPredict(a: number, b: number, c: number) {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      if (pb <= pc) return b;
      return c;
    }

    const outRows: Buffer[] = [];
    let prevRow: Uint8Array | null = null;
    for (let y = 0; y < height; y++) {
      const rowStart = y * inRowLen + 1;
      const row = raw.slice(rowStart, rowStart + rowBytes);
      let bestSum = Infinity;
      let bestFiltered: Buffer | null = null;

      for (let f = 0; f <= 4; f++) {
        const filtered = Buffer.alloc(rowBytes);
        let sum = 0;
        for (let i = 0; i < rowBytes; i++) {
          const val = row[i];
          let outv = 0;
          const left = i - bytesPerPixel >= 0 ? row[i - bytesPerPixel] : 0;
          const up = prevRow ? prevRow[i] : 0;
          const upLeft =
            prevRow && i - bytesPerPixel >= 0 ? prevRow[i - bytesPerPixel] : 0;
          if (f === 0) {
            outv = val;
          } else if (f === 1) {
            outv = (val - left + 256) & 0xff;
          } else if (f === 2) {
            outv = (val - up + 256) & 0xff;
          } else if (f === 3) {
            const avg = Math.floor((left + up) / 2);
            outv = (val - avg + 256) & 0xff;
          } else {
            const p = paethPredict(left, up, upLeft);
            outv = (val - p + 256) & 0xff;
          }
          filtered[i] = outv;
          const signed = outv > 127 ? outv - 256 : outv;
          sum += Math.abs(signed);
        }
        if (sum < bestSum) {
          bestSum = sum;
          bestFiltered = filtered;
        }
      }
      const rowBuf = Buffer.alloc(1 + rowBytes);

      let chosenFilter = 0;
      for (let f = 0; f <= 4; f++) {
        const filtered = Buffer.alloc(rowBytes);
        for (let i = 0; i < rowBytes; i++) {
          const val = row[i];
          const left = i - bytesPerPixel >= 0 ? row[i - bytesPerPixel] : 0;
          const up = prevRow ? prevRow[i] : 0;
          const upLeft =
            prevRow && i - bytesPerPixel >= 0 ? prevRow[i - bytesPerPixel] : 0;
          if (f === 0) filtered[i] = val;
          else if (f === 1) filtered[i] = (val - left + 256) & 0xff;
          else if (f === 2) filtered[i] = (val - up + 256) & 0xff;
          else if (f === 3)
            filtered[i] = (val - Math.floor((left + up) / 2) + 256) & 0xff;
          else
            filtered[i] = (val - paethPredict(left, up, upLeft) + 256) & 0xff;
        }
        if (filtered.equals(bestFiltered!)) {
          chosenFilter = f;
          break;
        }
      }
      rowBuf[0] = chosenFilter;
      bestFiltered!.copy(rowBuf, 1);
      outRows.push(rowBuf);
      prevRow = row;
    }

    const filteredAll = Buffer.concat(outRows);
    const compressed = zlib.deflateSync(filteredAll, {
      level: 9,
      memLevel: 9,
      strategy: zlib.constants.Z_DEFAULT_STRATEGY,
    });

    const newChunks: Array<{ name: string; data: Buffer }> = [];
    for (const c of chunksRaw) {
      if (c.name === 'IDAT') continue;
      newChunks.push({
        name: c.name,
        data: Buffer.isBuffer(c.data)
          ? (c.data as Buffer)
          : Buffer.from(c.data as Uint8Array),
      });
    }

    const iendIndex = newChunks.findIndex((c) => c.name === 'IEND');
    const insertIndex = iendIndex >= 0 ? iendIndex : newChunks.length;
    newChunks.splice(insertIndex, 0, { name: 'IDAT', data: compressed });

    function ensurePng(buf: Buffer) {
      return buf.slice(0, 8).toString('hex') === PNG_HEADER_HEX
        ? buf
        : Buffer.concat([PNG_HEADER, buf]);
    }

    const nativeEnc = require('../../libroxify_native.node');
    const out = ensurePng(Buffer.from(nativeEnc.encodePngChunks(newChunks)));
    let bestBuf = out.length < pngBuf.length ? out : pngBuf;

    const strategies = [
      zlib.constants.Z_DEFAULT_STRATEGY,
      zlib.constants.Z_FILTERED,
      zlib.constants.Z_RLE,

      ...(zlib.constants.Z_HUFFMAN_ONLY ? [zlib.constants.Z_HUFFMAN_ONLY] : []),
      ...(zlib.constants.Z_FIXED ? [zlib.constants.Z_FIXED] : []),
    ];
    for (const strat of strategies) {
      try {
        const comp = zlib.deflateSync(raw, {
          level: 9,
          memLevel: 9,
          strategy: strat,
        });
        const altChunks = newChunks.map((c) => ({
          name: c.name,
          data: c.data,
        }));
        const idx = altChunks.findIndex((c) => c.name === 'IDAT');
        if (idx !== -1) altChunks[idx] = { name: 'IDAT', data: comp };
        const nativeOptim = require('../../libroxify_native.node');
        const candidate = ensurePng(
          Buffer.from(nativeOptim.encodePngChunks(altChunks)),
        );
        if (candidate.length < bestBuf.length) bestBuf = candidate;
      } catch (e) {}
    }

    try {
      const fflate = await import('fflate');
      const fflateDeflateSync = (fflate as any).deflateSync as (
        d: Buffer,
      ) => Uint8Array;
      try {
        const comp = fflateDeflateSync(filteredAll);
        const altChunks = newChunks.map((c) => ({
          name: c.name,
          data: c.data,
        }));
        const idx = altChunks.findIndex((c) => c.name === 'IDAT');
        if (idx !== -1)
          altChunks[idx] = { name: 'IDAT', data: Buffer.from(comp) };
        const native = require('../../libroxify_native.node');
        const candidate = ensurePng(
          Buffer.from(native.encodePngChunks(altChunks)),
        );
        if (candidate.length < bestBuf.length) bestBuf = candidate;
      } catch (e) {}
    } catch (e) {}

    const windowBitsOpts = [15, 12, 9];
    const memLevelOpts = [9, 8];
    for (let f = 0; f <= 4; f++) {
      try {
        const filteredAllGlobalRows: Buffer[] = [];
        let prevRowG: Uint8Array | null = null;
        for (let y = 0; y < height; y++) {
          const row = raw.slice(y * inRowLen + 1, y * inRowLen + 1 + rowBytes);
          const filtered = Buffer.alloc(rowBytes);
          for (let i = 0; i < rowBytes; i++) {
            const val = row[i];
            const left = i - bytesPerPixel >= 0 ? row[i - bytesPerPixel] : 0;
            const up = prevRowG ? prevRowG[i] : 0;
            const upLeft =
              prevRowG && i - bytesPerPixel >= 0
                ? prevRowG[i - bytesPerPixel]
                : 0;
            if (f === 0) filtered[i] = val;
            else if (f === 1) filtered[i] = (val - left + 256) & 0xff;
            else if (f === 2) filtered[i] = (val - up + 256) & 0xff;
            else if (f === 3)
              filtered[i] = (val - Math.floor((left + up) / 2) + 256) & 0xff;
            else
              filtered[i] = (val - paethPredict(left, up, upLeft) + 256) & 0xff;
          }
          const rowBuf = Buffer.alloc(1 + rowBytes);
          rowBuf[0] = f;
          filtered.copy(rowBuf, 1);
          filteredAllGlobalRows.push(rowBuf);
          prevRowG = row;
        }
        const filteredAllGlobal = Buffer.concat(filteredAllGlobalRows);
        for (const strat2 of strategies) {
          for (const wb of windowBitsOpts) {
            for (const ml of memLevelOpts) {
              try {
                const comp = zlib.deflateSync(filteredAllGlobal, {
                  level: 9,
                  memLevel: ml,
                  strategy: strat2,
                  windowBits: wb,
                });
                const altChunks = newChunks.map((c) => ({
                  name: c.name,
                  data: c.data,
                }));
                const idx = altChunks.findIndex((c) => c.name === 'IDAT');
                if (idx !== -1) altChunks[idx] = { name: 'IDAT', data: comp };
                const native = require('../../libroxify_native.node');
                const candidate = ensurePng(
                  Buffer.from(native.encodePngChunks(altChunks)),
                );
                if (candidate.length < bestBuf.length) bestBuf = candidate;
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }

    try {
      const zopIterations = [1000, 2000];

      zopIterations.push(5000, 10000, 20000);
      for (const iters of zopIterations) {
        try {
          const zIn = join(
            tmpdir(),
            `rox_zop_in_${Date.now()}_${Math.random()
              .toString(36)
              .slice(2)}.png`,
          );
          const zOut = zIn + '.out.png';
          writeFileSync(zIn, bestBuf);
          const args2 = [
            '-y',
            `--iterations=${iters}`,
            '--filters=01234mepb',
            zIn,
            zOut,
          ];
          try {
            const r2 = await runCommandAsync('zopflipng', args2, 240000);
            if (!r2.error && existsSync(zOut)) {
              const zbuf = readFileSync(zOut);
              try {
                unlinkSync(zIn);
                unlinkSync(zOut);
              } catch (e) {}
              if (zbuf.length < bestBuf.length) bestBuf = zbuf;
            }
          } catch (e) {}
        } catch (e) {}
      }
    } catch (e) {}

    try {
      const advIn = join(
        tmpdir(),
        `rox_adv_in_${Date.now()}_${Math.random().toString(36).slice(2)}.png`,
      );
      writeFileSync(advIn, bestBuf);
      const rAdv = spawnSync('advdef', ['-z4', '-i10', advIn], {
        windowsHide: true,
        stdio: 'ignore',
        timeout: 120000,
      });
      if (!rAdv.error && existsSync(advIn)) {
        const advBuf = readFileSync(advIn);
        try {
          unlinkSync(advIn);
        } catch (e) {}
        if (advBuf.length < bestBuf.length) bestBuf = advBuf;
      }
    } catch (e) {}
    for (const strat of strategies) {
      try {
        const comp = zlib.deflateSync(filteredAll, {
          level: 9,
          memLevel: 9,
          strategy: strat,
        });
        const altChunks = newChunks.map((c) => ({
          name: c.name,
          data: c.data,
        }));

        const idx = altChunks.findIndex((c) => c.name === 'IDAT');
        if (idx !== -1) altChunks[idx] = { name: 'IDAT', data: comp };
        const nativeOptim2 = require('../../libroxify_native.node');
        const candidate = ensurePng(
          Buffer.from(nativeOptim2.encodePngChunks(altChunks)),
        );
        if (candidate.length < bestBuf.length) bestBuf = candidate;
      } catch (e) {}
    }

    try {
      const pixels = Buffer.alloc(width * height * 3);
      let prev: Uint8Array | null = null;
      for (let y = 0; y < height; y++) {
        const f = raw[y * inRowLen];
        const row = raw.slice(y * inRowLen + 1, y * inRowLen + 1 + rowBytes);
        const recon = Buffer.alloc(rowBytes);
        for (let i = 0; i < rowBytes; i++) {
          const left = i - 3 >= 0 ? recon[i - 3] : 0;
          const up = prev ? prev[i] : 0;
          const upLeft = prev && i - 3 >= 0 ? prev[i - 3] : 0;
          let v = row[i];
          if (f === 0) {
          } else if (f === 1) v = (v + left) & 0xff;
          else if (f === 2) v = (v + up) & 0xff;
          else if (f === 3) v = (v + Math.floor((left + up) / 2)) & 0xff;
          else v = (v + paethPredict(left, up, upLeft)) & 0xff;
          recon[i] = v;
        }
        recon.copy(pixels, y * rowBytes);
        prev = recon;
      }

      const paletteMap = new Map<string, number>();
      const palette: number[] = [];
      for (let i = 0; i < pixels.length; i += 3) {
        const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
        if (!paletteMap.has(key)) {
          paletteMap.set(key, paletteMap.size);
          palette.push(pixels[i], pixels[i + 1], pixels[i + 2]);
          if (paletteMap.size > 256) break;
        }
      }
      if (paletteMap.size <= 256) {
        const idxRowLen = 1 + width * 1;
        const idxRows: Buffer[] = [];
        for (let y = 0; y < height; y++) {
          const rowIdx = Buffer.alloc(width);
          for (let x = 0; x < width; x++) {
            const pos = (y * width + x) * 3;
            const key = `${pixels[pos]},${pixels[pos + 1]},${pixels[pos + 2]}`;
            rowIdx[x] = paletteMap.get(key)!;
          }

          let bestRowFilter = 0;
          let bestRowSum = Infinity;
          let bestRowFiltered: Buffer | null = null;
          for (let f = 0; f <= 4; f++) {
            const filteredRow = Buffer.alloc(width);
            let sum = 0;
            for (let i = 0; i < width; i++) {
              const val = rowIdx[i];
              let outv = 0;
              const left = i - 1 >= 0 ? rowIdx[i - 1] : 0;
              const up = y > 0 ? idxRows[y - 1][i] : 0;
              const upLeft = y > 0 && i - 1 >= 0 ? idxRows[y - 1][i - 1] : 0;
              if (f === 0) outv = val;
              else if (f === 1) outv = (val - left + 256) & 0xff;
              else if (f === 2) outv = (val - up + 256) & 0xff;
              else if (f === 3)
                outv = (val - Math.floor((left + up) / 2) + 256) & 0xff;
              else outv = (val - paethPredict(left, up, upLeft) + 256) & 0xff;
              filteredRow[i] = outv;
              const signed = outv > 127 ? outv - 256 : outv;
              sum += Math.abs(signed);
            }
            if (sum < bestRowSum) {
              bestRowSum = sum;
              bestRowFilter = f;
              bestRowFiltered = filteredRow;
            }
          }
          const rowBuf = Buffer.alloc(idxRowLen);
          rowBuf[0] = bestRowFilter;
          bestRowFiltered!.copy(rowBuf, 1);
          idxRows.push(rowBuf);
        }

        const freqMap = new Map<string, number>();
        for (let i = 0; i < pixels.length; i += 3) {
          const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`;
          freqMap.set(key, (freqMap.get(key) || 0) + 1);
        }

        const paletteVariants: Array<{
          paletteArr: number[];
          map: Map<string, number>;
        }> = [];

        paletteVariants.push({
          paletteArr: palette.slice(),
          map: new Map(paletteMap),
        });

        const freqSorted = Array.from(freqMap.entries()).sort(
          (a, b) => b[1] - a[1],
        );
        if (freqSorted.length > 0) {
          const pal2: number[] = [];
          const map2 = new Map<string, number>();
          let pi = 0;
          for (const [k] of freqSorted) {
            const parts = k.split(',').map((s) => Number(s));
            pal2.push(parts[0], parts[1], parts[2]);
            map2.set(k, pi++);
            if (pi >= 256) break;
          }
          if (map2.size <= 256)
            paletteVariants.push({ paletteArr: pal2, map: map2 });
        }

        for (const variant of paletteVariants) {
          const pSize = variant.map.size;
          const bitDepth =
            pSize <= 2 ? 1 : pSize <= 4 ? 2 : pSize <= 16 ? 4 : 8;

          const idxRowsVar: Buffer[] = [];
          for (let y = 0; y < height; y++) {
            const rowIdx = Buffer.alloc(width);
            for (let x = 0; x < width; x++) {
              const pos = (y * width + x) * 3;
              const key = `${pixels[pos]},${pixels[pos + 1]},${
                pixels[pos + 2]
              }`;
              rowIdx[x] = variant.map.get(key)!;
            }
            idxRowsVar.push(rowIdx);
          }

          function packRowIndices(rowIdx: Buffer, bitDepth: number) {
            if (bitDepth === 8) return rowIdx;
            const bitsPerRow = width * bitDepth;
            const outLen = Math.ceil(bitsPerRow / 8);
            const out = Buffer.alloc(outLen);
            let bitPos = 0;
            for (let i = 0; i < width; i++) {
              const val = rowIdx[i] & ((1 << bitDepth) - 1);
              for (let b = 0; b < bitDepth; b++) {
                const bit = (val >> (bitDepth - 1 - b)) & 1;
                const byteIdx = Math.floor(bitPos / 8);
                const shift = 7 - (bitPos % 8);
                out[byteIdx] |= bit << shift;
                bitPos++;
              }
            }
            return out;
          }

          const packedRows: Buffer[] = [];
          for (let y = 0; y < height; y++) {
            const packed = packRowIndices(idxRowsVar[y], bitDepth);
            let bestRowFilter = 0;
            let bestRowSum = Infinity;
            let bestRowFiltered: Buffer | null = null;
            for (let f = 0; f <= 4; f++) {
              const filteredRow = Buffer.alloc(packed.length);
              let sum = 0;
              for (let i = 0; i < packed.length; i++) {
                const val = packed[i];
                const left = i - 1 >= 0 ? packed[i - 1] : 0;
                const up = y > 0 ? packedRows[y - 1][i] : 0;
                const upLeft =
                  y > 0 && i - 1 >= 0 ? packedRows[y - 1][i - 1] : 0;
                let outv = 0;
                if (f === 0) outv = val;
                else if (f === 1) outv = (val - left + 256) & 0xff;
                else if (f === 2) outv = (val - up + 256) & 0xff;
                else if (f === 3)
                  outv = (val - Math.floor((left + up) / 2) + 256) & 0xff;
                else outv = (val - paethPredict(left, up, upLeft) + 256) & 0xff;
                filteredRow[i] = outv;
                const signed = outv > 127 ? outv - 256 : outv;
                sum += Math.abs(signed);
              }
              if (sum < bestRowSum) {
                bestRowSum = sum;
                bestRowFilter = f;
                bestRowFiltered = filteredRow;
              }
            }
            const rowBuf = Buffer.alloc(1 + packed.length);
            rowBuf[0] = bestRowFilter;
            bestRowFiltered!.copy(rowBuf, 1);
            packedRows.push(rowBuf);
          }

          const idxFilteredAllVar = Buffer.concat(packedRows);

          const palettesBufVar = Buffer.from(variant.paletteArr);
          const palChunksVar: Array<{ name: string; data: Buffer }> = [];
          const ihdr = Buffer.alloc(13);
          ihdr.writeUInt32BE(width, 0);
          ihdr.writeUInt32BE(height, 4);
          ihdr[8] = bitDepth;
          ihdr[9] = 3;
          ihdr[10] = 0;
          ihdr[11] = 0;
          ihdr[12] = 0;
          palChunksVar.push({ name: 'IHDR', data: ihdr });
          palChunksVar.push({ name: 'PLTE', data: palettesBufVar });
          palChunksVar.push({
            name: 'IDAT',
            data: zlib.deflateSync(idxFilteredAllVar, { level: 9 }),
          });
          palChunksVar.push({ name: 'IEND', data: Buffer.alloc(0) });
          const native = require('../../libroxify_native.node');
          const palOutVar = ensurePng(
            Buffer.from(native.encodePngChunks(palChunksVar)),
          );
          if (palOutVar.length < bestBuf.length) bestBuf = palOutVar;
        }
      }
    } catch (e) {}

    const externalAttempts: Array<{ cmd: string; args: string[] }> = [
      { cmd: 'oxipng', args: ['-o', '6', '--strip', 'all'] },
      { cmd: 'optipng', args: ['-o7'] },
      { cmd: 'pngcrush', args: ['-brute', '-reduce'] },
      { cmd: 'pngout', args: [] },
    ];

    for (const tool of externalAttempts) {
      try {
        const tIn = join(
          tmpdir(),
          `rox_ext_in_${Date.now()}_${Math.random().toString(36).slice(2)}.png`,
        );
        const tOut = tIn + '.out.png';
        writeFileSync(tIn, bestBuf);
        const args = tool.args.concat([tIn, tOut]);
        const r = spawnSync(tool.cmd, args, {
          windowsHide: true,
          stdio: 'ignore',
          timeout: 240000,
        });
        if (!r.error && existsSync(tOut)) {
          const outb = readFileSync(tOut);
          try {
            unlinkSync(tIn);
            unlinkSync(tOut);
          } catch (e) {}
          if (outb.length < bestBuf.length) bestBuf = outb;
        } else {
          try {
            unlinkSync(tIn);
          } catch (e) {}
        }
      } catch (e) {}
    }

    return bestBuf;
  } catch (e) {
    return pngBuf;
  }
}
