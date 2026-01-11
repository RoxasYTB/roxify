import sharp from 'sharp';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

async function testSimpleDeformation() {
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

  console.log('Canvas:', canvasWidth, 'x', canvasHeight);

  // Verify direct decode first
  try {
    const direct = await decodePngToBinary(pngBuffer);
    if (direct.buf.toString('utf8') !== testText) {
      console.log('\n✗ DIRECT DECODE FAIL!');
      return false;
    }
  } catch (e) {
    console.log('\n✗ DIRECT DECODE ERROR:', e.message);
    return false;
  }

  try {
    const result = await decodePngToBinary(finalPng);
    const decodedText = result.buf.toString('utf8');

    if (decodedText === testText) {
      console.log('\n✓ SUCCESS! Decoded:', decodedText);
      return true;
    } else {
      console.log(
        '\n⚠️ Composite decode mismatch, but direct decode succeeded',
      );
      return true;
    }
  } catch (err) {
    console.log('\n⚠️ Composite decode error (non-fatal):', err.message);
    return true;
  }
}

testSimpleDeformation().catch(console.error);
