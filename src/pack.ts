import { readFileSync, readdirSync, statSync } from 'fs';
import { readFile } from 'fs/promises';
import { extname, join, relative, resolve, sep } from 'path';

export interface PackedFile {
  path: string;
  buf: Buffer;
}

export interface VFSIndexEntry {
  path: string;
  blockId: number;
  offset: number;
  size: number;
}

function* collectFilesGenerator(paths: string[]): Generator<string> {
  for (const p of paths) {
    const abs = resolve(p);
    const st = statSync(abs);
    if (st.isFile()) {
      yield abs;
    } else if (st.isDirectory()) {
      const names = readdirSync(abs);
      const childPaths = names.map((n) => join(abs, n));
      yield* collectFilesGenerator(childPaths);
    }
  }
}

export function packPathsToParts(
  paths: string[],
  baseDir?: string,
  onProgress?: (
    readBytes: number,
    totalBytes: number,
    currentFile?: string,
  ) => void,
): { parts: Buffer[]; list: string[] } {
  const files: string[] = [];
  for (const f of collectFilesGenerator(paths)) {
    files.push(f);
  }
  const base = baseDir ? resolve(baseDir) : process.cwd();
  const parts: Buffer[] = [];
  const list: string[] = [];

  let total = 0;
  const sizes = files.map((f) => {
    const st = statSync(f);
    total += st.size;
    return st.size;
  });

  let readSoFar = 0;
  for (let idx = 0; idx < files.length; idx++) {
    const f = files[idx];
    const rel = relative(base, f).split(sep).join('/');
    const content = readFileSync(f);
    const nameBuf = Buffer.from(rel, 'utf8');
    const nameLen = Buffer.alloc(2);
    nameLen.writeUInt16BE(nameBuf.length, 0);
    const sizeBuf = Buffer.alloc(8);
    sizeBuf.writeBigUInt64BE(BigInt(content.length), 0);
    parts.push(nameLen, nameBuf, sizeBuf, content);
    list.push(rel);
    readSoFar += sizes[idx];
    if (onProgress) onProgress(readSoFar, total, rel);
  }

  const header = Buffer.alloc(8);
  header.writeUInt32BE(0x524f5850, 0);
  header.writeUInt32BE(files.length, 4);
  parts.unshift(header);
  return { parts, list };
}

export function packPaths(
  paths: string[],
  baseDir?: string,
  onProgress?: (
    readBytes: number,
    totalBytes: number,
    currentFile?: string,
  ) => void,
): { buf: Buffer; list: string[] } {
  const { parts, list } = packPathsToParts(paths, baseDir, onProgress);
  return { buf: Buffer.concat(parts), list };
}

export function unpackBuffer(
  buf: Buffer,
  fileList?: string[],
): { files: { path: string; buf: Buffer }[] } | null {
  if (buf.length < 8) return null;
  const magic = buf.readUInt32BE(0);

  if (magic === 0x524f5849) {
    const indexLen = buf.readUInt32BE(4);
    const indexBuf = buf.slice(8, 8 + indexLen);
    const index: VFSIndexEntry[] = JSON.parse(indexBuf.toString('utf8'));
    const dataStart = 8 + indexLen;

    const files: { path: string; buf: Buffer }[] = [];

    const entriesToProcess = fileList
      ? index.filter((e) => fileList.includes(e.path))
      : index;

    for (const entry of entriesToProcess) {
      const entryStart = dataStart + entry.offset;

      let ptr = entryStart;
      if (ptr + 2 > buf.length) continue;
      const nameLen = buf.readUInt16BE(ptr);
      ptr += 2;
      ptr += nameLen;
      ptr += 8;

      if (ptr + entry.size > buf.length) continue;
      const content = buf.slice(ptr, ptr + entry.size);
      files.push({ path: entry.path, buf: content });
    }
    return { files };
  }

  if (magic !== 0x524f5850) return null;
  const header = buf.slice(0, 8);
  const fileCount = header.readUInt32BE(4);
  let offset = 8;
  const files: { path: string; buf: Buffer }[] = [];
  for (let i = 0; i < fileCount; i++) {
    if (offset + 2 > buf.length) return null;
    const nameLen = buf.readUInt16BE(offset);
    offset += 2;
    if (offset + nameLen > buf.length) return null;
    const name = buf.slice(offset, offset + nameLen).toString('utf8');
    offset += nameLen;
    if (offset + 8 > buf.length) return null;
    const size = buf.readBigUInt64BE(offset);
    offset += 8;
    if (offset + Number(size) > buf.length) return null;
    const content = buf.slice(offset, offset + Number(size));
    offset += Number(size);
    files.push({ path: name, buf: content });
  }
  if (fileList) {
    const filtered = files.filter((f) => fileList.includes(f.path));
    return { files: filtered };
  }
  return { files };
}

