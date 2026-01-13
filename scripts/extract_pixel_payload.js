import fs from 'fs';

const PIXEL_MAGIC = Buffer.from('PXL1');
const MARKER_END = [{ r: 0, g: 0, b: 0 }];

const buf = fs.readFileSync('extracted-pixel-bytes.bin');
console.log('len', buf.length);
const found = buf.indexOf(PIXEL_MAGIC);
console.log('PIXEL_MAGIC index', found);
const startIdx = found === 0 ? PIXEL_MAGIC.length : found + PIXEL_MAGIC.length;
let idx = startIdx;
const version = buf[idx++];
const nameLen = buf[idx++];
console.log('version', version, 'nameLen', nameLen);
const name = buf.slice(idx, idx + nameLen).toString('utf8');
idx += nameLen;
const payloadLen = buf.readUInt32BE(idx);
idx += 4;
console.log('payloadLen', payloadLen);
const rawPayload = buf.slice(idx, idx + payloadLen);
fs.writeFileSync('extracted-payload.bin', rawPayload);
console.log('wrote extracted-payload.bin', rawPayload.length);

const head = rawPayload.slice(0, 64).toString('hex');
console.log('raw head hex:', head);
