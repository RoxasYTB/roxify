import { createCipheriv, pbkdf2Sync, randomBytes } from 'crypto';
import * as zlib from 'zlib';
import { unpackBuffer } from '../pack.js';
import { bytesToWav } from './audio.js';
import {
  COMPRESSION_MARKERS,
  ENC_AES,
  ENC_NONE,
  ENC_XOR,
  MAGIC,
  MARKER_END,
  MARKER_START,
  PIXEL_MAGIC,
  PIXEL_MAGIC_BLOCK,
  PNG_HEADER,
} from './constants.js';
import { crc32 } from './crc.js';
import { colorsToBytes } from './helpers.js';
import { native } from './native.js';
import { encodeRobustAudio } from './robust-audio.js';
import { encodeRobustImage } from './robust-image.js';
import { EncodeOptions } from './types.js';
import { parallelZstdCompress } from './zstd.js';
/**
 * Encode a buffer or array of buffers into a PNG image (ROX format).
 *
 * @param input - The buffer or array of buffers to encode.
 * @param opts - Optional encoding options.
 * @returns A Promise that resolves to a PNG Buffer containing the encoded data.
 *
 * @example
 * ```js
 * import { encodeBinaryToPng } from 'roxify';
 *
 * const png = await encodeBinaryToPng(Buffer.from('hello'), {
 *   mode: 'screenshot',
 *   name: 'hello.txt',
 *   compressionLevel: 19,
 *   outputFormat: 'png',
 * });
 *
 *  * ```
 */