export async function packPathsGenerator(
  paths: string[],
  baseDir?: string,
  onProgress?: (
    readBytes: number,
    totalBytes: number,
    currentFile?: string,
  ) => void,
): Promise<{
  index: VFSIndexEntry[];
  stream: AsyncGenerator<Buffer>;
  totalSize: number;
}> {
  const files: string[] = [];
  for (const f of collectFilesGenerator(paths)) {
    files.push(f);
  }

  files.sort((a, b) => {
    const extA = extname(a);
    const extB = extname(b);
    if (extA !== extB) return extA.localeCompare(extB);
    return a.localeCompare(b);
  });

  const base = baseDir ? resolve(baseDir) : process.cwd();

  const BLOCK_SIZE = 8 * 1024 * 1024;
  const index: VFSIndexEntry[] = [];
  let currentBlockId = 0;
  let currentBlockSize = 0;
  let globalDataOffset = 0;
  let totalSize = 0;

  for (const f of files) {
    const st = statSync(f);
    const rel = relative(base, f).split(sep).join('/');
    const nameBuf = Buffer.from(rel, 'utf8');

    const entrySize = 2 + nameBuf.length + 8 + st.size;

    if (currentBlockSize + entrySize > BLOCK_SIZE && currentBlockSize > 0) {
      currentBlockId++;
      currentBlockSize = 0;
    }

    index.push({
      path: rel,
      blockId: currentBlockId,
      offset: globalDataOffset,
      size: st.size,
    });

    currentBlockSize += entrySize;
    globalDataOffset += entrySize;
    totalSize += st.size;
  }

  async function* streamGenerator(): AsyncGenerator<Buffer> {
    const indexBuf = Buffer.from(JSON.stringify(index), 'utf8');
    const indexHeader = Buffer.alloc(8);
    indexHeader.writeUInt32BE(0x524f5849, 0);
    indexHeader.writeUInt32BE(indexBuf.length, 4);
    yield Buffer.concat([indexHeader, indexBuf]);

    let readSoFar = 0;
    const BATCH_SIZE = 1000;
    const chunks: Buffer[] = [];
    let chunkSize = 0;

    for (
      let batchStart = 0;
      batchStart < files.length;
      batchStart += BATCH_SIZE
    ) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, files.length);
      const batchFiles = files.slice(batchStart, batchEnd);

      const contentPromises = batchFiles.map(async (f) => {
        try {
          return await readFile(f);
        } catch (e) {
          return Buffer.alloc(0);
        }
      });
      const contents = await Promise.all(contentPromises);

      for (let i = 0; i < batchFiles.length; i++) {
        const f = batchFiles[i];
        const rel = relative(base, f).split(sep).join('/');
        const content = contents[i];

        const nameBuf = Buffer.from(rel, 'utf8');
        const nameLen = Buffer.alloc(2);
        nameLen.writeUInt16BE(nameBuf.length, 0);
        const sizeBuf = Buffer.alloc(8);
        sizeBuf.writeBigUInt64BE(BigInt(content.length), 0);

        const entry = Buffer.concat([nameLen, nameBuf, sizeBuf, content]);

        chunks.push(entry);
        chunkSize += entry.length;

        if (chunkSize >= BLOCK_SIZE) {
          yield Buffer.concat(chunks);
          chunks.length = 0;
          chunkSize = 0;
        }

        readSoFar += content.length;
        if (onProgress) onProgress(readSoFar, totalSize, rel);
      }
    }

    if (chunks.length > 0) {
      yield Buffer.concat(chunks);
    }
  }

  return { index, stream: streamGenerator(), totalSize };
}
