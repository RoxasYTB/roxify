import fs from 'fs';
import sharp from 'sharp';

const file = process.argv[2] || '../roxify-test/test.png';
const buf = fs.readFileSync(file);

async function run() {
  const { data, info } = await sharp(buf)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 3;
  const currentWidth = info.width;
  const currentHeight = info.height;
  const currentData = data;

  const MARKER_START = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
  ];

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

  console.log(
    'Dimensions:',
    currentWidth,
    'x',
    currentHeight,
    'found start:',
    markerStartPos,
    'scale',
    scale,
  );

  const cropX = markerStartPos.x;
  const cropY = markerStartPos.y;
  let cropWidth = currentWidth - cropX;
  let cropHeight = currentHeight - cropY;

  const MARKER_END = [...MARKER_START].reverse();
  let endX = -1;
  let endY = -1;
  for (let y0 = cropY; y0 < currentHeight; y0++) {
    for (let x0 = cropX; x0 + MARKER_END.length * scale <= currentWidth; x0++) {
      let ok = true;
      for (let mi = 0; mi < MARKER_END.length && ok; mi++) {
        for (let sy = 0; sy < scale && ok; sy++) {
          for (let sx = 0; sx < scale && ok; sx++) {
            const px = x0 + mi * scale + sx;
            const py = y0 + sy;
            const idx = (py * currentWidth + px) * channels;
            if (
              currentData[idx] !== MARKER_END[mi].r ||
              currentData[idx + 1] !== MARKER_END[mi].g ||
              currentData[idx + 2] !== MARKER_END[mi].b
            ) {
              ok = false;
            }
          }
        }
      }
      if (ok) {
        endX = x0;
        endY = y0;
      }
    }
  }

  console.log('found end at', endX, endY);
  if (endX !== -1) {
    cropWidth = endX + MARKER_END.length * scale - cropX;
    cropHeight = Math.min(cropHeight, MARKER_END.length * scale + scale);
  }

  const logicalWidth = Math.floor(cropWidth / scale);
  const logicalHeight = Math.floor(cropHeight / scale);

  const logicalGrid = [];
  for (let ly = 0; ly < logicalHeight; ly++) {
    const py = cropY + ly * scale + Math.floor(scale / 2);
    if (py >= currentHeight) break;
    for (let lx = 0; lx < logicalWidth; lx++) {
      const px = cropX + lx * scale + Math.floor(scale / 2);
      if (px >= currentWidth) break;
      const idx = (py * currentWidth + px) * channels;
      logicalGrid.push({
        r: currentData[idx],
        g: currentData[idx + 1],
        b: currentData[idx + 2],
      });
    }
  }

  const uniqueRows = [];
  let prevRow = null;
  for (let ly = 0; ly < logicalHeight; ly++) {
    const row = logicalGrid.slice(ly * logicalWidth, (ly + 1) * logicalWidth);
    if (row.length === 0) break;
    const isSame =
      prevRow &&
      prevRow.length === row.length &&
      prevRow.every(
        (p, i) => p.r === row[i].r && p.g === row[i].g && p.b === row[i].b,
      );
    if (!isSame) {
      if (prevRow) uniqueRows.push(prevRow);
      prevRow = row;
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

  console.log(
    'logicalWidth x logicalHeight',
    logicalWidth,
    'x',
    logicalHeight,
    'uniqueRows',
    uniqueRows.length,
    'finalGrid',
    finalGrid.length,
  );

  console.log('\nUnique rows (hex heads):');
  uniqueRows.forEach((row, i) => {
    const head = row
      .slice(0, Math.min(8, row.length))
      .map(
        (p) =>
          `${p.r.toString(16).padStart(2, '0')}${p.g
            .toString(16)
            .padStart(2, '0')}${p.b.toString(16).padStart(2, '0')}`,
      )
      .join(' ');
    console.log(`${i}: len=${row.length} head=[${head}]`);
  });

  const extracted = Buffer.alloc(finalGrid.length * 3);
  for (let i = 0; i < finalGrid.length; i++) {
    extracted[i * 3] = finalGrid[i].r;
    extracted[i * 3 + 1] = finalGrid[i].g;
    extracted[i * 3 + 2] = finalGrid[i].b;
  }

  console.log('extracted head:', extracted.slice(0, 128).toString('hex'));
  const PIXEL_MAGIC = Buffer.from('PXL1');
  console.log('PIXEL_MAGIC index:', extracted.indexOf(PIXEL_MAGIC));
}

run().catch(console.error);

