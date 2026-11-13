import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeBinaryToPng, decodePngToBinary } from '../dist/index.js';

const json = readFileSync(new URL('../package-lock.json', import.meta.url));
const fast = await encodeBinaryToPng(json, { name: 'config.json' });
const maximum = await encodeBinaryToPng(json, { name: 'config.json', maxCompression: true });
assert.ok(maximum.length < fast.length, 'The max profile should reduce this JSON archive');
for (const png of [fast, maximum]) {
  const decoded = await decodePngToBinary(png);
  assert.deepEqual(decoded.buf, json);
  assert.equal(decoded.meta?.name, 'config.json');
}
console.log('PASS real native default/max JSON roundtrip and smaller PNG');

for (const input of [Buffer.alloc(0), Buffer.from('small\0binary\xff')]) {
  const png = await encodeBinaryToPng(input, { maxCompression: true, compressionLevel: 9 });
  assert.deepEqual((await decodePngToBinary(png)).buf, input);
}
console.log('PASS real native empty and small max-profile payloads');

const parts = [Buffer.alloc(2 * 1024 * 1024, 0x61), Buffer.alloc(2 * 1024 * 1024, 0x62)];
const png = await encodeBinaryToPng(parts, {
  name: 'parts.bin', maxCompression: true, compressionLevel: 9,
});
const decoded = await decodePngToBinary(png);
assert.deepEqual(decoded.buf, Buffer.concat(parts));
assert.equal(decoded.meta?.name, 'parts.bin');
console.log('PASS real native multipart max-profile payload');

const encrypted = await encodeBinaryToPng(json, {
  name: 'secret.json', maxCompression: true, compressionLevel: 9,
  passphrase: 'profile-regression-password', encrypt: 'aes',
  includeFileList: true, fileList: [{ name: 'secret.json', size: json.length }],
});
const decrypted = await decodePngToBinary(encrypted, { passphrase: 'profile-regression-password' });
assert.deepEqual(decrypted.buf, json);
assert.equal(decrypted.meta?.name, 'secret.json');
await assert.rejects(decodePngToBinary(encrypted, { passphrase: 'wrong-profile-password' }));
console.log('PASS real native AES max-profile roundtrip and wrong-password rejection');
