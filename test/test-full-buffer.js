const MARKER_COLORS = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 255, b: 0 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 128, g: 128, b: 128 },
];

const MARKER_START = MARKER_COLORS;
const MARKER_END = [...MARKER_COLORS].reverse();

function colorsToBytes(colors) {
  const buf = Buffer.alloc(colors.length * 3);
  for (let i = 0; i < colors.length; i++) {
    buf[i * 3] = colors[i].r;
    buf[i * 3 + 1] = colors[i].g;
    buf[i * 3 + 2] = colors[i].b;
  }
  return buf;
}

const PIXEL_MAGIC = Buffer.from('PXL1');
const testText = 'Hello!';
const payload = Buffer.from([1, 2, 3, 4, 5]);

const nameBuf = Buffer.from('test.txt', 'utf8');
const nameLen = nameBuf.length;
const payloadLenBuf = Buffer.alloc(4);
payloadLenBuf.writeUInt32BE(payload.length, 0);

const metaPixel = Buffer.concat([
  Buffer.from([nameLen]),
  nameBuf,
  payloadLenBuf,
  payload,
]);

const header = Buffer.concat([PIXEL_MAGIC, Buffer.from([2])]);
const dataWithoutMarkers = Buffer.concat([header, metaPixel]);

const markerStartBytes = colorsToBytes(MARKER_START);
const markerEndBytes = colorsToBytes(MARKER_END);

const full = Buffer.concat([
  markerStartBytes,
  dataWithoutMarkers,
  markerEndBytes,
]);

console.log('Full buffer length:', full.length);
console.log('Full buffer (hex):', full.toString('hex'));

console.log('\nDécomposition par pixels (RGB):');
for (let i = 0; i < Math.ceil(full.length / 3); i++) {
  const r = i * 3 < full.length ? full[i * 3] : 0;
  const g = i * 3 + 1 < full.length ? full[i * 3 + 1] : 0;
  const b = i * 3 + 2 < full.length ? full[i * 3 + 2] : 0;
  console.log(`Pixel ${i}: RGB(${r}, ${g}, ${b})`);
}

console.log('\nMarqueur END attendu aux derniers 7 pixels:');
MARKER_END.forEach((c, i) =>
  console.log(`  ${i}: RGB(${c.r}, ${c.g}, ${c.b})`),
);

