import fs from 'fs';
import sharp from 'sharp';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

async function testGradientBackground() {
  const iterations = 10;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < iterations; i++) {
    const testText = `Test message ${i} with gradient background!`;
    const inputBuffer = Buffer.from(testText, 'utf8');

    const pngBuffer = await encodeBinaryToPng(inputBuffer, {
      mode: 'screenshot',
      name: 'test.txt',
    });

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

    const canvasWidth = newWidth + 100;
    const canvasHeight = newHeight + 100;

    const offsetX = Math.floor(Math.random() * (canvasWidth - newWidth));
    const offsetY = Math.floor(Math.random() * (canvasHeight - newHeight));

    const gradStartR = Math.floor(Math.random() * 150) + 50;
    const gradStartG = Math.floor(Math.random() * 150) + 50;
    const gradStartB = Math.floor(Math.random() * 150) + 50;

    const gradEndR = Math.floor(Math.random() * 150) + 50;
    const gradEndG = Math.floor(Math.random() * 150) + 50;
    const gradEndB = Math.floor(Math.random() * 150) + 50;

    const gradient = Buffer.alloc(canvasWidth * canvasHeight * 3);
    for (let y = 0; y < canvasHeight; y++) {
      const ratio = y / (canvasHeight - 1);
      const r = Math.floor(gradStartR + (gradEndR - gradStartR) * ratio);
      const g = Math.floor(gradStartG + (gradEndG - gradStartG) * ratio);
      const b = Math.floor(gradStartB + (gradEndB - gradStartB) * ratio);

      for (let x = 0; x < canvasWidth; x++) {
        const idx = (y * canvasWidth + x) * 3;
        gradient[idx] = r;
        gradient[idx + 1] = g;
        gradient[idx + 2] = b;
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

    if (!fs.existsSync('test-output')) {
      fs.mkdirSync('test-output');
    }
    fs.writeFileSync(`test-output/gradient_${i}_canvas.png`, finalPng);

    try {
      const result = await decodePngToBinary(finalPng);
      const decodedText = result.buf.toString('utf8');

      if (decodedText === testText) {
        successCount++;
        console.log(
          `✓ Test ${i + 1}/${iterations}: scaleX=${scaleX.toFixed(
            2,
          )}, scaleY=${scaleY.toFixed(2)}, ` +
            `gradient RGB(${gradStartR},${gradStartG},${gradStartB})→(${gradEndR},${gradEndG},${gradEndB}), ` +
            `offset=(${offsetX},${offsetY})`,
        );
      } else {
        failCount++;
        console.log(
          `✗ Test ${
            i + 1
          }/${iterations}: FAILED - Expected: "${testText}", Got: "${decodedText}"`,
        );
      }
    } catch (err) {
      failCount++;
      console.log(`✗ Test ${i + 1}/${iterations}: ERROR - ${err.message}`);
    }
  }

  console.log(`\n╔════════════════════════════════════════════════════════╗`);
  console.log(
    `║  RÉSULTAT: ${successCount}/${iterations} tests réussis, ${failCount} échecs           ║`,
  );
  console.log(`╚════════════════════════════════════════════════════════╝`);

  if (failCount === 0) {
    console.log('\n✓ ROBUSTESSE VALIDÉE - Gradient backgrounds aléatoires');
  } else {
    console.log(`\n✗ ${failCount} ÉCHECS DÉTECTÉS`);
    process.exit(1);
  }
}

testGradientBackground().catch(console.error);

