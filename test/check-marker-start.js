import sharp from 'sharp';
import { encodeBinaryToPng } from '../dist/index.js';

async function run() {
  const input = Buffer.from('Test message', 'utf8');
  const png = await encodeBinaryToPng(input, {
    mode: 'screenshot',
    name: 'test.txt',
  });

  const { data, info } = await sharp(png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  console.log(
    'Dimensions',
    info.width,
    'x',
    info.height,
    'channels',
    info.channels,
  );

  const MARKER_START = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
  ];

  const currentWidth = info.width;
  const currentHeight = info.height;
  const channels = info.channels || 3;
  const currentData = data;

  let found = false;
  for (let y = 0; y < currentHeight && !found; y++) {
    for (let x = 0; x < currentWidth && !found; x++) {
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
          console.log('Found markerStart at', x, y, 'scale', testScale);
          found = true;
          break;
        }
      }
    }
  }

  if (!found) {
    console.log('Direct test for x=0,y=0,scale=1:');
    {
      const x = 0,
        y = 0,
        testScale = 1;
      let ok = true;
      for (let mi = 0; mi < MARKER_START.length; mi++) {
        for (let sy = 0; sy < testScale; sy++) {
          for (let sx = 0; sx < testScale; sx++) {
            const checkX = x + mi * testScale + sx;
            const checkY = y + sy;
            const idx = (checkY * currentWidth + checkX) * channels;
            if (
              currentData[idx] !== MARKER_START[mi].r ||
              currentData[idx + 1] !== MARKER_START[mi].g ||
              currentData[idx + 2] !== MARKER_START[mi].b
            ) {
              ok = false;
              break;
            }
          }
        }
      }
      console.log('match at 0,0,1 =>', ok);
    }

    console.log('First pixels:');
    for (let y = 0; y < Math.min(currentHeight, 6); y++) {
      let line = '';
      for (let x = 0; x < Math.min(currentWidth, 40); x++) {
        const idx = (y * currentWidth + x) * channels;
        line += `(${currentData[idx]},${currentData[idx + 1]},${
          currentData[idx + 2]
        }) `;
      }
      console.log(line);
    }
  }
}

run().catch(console.error);

