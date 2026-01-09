import fs from 'fs';
import sharp from 'sharp';
import { encodeBinaryToPng } from '../dist/index.js';

async function testDebug() {
  const testText = 'Hello!';
  const inputBuffer = Buffer.from(testText, 'utf8');

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  fs.writeFileSync('test-simple.png', pngBuffer);

  const { data, info } = await sharp(pngBuffer).raw().toBuffer({
    resolveWithObject: true,
  });

  const scale = 2;
  const logicalWidth = Math.floor(info.width / scale);
  const logicalHeight = Math.floor(info.height / scale);

  console.log(
    `Dimensions: ${info.width}x${info.height}, Logical: ${logicalWidth}x${logicalHeight}`,
  );

  const logicalGrid = [];
  for (let ly = 0; ly < logicalHeight; ly++) {
    for (let lx = 0; lx < logicalWidth; lx++) {
      const px = lx * scale;
      const py = ly * scale;
      const idx = (py * info.width + px) * 3;
      logicalGrid.push({
        r: data[idx],
        g: data[idx + 1],
        b: data[idx + 2],
      });
    }
  }

  console.log('\nGrille logique:');
  for (let ly = 0; ly < logicalHeight; ly++) {
    let line = `Ligne ${ly}: `;
    for (let lx = 0; lx < logicalWidth; lx++) {
      const pixel = logicalGrid[ly * logicalWidth + lx];
      line += `(${pixel.r},${pixel.g},${pixel.b}) `;
    }
    console.log(line);
  }

  const uniqueRows = [];
  let prevRow = null;

  for (let ly = 0; ly < logicalHeight; ly++) {
    const currentRow = logicalGrid.slice(
      ly * logicalWidth,
      (ly + 1) * logicalWidth,
    );
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
      if (prevRow) {
        uniqueRows.push(prevRow);
      }
      prevRow = currentRow;
    }
  }

  if (prevRow) {
    uniqueRows.push(prevRow);
  }

  console.log(`\nLignes uniques: ${uniqueRows.length}`);
  const finalGrid = uniqueRows.flat();
  console.log(`Grille finale: ${finalGrid.length} pixels`);

  console.log('\nPremiers 20 pixels de la grille finale:');
  for (let i = 0; i < Math.min(20, finalGrid.length); i++) {
    const p = finalGrid[i];
    console.log(`${i}: (${p.r},${p.g},${p.b})`);
  }

  console.log('\nDerniers 20 pixels de la grille finale:');
  for (let i = Math.max(0, finalGrid.length - 20); i < finalGrid.length; i++) {
    const p = finalGrid[i];
    console.log(`${i}: (${p.r},${p.g},${p.b})`);
  }
}

testDebug().catch(console.error);

