import sharp from 'sharp';
import { decodePngToBinary } from '../dist/index.js';

async function run() {
  const MARKER_START = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
  ];

  const rawData = Buffer.alloc(3 * 10 * 10);
  for (let i = 0; i < MARKER_START.length; i++) {
    rawData[i * 3] = MARKER_START[i].r;
    rawData[i * 3 + 1] = MARKER_START[i].g;
    rawData[i * 3 + 2] = MARKER_START[i].b;
  }
  for (let i = MARKER_START.length; i < 20; i++) {
    rawData[i * 3] = 50 + i;
    rawData[i * 3 + 1] = 50 + i;
    rawData[i * 3 + 2] = 50 + i;
  }

  const pngWithoutEnd = await sharp(rawData, {
    raw: { width: 10, height: 10, channels: 3 },
  })
    .png()
    .toBuffer();

  try {
    const res = await decodePngToBinary(pngWithoutEnd);
    console.log('Decoded unexpectedly:', res);
  } catch (err) {
    console.log('Expected failure:', err.message);
  }
}

run().catch(console.error);

