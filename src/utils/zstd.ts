import { native } from './native.js';

let nativeZstdCompress: ((data: Buffer, level: number) => Uint8Array) | null =
  null;
let nativeZstdCompressWithDict:
  | ((data: Buffer, level: number, dict: Buffer) => Uint8Array)
  | null = null;
let nativeZstdDecompress: ((data: Buffer) => Uint8Array) | null = null;

try {
  if (native?.nativeZstdCompress) {
    nativeZstdCompress = native.nativeZstdCompress;
  }
  if (native?.nativeZstdCompressWithDict) {
    nativeZstdCompressWithDict = native.nativeZstdCompressWithDict;
  }
  if (native?.nativeZstdDecompress) {
    nativeZstdDecompress = native.nativeZstdDecompress;
  }
} catch (e) {}

export async function compressStream(
  stream: AsyncGenerator<Buffer>,
  level: number = 19,
  onProgress?: (loaded: number, total: number) => void,
  dict?: Buffer,
): Promise<{ chunks: Buffer[]; totalLength: number }> {
  const compressedChunks: Buffer[] = [];
  let chunkCount = 0;

  for await (const chunk of stream) {
    if (!nativeZstdCompress && !nativeZstdCompressWithDict) {
      throw new Error('Native zstd compression not available');
    }
    const compressed = Buffer.from(
      nativeZstdCompressWithDict && dict ?
        nativeZstdCompressWithDict(chunk, level, dict)
        // fall back to plain
      : nativeZstdCompress!(chunk, level),
    );
    compressedChunks.push(compressed);
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
  dict?: Buffer,
): Promise<Buffer[]> {
  const chunkSize = 32 * 1024 * 1024;

  // For small payloads (< chunkSize), concatenate and compress as single frame
  // to avoid multi-chunk overhead (16+ bytes header per chunk boundary).
  let flat: Buffer | null = null;
  if (Array.isArray(payload)) {
    const totalLen = payload.reduce((a, b) => a + b.length, 0);
    if (totalLen <= chunkSize) {
      flat = Buffer.concat(payload);
    }
  } else {
    flat = payload;
  }

  if (flat && flat.length <= chunkSize) {
    if (onProgress) onProgress(0, 1);
    if (!nativeZstdCompress && !nativeZstdCompressWithDict) {
      throw new Error('Native zstd compression not available');
    }
    const result = Buffer.from(
      nativeZstdCompressWithDict && dict ?
        nativeZstdCompressWithDict(flat, level, dict)
      : nativeZstdCompress!(flat, level),
    );
    if (onProgress) onProgress(1, 1);
    return [result];
  }

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
    for (let i = 0; i < payload.length; i += chunkSize) {
      chunks.push(payload.subarray(i, Math.min(i + chunkSize, payload.length)));
    }
  }

  const totalChunks = chunks.length;
  const compressedChunks: Buffer[] = [];

  if (!nativeZstdCompress && !nativeZstdCompressWithDict) {
    throw new Error('Native zstd compression not available');
  }

  for (let i = 0; i < totalChunks; i++) {
    const compressed = Buffer.from(
      nativeZstdCompressWithDict && dict ?
        nativeZstdCompressWithDict(chunks[i], level, dict)
      : nativeZstdCompress!(chunks[i], level),
    );
    compressedChunks.push(compressed);
    if (onProgress) onProgress(i + 1, totalChunks);
  }

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
    if (!nativeZstdDecompress) {
      throw new Error('Native zstd decompression not available');
    }
    const d = Buffer.from(nativeZstdDecompress(payload));
    onProgress?.({ phase: 'decompress_progress', loaded: 1, total: 1 });
    onProgress?.({ phase: 'decompress_done', loaded: 1, total: 1 });
    return d;
  }

  const magic = payload.readUInt32BE(0);
  if (magic !== 0x5a535444) {
    if (process.env.ROX_DEBUG) console.log('tryZstdDecompress: invalid magic');
    onProgress?.({ phase: 'decompress_start', total: 1 });
    if (!nativeZstdDecompress) {
      throw new Error('Native zstd decompression not available');
    }
    const d = Buffer.from(nativeZstdDecompress(payload));
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
    const chunk = payload.subarray(offset, offset + size);
    offset += size;

    if (!nativeZstdDecompress) {
      throw new Error('Native zstd decompression not available');
    }
    const dec = Buffer.from(nativeZstdDecompress(chunk));
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
