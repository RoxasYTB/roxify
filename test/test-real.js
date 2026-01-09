import sharp from 'sharp';
import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

async function testRealCase() {
  const testText = 'Hello, this is a test message with markers!';
  const inputBuffer = Buffer.from(testText, 'utf8');

  console.log('Testing with text:', testText);
  console.log('Input length:', inputBuffer.length);

  const pngBuffer = await encodeBinaryToPng(inputBuffer, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  console.log('PNG size:', pngBuffer.length);

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

  console.log(`Unique rows: ${uniqueRows.length}`);
  const finalGrid = uniqueRows.flat();
  console.log(`Final grid: ${finalGrid.length} pixels`);

  console.log('\nLast 20 pixels:');
  for (let i = Math.max(0, finalGrid.length - 20); i < finalGrid.length; i++) {
    const p = finalGrid[i];
    console.log(`${i}: (${p.r},${p.g},${p.b})`);
  }

  try {
    const result = await decodePngToBinary(pngBuffer);
    const decodedText = result.buf.toString('utf8');

    console.log('\nSUCCESS!');
    console.log('Decoded:', decodedText);
    console.log('Match:', decodedText === testText);
  } catch (err) {
    console.log('\nFAILED:', err.message);
  }
}

testRealCase().catch(console.error);

