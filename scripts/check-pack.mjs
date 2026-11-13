import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';
import { packPaths, packPathsGenerator, unpackBuffer } from '../dist/pack.js';

const BLOCK_SIZE = 8 * 1024 * 1024;
const root = mkdtempSync(join(tmpdir(), 'roxify-pack-test-'));

function collect(paths) {
  return paths.flatMap((path) => statSync(path).isDirectory()
    ? collect(readdirSync(path).map((name) => join(path, name)))
    : [resolve(path)]);
}

// Reference the archive format directly so byte and block-boundary regressions
// are detected independently of the generator implementation.
function reference(paths, base, indexed) {
  const files = collect(paths);
  if (indexed) files.sort((a, b) => extname(a).localeCompare(extname(b)) || a.localeCompare(b));
  let offset = 0;
  let blockId = 0;
  let blockSize = 0;
  const index = [];
  const entries = files.map((file) => {
    const path = relative(base, file).split(sep).join('/');
    const content = readFileSync(file);
    const name = Buffer.from(path);
    const entry = Buffer.alloc(10 + name.length + content.length);
    entry.writeUInt16BE(name.length, 0);
    name.copy(entry, 2);
    entry.writeBigUInt64BE(BigInt(content.length), 2 + name.length);
    content.copy(entry, 10 + name.length);
    if (blockSize > 0 && blockSize + entry.length > BLOCK_SIZE) {
      blockId++;
      blockSize = 0;
    }
    index.push({ path, blockId, offset, size: content.length });
    offset += entry.length;
    blockSize += entry.length;
    return entry;
  });
  const header = Buffer.alloc(8);
  if (!indexed) {
    header.write('ROXP');
    header.writeUInt32BE(files.length, 4);
    return { chunks: [Buffer.concat([header, ...entries])], index };
  }
  const json = Buffer.from(JSON.stringify(index));
  header.write('ROXI');
  header.writeUInt32BE(json.length, 4);
  const chunks = [Buffer.concat([header, json])];
  let pending = [];
  let bytes = 0;
  for (const entry of entries) {
    pending.push(entry);
    bytes += entry.length;
    if (bytes >= BLOCK_SIZE) {
      chunks.push(Buffer.concat(pending));
      pending = [];
      bytes = 0;
    }
  }
  if (pending.length) chunks.push(Buffer.concat(pending));
  return { chunks, index };
}

async function verify(name, fixture) {
  const base = join(root, name);
  mkdirSync(base, { recursive: true });
  for (const [name, content] of fixture) {
    const file = join(base, name);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, content);
  }
  const expected = reference([base], base, true);
  const { stream, index, totalSize } = await packPathsGenerator([base], base);
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  assert.deepEqual(index, expected.index, `${name}: index`);
  assert.deepEqual(chunks, expected.chunks, `${name}: exact ROXI bytes and block boundaries`);
  assert.equal(totalSize, fixture.reduce((n, [, content]) => n + content.length, 0));
  for (const [fileName, content] of fixture) {
    const file = unpackBuffer(Buffer.concat(chunks)).files.find((f) => f.path === fileName);
    assert.deepEqual(file?.buf, content, `${name}: extracted ${fileName}`);
  }
  const packed = packPaths([base], base);
  assert.deepEqual(packed.buf, reference([base], base, false).chunks[0], `${name}: exact ROXP bytes`);
  console.log(`PASS ${name}`);
}

try {
  await verify('empty', []);
  await verify('small', [
    ['zero.bin', Buffer.alloc(0)],
    ['nested/données.txt', Buffer.from('bonjour\0\xff')],
    ['nested/second.txt', Buffer.from([0, 1, 128, 255])],
  ]);
  await verify('exact-boundary', [
    ['a.bin', Buffer.alloc(BLOCK_SIZE - 15, 0x75)],
    ['b.bin', Buffer.alloc(0)],
  ]);
  await verify('large-and-multiple-blocks', [
    ['a.bin', Buffer.alloc(BLOCK_SIZE + 17, 0xa6)],
    ['b.bin', Buffer.alloc(BLOCK_SIZE / 2, 0x39)],
    ['c.bin', Buffer.alloc(BLOCK_SIZE / 2, 0xcc)],
    ['d.bin', Buffer.alloc(0)],
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}
