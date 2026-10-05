// Run after building TypeScript and the native module: node scripts/check-native-api.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as api from '../dist/index.js';

assert.equal(typeof api.native.nativeEncodePngParts, 'function');
assert.equal(typeof api.native.nativeDecodePng, 'function');

const input = Buffer.from('hello\0world: café 文\n'.repeat(500));
const parts = [Buffer.alloc(0), ...Array.from({ length: Math.ceil(input.length / 97) },
  (_, i) => input.subarray(i * 97, (i + 1) * 97)), Buffer.alloc(0)];
const unchanged = Buffer.from(input);
for (const name of [undefined, 'fichier.bin']) {
  for (const data of [Buffer.alloc(0), [], [Buffer.alloc(0)], input, parts]) {
    const expected = Array.isArray(data) ? Buffer.concat(data) : data;
    const png = await api.encodeBinaryToPng(data, { name });
    const result = await api.decodePngToBinary(png);
    assert.deepEqual(result.buf, expected);
    assert.equal(result.meta.name, name);
    assert.deepEqual(png, await api.encodeBinaryToPng(expected, { name }));
  }
}

for (const encrypt of ['xor', 'aes']) {
  const options = { encrypt, passphrase: 'clé-文', name: 'encrypted.bin' };
  const png = await api.encodeBinaryToPng(parts, options);
  const result = await api.decodePngToBinary(png, options);
  assert.deepEqual(result.buf, input);
  assert.equal(result.meta.name, options.name);
  await assert.rejects(api.decodePngToBinary(png), api.PassphraseRequiredError);
  if (encrypt === 'aes') {
    await assert.rejects(api.decodePngToBinary(png, { passphrase: 'wrong' }), api.IncorrectPassphraseError);
  }
}
assert.deepEqual(input, unchanged, 'encoding or decoding mutated the caller input');
await assert.rejects(api.decodePngToBinary(Buffer.from('invalid')));

const large = Buffer.allocUnsafe(4 * 1024 * 1024 + 17);
for (let i = 0; i < large.length; i++) large[i] = (i * 31 + Math.floor(i / 7)) & 255;
const largeParts = [large.subarray(0, 13), large.subarray(13)];
for (const options of [{}, { passphrase: 'clé-文', encrypt: 'xor' }, { passphrase: 'clé-文', encrypt: 'aes' }]) {
  const png = await api.encodeBinaryToPng(largeParts, options);
  assert.deepEqual((await api.decodePngToBinary(png, options)).buf, large);
  if (options.encrypt !== 'aes') assert.deepEqual(png, await api.encodeBinaryToPng(large, options));
}
const directParts = api.native.nativeEncodePngParts(parts, 3, undefined, undefined, undefined, undefined);
assert.deepEqual((await api.decodePngToBinary(directParts)).buf, input);

const dir = mkdtempSync(join(tmpdir(), 'roxify-api-'));
try {
  mkdirSync(join(dir, 'nested'));
  writeFileSync(join(dir, 'empty.txt'), '');
  writeFileSync(join(dir, 'nested', 'data.bin'), input);
  const packed = api.packPathsToParts([dir], dir);
  const png = await api.encodeBinaryToPng(packed.parts, {
    name: 'archive', includeFileList: true,
    fileList: [{ name: 'empty.txt', size: 0 }, { name: 'nested/data.bin', size: input.length }],
  });
  const result = await api.decodePngToBinary(png);
  assert.equal(result.meta.name, 'archive');
  assert.deepEqual(result.files.map(f => f.path), ['empty.txt', 'nested/data.bin']);
  assert.deepEqual(result.files.map(f => f.buf), [Buffer.alloc(0), input]);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Exercise the public wrappers with the new optional exports unavailable.
const require = createRequire(import.meta.url);
const binding = Object.values(require.cache).map(mod => mod.exports)
  .find(exports => exports?.nativeDecodePng === api.native.nativeDecodePng);
assert.ok(binding, 'native module was not found in the require cache');
const descriptors = Object.fromEntries(['nativeDecodePng', 'nativeEncodePngParts']
  .map(key => [key, Object.getOwnPropertyDescriptor(binding, key)]));
try {
  for (const key of Object.keys(descriptors)) {
    Object.defineProperty(binding, key, { ...descriptors[key], value: undefined });
  }
  const png = await api.encodeBinaryToPng(parts);
  assert.deepEqual((await api.decodePngToBinary(png)).buf, input);
  const largePng = await api.encodeBinaryToPng(largeParts);
  assert.deepEqual((await api.decodePngToBinary(largePng)).buf, large);
} finally {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    Object.defineProperty(binding, key, descriptor);
  }
}
console.log('Native API roundtrips, encryption errors, archives and export fallbacks passed.');
