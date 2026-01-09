import sharp from 'sharp';
import { encodeBinaryToPng } from '../dist/index.js';

async function testLongText() {
  const text = 'A'.repeat(200);
  const inputBuffer = Buffer.from(text, 'utf8');

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  console.log('PNG dimensions:', info.width, 'x', info.height);
  console.log('Total pixels:', info.width * info.height);

  const MARKER_START = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
  ];

  const MARKER_END = [
    { r: 128, g: 128, b: 128 },
    { r: 0, g: 255, b: 255 },
    { r: 255, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 0, g: 255, b: 0 },
    { r: 255, g: 0, b: 0 },
  ];

  console.log('\nLast 2 rows:');
  for (let y = info.height - 2; y < info.height; y++) {
    let rowStr = `Row ${y}: `;
    for (let x = 0; x < Math.min(info.width, 10); x++) {
      const idx = (y * info.width + x) * 3;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      rowStr += `(${r},${g},${b}) `;
    }
    if (info.width > 10) rowStr += '...';
    console.log(rowStr);
  }

  const lastRow = info.height - 1;
  const lastRowStart = lastRow * info.width * 3;
  console.log('\nLast 7 pixels of last row:');
  for (let i = 0; i < 7; i++) {
    const x = info.width - 7 + i;
    const idx = lastRowStart + x * 3;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    console.log(
      `  Pixel ${x}: (${r},${g},${b}) - Expected MARKER_END[${i}]: (${MARKER_END[i].r},${MARKER_END[i].g},${MARKER_END[i].b})`,
    );
  }

  let allBlack = true;
  for (let x = 0; x < info.width - 7; x++) {
    const idx = lastRowStart + x * 3;
    if (data[idx] !== 0 || data[idx + 1] !== 0 || data[idx + 2] !== 0) {
      console.log(
        `  Non-black pixel at x=${x}: (${data[idx]},${data[idx + 1]},${
          data[idx + 2]
        })`,
      );
      allBlack = false;
      break;
    }
  }

  if (allBlack) {
    console.log('\nLast row is all black except MARKER_END at end');
  } else {
    console.log('\nLast row has non-black pixels (data row, not padding)');
  }
}

testLongText().catch(console.error);

