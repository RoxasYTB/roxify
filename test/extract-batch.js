import fs from 'fs';
import sharp from 'sharp';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

async function runSample(i) {
  const name = `sample-${i}.txt`;
  const text = `Sample ${i} - test at ${new Date().toISOString()} - rand:${Math.floor(
    Math.random() * 1e6,
  )}`;
  const buf = Buffer.from(text, 'utf8');
  fs.writeFileSync(`original-${i}.txt`, buf);

  const encodedPng = await encodeBinaryToPng(buf, {
    mode: 'screenshot',
    name,
    compression: 'br',
    brQuality: 1,
  });

  const { data: encodedData, info: encodedInfo } = await sharp(encodedPng)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const scale = 1 + Math.floor(Math.random() * 4);
  const offsetX = 5 + Math.floor(Math.random() * 30);
  const offsetY = 5 + Math.floor(Math.random() * 30);

  const ENCODER_INTERNAL_SCALE = 2;
  const finalWidth =
    encodedInfo.width * scale * ENCODER_INTERNAL_SCALE + offsetX + 20;
  const finalHeight =
    encodedInfo.height * scale * ENCODER_INTERNAL_SCALE + offsetY + 20;

  const finalImage = Buffer.alloc(finalWidth * finalHeight * 3);
  for (let y = 0; y < finalHeight; y++) {
    for (let x = 0; x < finalWidth; x++) {
      const idx = (y * finalWidth + x) * 3;
      finalImage[idx] = Math.floor((x / finalWidth) * 200 + 20);
      finalImage[idx + 1] = Math.floor((y / finalHeight) * 180 + 30);
      finalImage[idx + 2] = Math.floor(
        ((x + y) / (finalWidth + finalHeight)) * 160 + 40,
      );
    }
  }

  for (let sy = 0; sy < encodedInfo.height; sy++) {
    for (let sx = 0; sx < encodedInfo.width; sx++) {
      const srcIdx = (sy * encodedInfo.width + sx) * 3;
      const r = encodedData[srcIdx];
      const g = encodedData[srcIdx + 1];
      const b = encodedData[srcIdx + 2];
      for (let dy = 0; dy < scale * ENCODER_INTERNAL_SCALE; dy++) {
        for (let dx = 0; dx < scale * ENCODER_INTERNAL_SCALE; dx++) {
          const destX = offsetX + sx * scale * ENCODER_INTERNAL_SCALE + dx;
          const destY = offsetY + sy * scale * ENCODER_INTERNAL_SCALE + dy;
          if (
            destX >= 0 &&
            destX < finalWidth &&
            destY >= 0 &&
            destY < finalHeight
          ) {
            const dstIdx = (destY * finalWidth + destX) * 3;
            finalImage[dstIdx] = r;
            finalImage[dstIdx + 1] = g;
            finalImage[dstIdx + 2] = b;
          }
        }
      }
    }
  }

  const finalPng = await sharp(finalImage, {
    raw: { width: finalWidth, height: finalHeight, channels: 3 },
  })
    .png({ compressionLevel: 0, palette: false, adaptiveFiltering: false })
    .toBuffer();

  fs.writeFileSync(`sample-final-${i}.png`, finalPng);

  const renamed = `renammed-${i}.txt`;
  fs.writeFileSync(renamed, finalPng);

  try {
    const res = await decodePngToBinary(fs.readFileSync(renamed));
    const decoded = res.buf.toString('utf8');
    const decodedName = res.meta?.name;

    const okName = decodedName === name;
    const okContent = decoded === text;

    return {
      i,
      name,
      decodedName,
      text,
      decoded,
      ok: okName && okContent,
      okName,
      okContent,
    };
  } catch (e) {
    return { i, name, error: e.message || String(e), ok: false };
  }
}

async function main() {
  const results = [];
  for (let i = 0; i < 10; i++) {
    process.stdout.write(`Running sample ${i}... `);

    await new Promise((r) => setTimeout(r, 50));
    const r = await runSample(i);
    results.push(r);
    if (r.ok) console.log('OK');
    else
      console.log(
        'FAILED',
        r.error || 'name:' + r.okName + ' content:' + r.okContent,
      );
  }

  let pass = 0;
  for (const r of results) {
    if (r.ok) pass++;
    else console.log('Failure detail:', r);
  }

  console.log(`\nSummary: ${pass}/${results.length} passed`);
  if (pass !== results.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

