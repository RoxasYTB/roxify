const { encodeBinaryToPng, MARKER_END, MARKER_START } = require('./dist/index.js');
const { PNG } = require('pngjs');
const fs = require('fs');

async function check() {
  const data = Buffer.from('Hello World - testing MARKER_END placement');
  const pngBuffer = await encodeBinaryToPng(data, { name: 'test.txt' });

  fs.writeFileSync('test_marker_check.png', pngBuffer);
  console.log('PNG size:', pngBuffer.length, 'bytes');

  const img = PNG.sync.read(pngBuffer);
  const w = img.width;
  const h = img.height;
  const totalPixels = w * h;
  console.log('Image:', w, 'x', h, '=', totalPixels, 'pixels');

  const rgba = img.data;

  const first3 = [];
  for (let i = 0; i < 3; i++) {
    const idx = i * 4;
    first3.push([rgba[idx], rgba[idx + 1], rgba[idx + 2]]);
  }
  console.log('First 3 pixels (MARKER_START expected [255,0,0],[0,255,0],[0,0,255]):', JSON.stringify(first3));

  const last3 = [];
  for (let i = 0; i < 3; i++) {
    const idx = (totalPixels - 3 + i) * 4;
    last3.push([rgba[idx], rgba[idx + 1], rgba[idx + 2]]);
  }
  console.log('Last 3 pixels (MARKER_END expected [0,0,255],[0,255,0],[255,0,0]):', JSON.stringify(last3));

  const startOk = first3[0][0] === 255 && first3[0][1] === 0 && first3[0][2] === 0
    && first3[1][0] === 0 && first3[1][1] === 255 && first3[1][2] === 0
    && first3[2][0] === 0 && first3[2][1] === 0 && first3[2][2] === 255;

  const endOk = last3[0][0] === 0 && last3[0][1] === 0 && last3[0][2] === 255
    && last3[1][0] === 0 && last3[1][1] === 255 && last3[1][2] === 0
    && last3[2][0] === 255 && last3[2][1] === 0 && last3[2][2] === 0;

  console.log('MARKER_START correct:', startOk);
  console.log('MARKER_END correct:', endOk);

  if (!endOk) {
    console.log('\n--- Scanning for MARKER_END pattern anywhere in image ---');
    for (let p = 0; p < totalPixels - 2; p++) {
      const i0 = p * 4;
      const i1 = (p + 1) * 4;
      const i2 = (p + 2) * 4;
      if (rgba[i0] === 0 && rgba[i0 + 1] === 0 && rgba[i0 + 2] === 255
        && rgba[i1] === 0 && rgba[i1 + 1] === 255 && rgba[i1 + 2] === 0
        && rgba[i2] === 255 && rgba[i2 + 1] === 0 && rgba[i2 + 2] === 0) {
        console.log('Found MARKER_END at pixel', p, '/', totalPixels, '(', ((p / totalPixels) * 100).toFixed(1), '%)');
        console.log('  Distance from end:', totalPixels - p - 3, 'pixels');
      }
    }

    console.log('\n--- Last 20 pixels ---');
    for (let i = Math.max(0, totalPixels - 20); i < totalPixels; i++) {
      const idx = i * 4;
      console.log(`  Pixel ${i}: [${rgba[idx]}, ${rgba[idx + 1]}, ${rgba[idx + 2]}]`);
    }
  }
}

check().catch(console.error);
