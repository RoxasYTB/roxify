import {
  compress as zstdCompress,
  decompress as zstdDecompress,
} from '@mongodb-js/zstd';
import { cpus } from 'os';

let nativeZstdCompress: ((data: Buffer, level: number) => Uint8Array) | null =
  null;
let nativeZstdDecompress: ((data: Buffer) => Uint8Array) | null = null;

try {
  const native = require('../../libroxify_native.node');
  if (native?.nativeZstdCompress) {
    nativeZstdCompress = native.nativeZstdCompress;
  }
  if (native?.nativeZstdDecompress) {
    nativeZstdDecompress = native.nativeZstdDecompress;
  }
} catch (e) {}

export async function compressStream(
  stream: AsyncGenerator<Buffer>,
  level: number = 19,
  onProgress?: (loaded: number, total: number) => void,
): Promise<{ chunks: Buffer[]; totalLength: number }> {
  const compressedChunks: Buffer[] = [];
  let chunkCount = 0;

  for await (const chunk of stream) {
    const compressed = await zstdCompress(chunk, level);
    compressedChunks.push(Buffer.from(compressed));
    chunkCount++;
    if (onProgress) onProgress(chunkCount, 0);
  }

  const chunkSizes = Buffer.alloc(compressedChunks.length * 4);
  let totalLength = 8 + chunkSizes.length;
  for (let i = 0; i < compressedChunks.length; i++) {
    chunkSizes.writeUInt32BE(compressedChunks[i].length, i * 4);
    totalLength += compressedChunks[i].length;
  }

  const header = Buffer.alloc(8);
  header.writeUInt32BE(0x5a535444, 0);
  header.writeUInt32BE(compressedChunks.length, 4);

  return {
    chunks: [header, chunkSizes, ...compressedChunks],
    totalLength,
  };
}

export async function parallelZstdCompress(
  payload: Buffer | Buffer[],
  level: number = 19,
  onProgress?: (loaded: number, total: number) => void,
): Promise<Buffer[]> {
  const chunkSize = 8 * 1024 * 1024;
  const chunks: Buffer[] = [];

  if (Array.isArray(payload)) {
    for (const p of payload) {
      if (p.length <= chunkSize) {
        chunks.push(p);
      } else {
        for (let i = 0; i < p.length; i += chunkSize) {
          chunks.push(p.subarray(i, Math.min(i + chunkSize, p.length)));
        }
      }
    }
  } else {
    if (payload.length <= chunkSize) {
      if (onProgress) onProgress(0, 1);
      const result = nativeZstdCompress
        ? Buffer.from(nativeZstdCompress(payload, level))
        : Buffer.from(await zstdCompress(payload, level));
      if (onProgress) onProgress(1, 1);
      return [result];
    }
    for (let i = 0; i < payload.length; i += chunkSize) {
      chunks.push(payload.subarray(i, Math.min(i + chunkSize, payload.length)));
    }
  }

  const totalChunks = chunks.length;
  let completedChunks = 0;

  const concurrency = Math.max(1, Math.min(4, cpus().length));
  const compressedChunks: Buffer[] = new Array(totalChunks);

  let idx = 0;

  const worker = async () => {
    while (true) {
      const cur = idx++;
      if (cur >= totalChunks) return;
      const chunk = chunks[cur];
      const compressed = nativeZstdCompress
        ? Buffer.from(nativeZstdCompress(chunk, level))
        : Buffer.from(await zstdCompress(chunk, level));
      compressedChunks[cur] = compressed;
      completedChunks++;
      if (onProgress) onProgress(completedChunks, totalChunks);
    }
  };

  await Promise.all(new Array(concurrency).fill(0).map(() => worker()));
  const chunkSizes = Buffer.alloc(compressedChunks.length * 4);
  for (let i = 0; i < compressedChunks.length; i++) {
    chunkSizes.writeUInt32BE(compressedChunks[i].length, i * 4);
  }

  const header = Buffer.alloc(8);
  header.writeUInt32BE(0x5a535444, 0);
  header.writeUInt32BE(compressedChunks.length, 4);

  return [header, chunkSizes, ...compressedChunks];
}

export async function parallelZstdDecompress(
  payload: Buffer,
  onProgress?: (info: {
    phase: string;
    loaded?: number;
    total?: number;
  }) => void,
): Promise<Buffer> {
  if (payload.length < 8) {
    onProgress?.({ phase: 'decompress_start', total: 1 });
    const d = nativeZstdDecompress
      ? Buffer.from(nativeZstdDecompress(payload))
      : Buffer.from(await zstdDecompress(payload));
    onProgress?.({ phase: 'decompress_progress', loaded: 1, total: 1 });
    onProgress?.({ phase: 'decompress_done', loaded: 1, total: 1 });
    return d;
  }

  const magic = payload.readUInt32BE(0);
  if (magic !== 0x5a535444) {
    if (process.env.ROX_DEBUG) console.log('tryZstdDecompress: invalid magic');
    onProgress?.({ phase: 'decompress_start', total: 1 });
    const d = nativeZstdDecompress
      ? Buffer.from(nativeZstdDecompress(payload))
      : Buffer.from(await zstdDecompress(payload));
    onProgress?.({ phase: 'decompress_progress', loaded: 1, total: 1 });
    onProgress?.({ phase: 'decompress_done', loaded: 1, total: 1 });
    return d;
  }

  const numChunks = payload.readUInt32BE(4);
  const chunkSizes: number[] = [];
  let offset = 8;

  for (let i = 0; i < numChunks; i++) {
    chunkSizes.push(payload.readUInt32BE(offset));
    offset += 4;
  }

  onProgress?.({ phase: 'decompress_start', total: numChunks });

  const decompressedChunks: Buffer[] = [];
  for (let i = 0; i < numChunks; i++) {
    const size = chunkSizes[i];
    const chunk = payload.slice(offset, offset + size);
    offset += size;

    const dec = nativeZstdDecompress
      ? Buffer.from(nativeZstdDecompress(chunk))
      : Buffer.from(await zstdDecompress(chunk));
    decompressedChunks.push(dec);

    onProgress?.({
      phase: 'decompress_progress',
      loaded: i + 1,
      total: numChunks,
    });
  }

  onProgress?.({
    phase: 'decompress_done',
    loaded: numChunks,
    total: numChunks,
  });

  return Buffer.concat(decompressedChunks);
}

export async function tryZstdDecompress(
  payload: Buffer,
  onProgress?: (info: {
    phase: string;
    loaded?: number;
    total?: number;
  }) => void,
): Promise<Buffer> {
  return await parallelZstdDecompress(payload, onProgress);
}