export async function encodeBinaryToPng(
  input: Buffer | Buffer[],
  opts: EncodeOptions = {},
): Promise<Buffer> {
  let progressBar: any = null;
  if (opts.showProgress) {
    progressBar = {
      start: () => { },
      update: () => { },
      stop: () => { },
    };
    const startTime = Date.now();
    if (!opts.onProgress) {
      opts.onProgress = (info) => {
        let pct = 0;
        if (info.phase === 'compress_progress' && info.loaded && info.total) {
          pct = (info.loaded / info.total) * 50;
        } else if (info.phase === 'compress_done') {
          pct = 50;
        } else if (info.phase === 'encrypt_done') {
          pct = 80;
        } else if (info.phase === 'png_gen') {
          pct = 90;
        } else if (info.phase === 'done') {
          pct = 100;
        }
      };
    }
  }

  const compressionLevel = opts.compressionLevel ?? 19;

  // ─── Lossy-resilient encoding fast path ────────────────────────────────────
  // When lossyResilient is true, use QR-code-style block encoding with
  // Reed-Solomon FEC. This produces output that survives lossy compression.
  if (opts.lossyResilient) {
    const inputBuf = Array.isArray(input) ? Buffer.concat(input) : (input as Buffer);
    if (opts.onProgress) opts.onProgress({ phase: 'compress_start', total: inputBuf.length });

    if (opts.container === 'sound') {
      // Robust audio encoding (multi-tone FSK + RS ECC)
      const result = encodeRobustAudio(inputBuf, {
        eccLevel: opts.eccLevel ?? 'medium',
      });
      if (opts.onProgress) opts.onProgress({ phase: 'done' });
      progressBar?.stop();
      return result;
    } else {
      // Robust image encoding (QR-code-like blocks + RS ECC)
      const result = encodeRobustImage(inputBuf, {
        blockSize: opts.robustBlockSize ?? 4,
        eccLevel: opts.eccLevel ?? 'medium',
      });
      if (opts.onProgress) opts.onProgress({ phase: 'done' });
      progressBar?.stop();
      return result;
    }
  }

  // --- Native encoder fast path: let Rust handle compression/encryption/PNG ---
  // This must be checked BEFORE TS compression to avoid double-compression.
  if (
    typeof native.nativeEncodePngWithNameAndFilelist === 'function' &&
    opts.includeFileList &&
    opts.fileList &&
    opts.compression !== 'bwt-ans'
  ) {
    const fileName = opts.name || undefined;
    const inputBuf = Array.isArray(input) ? Buffer.concat(input) : (input as Buffer);
    let sizeMap: Record<string, number> | null = null;
    try {
      const unpack = unpackBuffer(inputBuf);
      if (unpack) {
        sizeMap = {};
        for (const ef of unpack.files) sizeMap[ef.path] = ef.buf.length;
      }
    } catch (e) { }

    const normalized = opts.fileList.map((f: any) => {
      if (typeof f === 'string')
        return { name: f, size: sizeMap && sizeMap[f] ? sizeMap[f] : 0 };
      if (f && typeof f === 'object') {
        if (f.name) return { name: f.name, size: f.size ?? 0 };
        if (f.path) return { name: f.path, size: f.size ?? 0 };
      }
      return { name: String(f), size: 0 };
    });
    const fileListJson = JSON.stringify(normalized);

    if (opts.onProgress) opts.onProgress({ phase: 'compress_start', total: inputBuf.length });

    // ── WAV container (--sound) via native Rust encoder ──
    if (opts.container === 'sound') {
      if (typeof native.nativeEncodeWavWithEncryptionNameAndFilelist === 'function' &&
        opts.passphrase && opts.encrypt && opts.encrypt !== 'auto') {
        const result = native.nativeEncodeWavWithEncryptionNameAndFilelist(
          inputBuf, compressionLevel, opts.passphrase, opts.encrypt, fileName, fileListJson,
        );
        if (opts.onProgress) opts.onProgress({ phase: 'done' });
        progressBar?.stop();
        return Buffer.from(result);
      } else if (typeof native.nativeEncodeWavWithNameAndFilelist === 'function') {
        const result = native.nativeEncodeWavWithNameAndFilelist(
          inputBuf, compressionLevel, fileName, fileListJson,
        );
        if (opts.onProgress) opts.onProgress({ phase: 'done' });
        progressBar?.stop();
        return Buffer.from(result);
      }
      // fallthrough to TS WAV path below if native WAV not available
    }

    // ── PNG container (default) via native Rust encoder ──
    if (opts.container !== 'sound') {
      if (opts.passphrase && opts.encrypt && opts.encrypt !== 'auto') {
        const result = native.nativeEncodePngWithEncryptionNameAndFilelist(
          inputBuf,
          compressionLevel,
          opts.passphrase,
          opts.encrypt,
          fileName,
          fileListJson,
        );
        if (opts.onProgress) opts.onProgress({ phase: 'done' });
        progressBar?.stop();
        return Buffer.from(result);
      } else {
        const result = native.nativeEncodePngWithNameAndFilelist(
          inputBuf,
          compressionLevel,
          fileName,
          fileListJson,
        );
        if (opts.onProgress) opts.onProgress({ phase: 'done' });
        progressBar?.stop();
        return Buffer.from(result);
      }
    }
  }

  // --- TypeScript compression/encryption pipeline ---
  let payloadInput: Buffer | Buffer[];
  let totalLen = 0;
  if (Array.isArray(input)) {
    payloadInput = [MAGIC, ...input];
    totalLen = MAGIC.length + input.reduce((a, b) => a + b.length, 0);
  } else {
    payloadInput = [MAGIC, input];
    totalLen = MAGIC.length + input.length;
  }

  if (opts.onProgress)
    opts.onProgress({ phase: 'compress_start', total: totalLen });

  let payload: Buffer[];

  if (opts.compression === 'bwt-ans' && native?.hybridCompress) {
    const flat = Array.isArray(payloadInput) ? Buffer.concat(payloadInput) : payloadInput;
    if (opts.onProgress)
      opts.onProgress({ phase: 'compress_progress', loaded: 0, total: 1 });
    const compressed = Buffer.from(native.hybridCompress(flat));
    payload = [compressed];
    if (opts.onProgress)
      opts.onProgress({ phase: 'compress_progress', loaded: 1, total: 1 });
  } else {
    payload = await parallelZstdCompress(
      payloadInput,
      compressionLevel,
      (loaded, total) => {
        if (opts.onProgress) {
          opts.onProgress({
            phase: 'compress_progress',
            loaded,
            total,
          });
        }
      },
      opts.dict,
    );
  }

  if (opts.onProgress)
    opts.onProgress({ phase: 'compress_done', loaded: payload.length });

  if (Array.isArray(input)) {
    input.length = 0;
  }

  if (opts.passphrase && !opts.encrypt) {
    opts.encrypt = 'aes';
  }

  if (opts.encrypt === 'auto' && !opts._skipAuto) {
    const candidates: Array<'none' | 'xor' | 'aes'> = ['none', 'xor', 'aes'];
    const candidateBufs: Array<{ enc: string; buf: Buffer }> = [];

    for (const c of candidates) {
      const testBuf = await encodeBinaryToPng(input, {
        ...opts,
        encrypt: c,
        _skipAuto: true,
      });
      candidateBufs.push({ enc: c, buf: testBuf });
    }

    candidateBufs.sort((a, b) => a.buf.length - b.buf.length);
    return candidateBufs[0].buf;
  }

  if (opts.passphrase && opts.encrypt && opts.encrypt !== 'auto') {
    const encChoice = opts.encrypt;
    if (opts.onProgress) opts.onProgress({ phase: 'encrypt_start' });

    if (encChoice === 'aes') {
      const salt = randomBytes(16);
      const iv = randomBytes(12);

      const PBKDF2_ITERS = 1_000_000;
      const key = pbkdf2Sync(opts.passphrase, salt, PBKDF2_ITERS, 32, 'sha256');
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encParts: Buffer[] = [];
      for (const chunk of payload) {
        encParts.push(cipher.update(chunk));
      }
      encParts.push(cipher.final());
      const tag = cipher.getAuthTag();
      payload = [Buffer.from([ENC_AES]), salt, iv, tag, ...encParts];
      if (opts.onProgress) opts.onProgress({ phase: 'encrypt_done' });
    } else if (encChoice === 'xor') {
      const xoredParts: Buffer[] = [];
      let offset = 0;
      const keyBuf = Buffer.from(opts.passphrase as string, 'utf8');
      for (const chunk of payload) {
        const out = Buffer.alloc(chunk.length);
        for (let i = 0; i < chunk.length; i++) {
          out[i] = chunk[i] ^ keyBuf[(offset + i) % keyBuf.length];
        }
        offset += chunk.length;
        xoredParts.push(out);
      }
      payload = [Buffer.from([ENC_XOR]), ...xoredParts];
      if (opts.onProgress) opts.onProgress({ phase: 'encrypt_done' });
    } else if (encChoice === 'none') {
      payload = [Buffer.from([ENC_NONE]), ...payload];
      if (opts.onProgress) opts.onProgress({ phase: 'encrypt_done' });
    }
  } else {
    payload = [Buffer.from([ENC_NONE]), ...payload];
  }
  const payloadTotalLen = payload.reduce((a, b) => a + b.length, 0);
  if (opts.onProgress)
    opts.onProgress({ phase: 'meta_prep_done', loaded: payloadTotalLen });

  const metaParts: Buffer[] = [];
  const includeName =
    opts.includeName === undefined ? true : !!opts.includeName;
  if (includeName && opts.name) {
    const nameBuf = Buffer.from(opts.name, 'utf8');
    metaParts.push(Buffer.from([nameBuf.length]));
    metaParts.push(nameBuf);
  } else {
    metaParts.push(Buffer.from([0]));
  }

  let meta: Buffer[] = [...metaParts, ...payload];
  if (opts.includeFileList && opts.fileList) {
    let sizeMap: Record<string, number> | null = null;
    if (!Array.isArray(input)) {
      try {
        const unpack = unpackBuffer(input as Buffer);
        if (unpack) {
          sizeMap = {};
          for (const ef of unpack.files) sizeMap[ef.path] = ef.buf.length;
        }
      } catch (e) { }
    }

    const normalized = opts.fileList.map((f: any) => {
      if (typeof f === 'string')
        return { name: f, size: sizeMap && sizeMap[f] ? sizeMap[f] : 0 };
      if (f && typeof f === 'object') {
        if (f.name) return { name: f.name, size: f.size ?? 0 };
        if (f.path) return { name: f.path, size: f.size ?? 0 };
      }
      return { name: String(f), size: 0 };
    });
    const jsonBuf = Buffer.from(JSON.stringify(normalized), 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(jsonBuf.length, 0);

    meta = [...meta, Buffer.from('rXFL', 'utf8'), lenBuf, jsonBuf];
  }

  if (opts.output === 'rox') {
    return Buffer.concat([MAGIC, ...meta]);
  }

  // ─── WAV container (TS fallback path) ──────────────────────────────────────
  if (opts.container === 'sound') {
    const nameBuf =
      opts.name ? Buffer.from(opts.name, 'utf8') : Buffer.alloc(0);
    const nameLen = nameBuf.length;
    const payloadLenBuf = Buffer.alloc(4);
    payloadLenBuf.writeUInt32BE(payloadTotalLen, 0);
    const version = 1;
    let wavPayload: Buffer[] = [
      PIXEL_MAGIC,
      Buffer.from([version]),
      Buffer.from([nameLen]),
      nameBuf,
      payloadLenBuf,
      ...payload,
    ];

    if (opts.includeFileList && opts.fileList) {
      let sizeMapW: Record<string, number> | null = null;
      if (!Array.isArray(input)) {
        try {
          const unpack = unpackBuffer(input as Buffer);
          if (unpack) {
            sizeMapW = {};
            for (const ef of unpack.files) sizeMapW[ef.path] = ef.buf.length;
          }
        } catch (e) { }
      }
      const normalizedW = opts.fileList.map((f: any) => {
        if (typeof f === 'string')
          return { name: f, size: sizeMapW && sizeMapW[f] ? sizeMapW[f] : 0 };
        if (f && typeof f === 'object') {
          if (f.name) return { name: f.name, size: f.size ?? 0 };
          if (f.path) return { name: f.path, size: f.size ?? 0 };
        }
        return { name: String(f), size: 0 };
      });
      const jsonBufW = Buffer.from(JSON.stringify(normalizedW), 'utf8');
      const lenBufW = Buffer.alloc(4);
      lenBufW.writeUInt32BE(jsonBufW.length, 0);
      wavPayload = [...wavPayload, Buffer.from('rXFL', 'utf8'), lenBufW, jsonBufW];
    }

    const wavData = bytesToWav(Buffer.concat(wavPayload));
    payload.length = 0;
    progressBar?.stop();
    return wavData;
  }

  {
    const nameBuf =
      opts.name ? Buffer.from(opts.name, 'utf8') : Buffer.alloc(0);
    const nameLen = nameBuf.length;
    const payloadLenBuf = Buffer.alloc(4);
    payloadLenBuf.writeUInt32BE(payloadTotalLen, 0);
    const version = 1;
    let metaPixel: Buffer[] = [
      Buffer.from([version]),
      Buffer.from([nameLen]),
      nameBuf,
      payloadLenBuf,
      ...payload,
    ];

    if (opts.includeFileList && opts.fileList) {
      let sizeMap2: Record<string, number> | null = null;
      if (!Array.isArray(input)) {
        try {
          const unpack = unpackBuffer(input as Buffer);
          if (unpack) {
            sizeMap2 = {};
            for (const ef of unpack.files) sizeMap2[ef.path] = ef.buf.length;
          }
        } catch (e) { }
      }

      const normalized = opts.fileList.map((f: any) => {
        if (typeof f === 'string')
          return { name: f, size: sizeMap2 && sizeMap2[f] ? sizeMap2[f] : 0 };
        if (f && typeof f === 'object') {
          if (f.name) return { name: f.name, size: f.size ?? 0 };
          if (f.path) return { name: f.path, size: f.size ?? 0 };
        }
        return { name: String(f), size: 0 };
      });
      const jsonBuf = Buffer.from(JSON.stringify(normalized), 'utf8');
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeUInt32BE(jsonBuf.length, 0);
      metaPixel = [...metaPixel, Buffer.from('rXFL', 'utf8'), lenBuf, jsonBuf];
    }

    const useBlockEncoding = false;
    const pixelMagic = useBlockEncoding ? PIXEL_MAGIC_BLOCK : PIXEL_MAGIC;
    const dataWithoutMarkers: Buffer[] = [pixelMagic, ...metaPixel];

    const dataWithoutMarkersLen = dataWithoutMarkers.reduce(
      (a, b) => a + b.length,
      0,
    );
    const padding = (3 - (dataWithoutMarkersLen % 3)) % 3;
    const paddedData =
      padding > 0 ?
        [...dataWithoutMarkers, Buffer.alloc(padding)]
        : dataWithoutMarkers;

    const markerStartBytes = colorsToBytes(MARKER_START);
    const compressionMarkerBytes = colorsToBytes(
      opts.compression === 'bwt-ans' ? COMPRESSION_MARKERS['bwt-ans'] : COMPRESSION_MARKERS.zstd,
    );
    const dataWithMarkers: Buffer[] = [
      markerStartBytes,
      compressionMarkerBytes,
      ...paddedData,
    ];

    const dataWithMarkersLen = dataWithMarkers.reduce(
      (a, b) => a + b.length,
      0,
    );

    let width: number;
    let height: number;
    let bufScr: Buffer;

    if (useBlockEncoding) {
      const flatData = Buffer.concat(dataWithMarkers);

      const blocksPerRow = Math.ceil(Math.sqrt(flatData.length));
      const numRows = Math.ceil(flatData.length / blocksPerRow);

      width = blocksPerRow * 2;
      height = numRows * 2;

      const rgbBuffer = Buffer.alloc(width * height * 3);

      for (let i = 0; i < flatData.length; i++) {
        const blockRow = Math.floor(i / blocksPerRow);
        const blockCol = i % blocksPerRow;

        const pixelRow = blockRow * 2;
        const pixelCol = blockCol * 2;

        const byte = flatData[i];

        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = (pixelRow + dy) * width + (pixelCol + dx);
            rgbBuffer[px * 3] = byte;
            rgbBuffer[px * 3 + 1] = byte;
            rgbBuffer[px * 3 + 2] = byte;
          }
        }
      }

      bufScr = Buffer.from(native.rgbToPng(rgbBuffer, width, height));
    } else {
      const bytesPerPixel = 3;
      const dataPixels = Math.ceil(dataWithMarkersLen / 3);
      const totalPixels = dataPixels + MARKER_END.length;
      const maxWidth = 16384;

      let side = Math.ceil(Math.sqrt(totalPixels));
      if (side < MARKER_END.length) side = MARKER_END.length;

      let logicalWidth: number;
      let logicalHeight: number;
      if (side <= maxWidth) {
        logicalWidth = side;
        logicalHeight = side;
      } else {
        logicalWidth = Math.min(maxWidth, totalPixels);
        logicalHeight = Math.ceil(totalPixels / logicalWidth);
      }

      const scale = 1;
      width = logicalWidth * scale;
      height = logicalHeight * scale;

      const LARGE_IMAGE_PIXELS = 10_000_000;
      const useManualPng =
        (width * height > LARGE_IMAGE_PIXELS || !!process.env.ROX_FAST_PNG) &&
        opts.outputFormat !== 'webp';

      if (process.env.ROX_DEBUG) {
        console.log(
          `[DEBUG] Width=${width}, Height=${height}, Pixels=${width * height}`,
        );
        console.log(
          `[DEBUG] outputFormat=${opts.outputFormat}, useManualPng=${useManualPng}`,
        );
      }

      const totalDataBytes = logicalWidth * logicalHeight * 3;
      const markerEndPos = totalDataBytes - MARKER_END.length * 3;

      const fullData = Buffer.alloc(totalDataBytes);
      const flatData = Buffer.concat(dataWithMarkers);
      flatData.copy(fullData, 0, 0, Math.min(flatData.length, markerEndPos));

      let mOff = markerEndPos;
      for (let i = 0; i < MARKER_END.length; i++) {
        fullData[mOff++] = MARKER_END[i].r;
        fullData[mOff++] = MARKER_END[i].g;
        fullData[mOff++] = MARKER_END[i].b;
      }

      let raw: Buffer;
      let stride = 0;

      if (useManualPng) {
        stride = width * 3 + 1;
        raw = Buffer.alloc(height * stride);
        for (let row = 0; row < height; row++) {
          raw[row * stride] = 0;
          fullData.copy(raw, row * stride + 1, row * width * 3, (row + 1) * width * 3);
        }
      } else {
        raw = fullData;
      }

      if (opts.onProgress)
        opts.onProgress({ phase: 'png_gen', loaded: 0, total: height });

      if (useManualPng) {
        const bytesPerRow = width * 3;
        const scanlinesData = Buffer.alloc(height * (1 + bytesPerRow));

        const progressStep = Math.max(1, Math.floor(height / 20));
        for (let row = 0; row < height; row++) {
          scanlinesData[row * (1 + bytesPerRow)] = 0;
          const srcStart = row * stride + 1;
          const dstStart = row * (1 + bytesPerRow) + 1;
          raw.copy(scanlinesData, dstStart, srcStart, srcStart + bytesPerRow);

          if (opts.onProgress && row % progressStep === 0) {
            opts.onProgress({ phase: 'png_gen', loaded: row, total: height });
          }
        }

        if (opts.onProgress)
          opts.onProgress({ phase: 'png_compress', loaded: 0, total: 100 });

        const idatData = zlib.deflateSync(scanlinesData, {
          level: 0,
          memLevel: 8,
          strategy: zlib.constants.Z_FILTERED,
        });

        raw = Buffer.alloc(0);

        const ihdrData = Buffer.alloc(13);
        ihdrData.writeUInt32BE(width, 0);
        ihdrData.writeUInt32BE(height, 4);
        ihdrData[8] = 8;
        ihdrData[9] = 2;
        ihdrData[10] = 0;
        ihdrData[11] = 0;
        ihdrData[12] = 0;

        const ihdrType = Buffer.from('IHDR', 'utf8');
        const ihdrCrc = crc32(ihdrData, crc32(ihdrType));
        const ihdrCrcBuf = Buffer.alloc(4);
        ihdrCrcBuf.writeUInt32BE(ihdrCrc, 0);
        const ihdrLen = Buffer.alloc(4);
        ihdrLen.writeUInt32BE(ihdrData.length, 0);

        const idatType = Buffer.from('IDAT', 'utf8');
        const idatCrc = crc32(idatData, crc32(idatType));
        const idatCrcBuf = Buffer.alloc(4);
        idatCrcBuf.writeUInt32BE(idatCrc, 0);
        const idatLen = Buffer.alloc(4);
        idatLen.writeUInt32BE(idatData.length, 0);

        const iendType = Buffer.from('IEND', 'utf8');
        const iendCrc = crc32(Buffer.alloc(0), crc32(iendType));
        const iendCrcBuf = Buffer.alloc(4);
        iendCrcBuf.writeUInt32BE(iendCrc, 0);
        const iendLen = Buffer.alloc(4);
        iendLen.writeUInt32BE(0, 0);

        bufScr = Buffer.concat([
          PNG_HEADER,
          ihdrLen,
          ihdrType,
          ihdrData,
          ihdrCrcBuf,
          idatLen,
          idatType,
          idatData,
          idatCrcBuf,
          iendLen,
          iendType,
          iendCrcBuf,
        ]);
      } else {
        const outputFormat = opts.outputFormat || 'png';

        if (outputFormat === 'webp') {
          throw new Error(
            'WebP output format not supported with native backend',
          );
        } else {
          bufScr = Buffer.from(native.rgbToPng(raw, width, height));
        }
      }
    }

    payload.length = 0;
    dataWithMarkers.length = 0;
    metaPixel.length = 0;
    meta.length = 0;
    paddedData.length = 0;
    dataWithoutMarkers.length = 0;

    if (opts.onProgress)
      opts.onProgress({ phase: 'png_compress', loaded: 100, total: 100 });

    progressBar?.stop();
    return bufScr;
  }
}
