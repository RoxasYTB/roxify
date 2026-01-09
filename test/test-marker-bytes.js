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

console.log('MARKER_START:');
MARKER_START.forEach((c, i) =>
  console.log(`  ${i}: RGB(${c.r}, ${c.g}, ${c.b})`),
);

console.log('\nMARKER_END:');
MARKER_END.forEach((c, i) =>
  console.log(`  ${i}: RGB(${c.r}, ${c.g}, ${c.b})`),
);

const startBytes = colorsToBytes(MARKER_START);
const endBytes = colorsToBytes(MARKER_END);

console.log('\nSTART bytes:', startBytes.toString('hex'));
console.log('END bytes:', endBytes.toString('hex'));

