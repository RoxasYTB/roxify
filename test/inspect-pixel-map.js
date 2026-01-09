import fs from 'fs';
import sharp from 'sharp';
import { encodeBinaryToPng } from '../dist/index.js';

const MARKER_COLORS = [
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 255, b: 0 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 128, g: 128, b: 128 },
];

async function run() {
  const inputBuffer = Buffer.from(
    'Test message that is a bit longer to create multiple rows',
    'utf8',
  );
  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  fs.writeFileSync('inspect-test.png', pngBuffer);

  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 3;
  const currentWidth = info.width;
  const currentHeight = info.height;
  const currentData = data;

  const MARKER_START = MARKER_COLORS;
  let markerStartPos = null;
  let scale = 0;
  for (let y = 0; y < currentHeight && !markerStartPos; y++) {
    for (let x = 0; x < currentWidth && !markerStartPos; x++) {
      for (
        let testScale = 1;
        testScale <= Math.min(currentWidth, currentHeight);
        testScale++
      ) {
        if (
          x + MARKER_START.length * testScale > currentWidth ||
          y + testScale > currentHeight
        )
          break;
        let allMatch = true;
        for (let mi = 0; mi < MARKER_START.length && allMatch; mi++) {
          for (let sy = 0; sy < testScale && allMatch; sy++) {
            for (let sx = 0; sx < testScale && allMatch; sx++) {
              const checkX = x + mi * testScale + sx;
              const checkY = y + sy;
              const idx = (checkY * currentWidth + checkX) * channels;
              if (
                currentData[idx] !== MARKER_START[mi].r ||
                currentData[idx + 1] !== MARKER_START[mi].g ||
                currentData[idx + 2] !== MARKER_START[mi].b
              ) {
                allMatch = false;
              }
            }
          }
        }
        if (allMatch) {
          markerStartPos = { x, y };
          scale = testScale;
          break;
        }
      }
    }
  }

  console.log('found MARKER_START at', markerStartPos, 'scale', scale);

  const cropX = markerStartPos.x;
  const cropY = markerStartPos.y;
  let cropWidth = currentWidth - cropX;
  let cropHeight = currentHeight - cropY;

  let endFound = false;
  let endX = -1;
  let endY = -1;
  for (let y0 = cropY; y0 < currentHeight && !endFound; y0++) {
    for (
      let x0 = cropX;
      x0 + MARKER_START.length * scale <= currentWidth && !endFound;
      x0++
    ) {
      let ok = true;
      for (let mi = 0; mi < MARKER_START.length && ok; mi++) {
        for (let sy = 0; sy < scale && ok; sy++) {
          for (let sx = 0; sx < scale && ok; sx++) {
            const px = x0 + mi * scale + sx;
            const py = y0 + sy;
            const idx = (py * currentWidth + px) * channels;
            if (
              currentData[idx] !== MARKER_START[mi].r ||
              currentData[idx + 1] !== MARKER_START[mi].g ||
              currentData[idx + 2] !== MARKER_START[mi].b
            ) {
              ok = false;
            }
          }
        }
      }
      if (ok) {
        endFound = true;
        endX = x0;
        endY = y0;
      }
    }
  }

  console.log('found MARKER_END at', endX, endY);

  if (endFound) {
    cropWidth = endX + MARKER_START.length * scale - cropX;
    cropHeight = Math.min(cropHeight, MARKER_START.length * scale + scale);
  }

  const logicalWidth = Math.floor(cropWidth / scale);
  const logicalHeight = Math.floor(cropHeight / scale);

  const uniqueRows = [];
  let prevRow = null;

  for (let ly = 0; ly < logicalHeight; ly++) {
    const py = cropY + ly * scale + Math.floor(scale / 2);
    if (py >= currentHeight) break;

    const currentRow = [];
    for (let lx = 0; lx < logicalWidth; lx++) {
      const px = cropX + lx * scale + Math.floor(scale / 2);
      if (px >= currentWidth) break;
      const idx = (py * currentWidth + px) * channels;
      currentRow.push({
        r: currentData[idx],
        g: currentData[idx + 1],
        b: currentData[idx + 2],
      });
    }

    if (currentRow.length === 0) break;

    const isSame =
      prevRow &&
      prevRow.length === currentRow.length &&
      prevRow.every(
        (p, i) =>
          p.r === currentRow[i].r &&
          p.g === currentRow[i].g &&
          p.b === currentRow[i].b,
      );
    if (!isSame) {
      if (prevRow) uniqueRows.push(prevRow);
      prevRow = currentRow;
    }
  }
  if (prevRow) uniqueRows.push(prevRow);

  const finalGrid = uniqueRows.flat();

  while (
    finalGrid.length > 0 &&
    finalGrid[finalGrid.length - 1].r === 0 &&
    finalGrid[finalGrid.length - 1].g === 0 &&
    finalGrid[finalGrid.length - 1].b === 0
  )
    finalGrid.pop();

  console.log('finalGrid length', finalGrid.length);

  const extracted = Buffer.alloc(finalGrid.length * 3);
  for (let i = 0; i < finalGrid.length; i++) {
    extracted[i * 3] = finalGrid[i].r;
    extracted[i * 3 + 1] = finalGrid[i].g;
    extracted[i * 3 + 2] = finalGrid[i].b;
  }

  console.log('extracted head:', extracted.slice(0, 64).toString('hex'));
}

run().catch(console.error);

