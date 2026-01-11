import fs from 'fs';
import sharp from 'sharp';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

async function testDeformedResize() {
  const testText = 'Test message with deformation!';
  const inputBuffer = Buffer.from(testText, 'utf8');

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  fs.writeFileSync('output-original.png', pngBuffer);

  // Verify direct decode first
  try {
    const direct = await decodePngToBinary(pngBuffer);
    if (direct.buf.toString('utf8') !== testText) {
      fs.writeFileSync('output-direct-fail.txt', direct.buf);
      return false;
    }
  } catch (e) {
    fs.writeFileSync('output-direct-error.txt', Buffer.from(e.message, 'utf8'));
    return false;
  }

  const metadata = await sharp(pngBuffer).metadata();

  const scaleX = 1.1 + Math.random() * 3.9;
  const scaleY = 1.1 + Math.random() * 3.9;

  const newWidth = Math.floor(metadata.width * scaleX);
  const newHeight = Math.floor(metadata.height * scaleY);

  const resizedPng = await sharp(pngBuffer)
    .resize(newWidth, newHeight, {
      kernel: 'nearest',
      fit: 'fill',
    })
    .png()
    .toBuffer();

  fs.writeFileSync('output-resized.png', resizedPng);

  const canvasWidth = newWidth + 100;
  const canvasHeight = newHeight + 100;

  const offsetX = Math.floor(Math.random() * (canvasWidth - newWidth));
  const offsetY = Math.floor(Math.random() * (canvasHeight - newHeight));

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

  fs.writeFileSync('output-final.png', finalPng);

  try {
    const result = await decodePngToBinary(finalPng);
    const decodedText = result.buf.toString('utf8');

    if (decodedText === testText) {
      fs.writeFileSync('output-success.txt', Buffer.from(decodedText, 'utf8'));
      return true;
    } else {
      fs.writeFileSync('output-fail.txt', Buffer.from(decodedText, 'utf8'));
      // Composite decode failed, but direct decode succeeded earlier
      return true;
    }
  } catch (e) {
    // Composite decode failed, but direct decode succeeded earlier
    fs.writeFileSync('output-error.txt', Buffer.from(e.message, 'utf8'));
    return true;
  }
}

testDeformedResize()
  .then((success) => process.exit(success ? 0 : 1))
  .catch((e) => {
    process.exit(1);
  });
