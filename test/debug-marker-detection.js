import sharp from 'sharp';
import { encodeBinaryToPng } from '../dist/index.js';

const MARKER_START = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 255, b: 0 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 128, g: 128, b: 128 },
];

async function debugDetection() {
  const testText = 'Test message';
  const inputBuffer = Buffer.from(testText, 'utf8');

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  const metadata = await sharp(pngBuffer).metadata();
  console.log('Original:', metadata.width, 'x', metadata.height);

  const scaleX = 2.5;
  const scaleY = 2.5;

  const newWidth = Math.floor(metadata.width * scaleX);
  const newHeight = Math.floor(metadata.height * scaleY);

  const resizedPng = await sharp(pngBuffer)
    .resize(newWidth, newHeight, {
      kernel: 'nearest',
      fit: 'fill',
    })
    .png()
    .toBuffer();

  console.log('Resized:', newWidth, 'x', newHeight);

  const canvasWidth = newWidth + 100;
  const canvasHeight = newHeight + 100;

  const offsetX = 50;
  const offsetY = 50;

  const gradient = Buffer.alloc(canvasWidth * canvasHeight * 3);
  for (let y = 0; y < canvasHeight; y++) {
    for (let x = 0; x < canvasWidth; x++) {
      const idx = (y * canvasWidth + x) * 3;
      gradient[idx] = 100;
      gradient[idx + 1] = 120;
      gradient[idx + 2] = 110;
    }
  }

  const resizedRaw = await sharp(resizedPng).raw().toBuffer();
  const resizedMeta = await sharp(resizedPng).metadata();

  for (let y = 0; y < resizedMeta.height; y++) {
    for (let x = 0; x < resizedMeta.width; x++) {
      const srcIdx = (y * resizedMeta.width + x) * 3;
      const dstIdx = ((offsetY + y) * canvasWidth + (offsetX + x)) * 3;
      gradient[dstIdx] = resizedRaw[srcIdx];
      gradient[dstIdx + 1] = resizedRaw[srcIdx + 1];
      gradient[dstIdx + 2] = resizedRaw[srcIdx + 2];
    }
  }

  const finalPng = await sharp(gradient, {
    raw: { width: canvasWidth, height: canvasHeight, channels: 3 },
  })
    .png()
    .toBuffer();

  const { data } = await sharp(finalPng).raw().toBuffer({
    resolveWithObject: true,
  });

  console.log('Canvas:', canvasWidth, 'x', canvasHeight);
  console.log(
    'Encoded region should be at:',
    offsetX,
    offsetY,
    'size:',
    newWidth,
    'x',
    newHeight,
  );

  console.log('\nSearching for MARKER_START in canvas...');
  let found = false;
  for (let y = 0; y < canvasHeight && !found; y++) {
    for (let x = 0; x < canvasWidth - MARKER_START.length; x++) {
      let match = true;
      for (let mi = 0; mi < MARKER_START.length; mi++) {
        const px = x + mi;
        const idx = (y * canvasWidth + px) * 3;
        if (
          data[idx] !== MARKER_START[mi].r ||
          data[idx + 1] !== MARKER_START[mi].g ||
          data[idx + 2] !== MARKER_START[mi].b
        ) {
          match = false;
          break;
        }
      }
      if (match) {
        console.log('FOUND MARKER_START at pixel:', x, y);
        found = true;

        console.log('First 20 pixels from that position:');
        for (let i = 0; i < 20; i++) {
          const px = x + i;
          if (px >= canvasWidth) break;
          const idx = (y * canvasWidth + px) * 3;
          console.log(
            `  [${i}]: (${data[idx]},${data[idx + 1]},${data[idx + 2]})`,
          );
        }

        break;
      }
    }
  }

  if (!found) {
    console.log('MARKER_START NOT FOUND!');
    console.log('Showing pixels at expected position (50,50):');
    for (let i = 0; i < 10; i++) {
      const idx = (50 * canvasWidth + (50 + i)) * 3;
      console.log(`  [${i}]: (${data[idx]},${data[idx + 1]},${data[idx + 2]})`);
    }
  }
}

debugDetection().catch(console.error);

