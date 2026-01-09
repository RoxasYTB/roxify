import fs from 'fs';
import sharp from 'sharp';

async function debugEncoded() {
  const pngBuffer = fs.readFileSync('test-final-with-gradient.png');

  const { data, info } = await sharp(pngBuffer).raw().toBuffer({
    resolveWithObject: true,
  });

  console.log('Image dimensions:', info.width, 'x', info.height);

  const MARKER_START = [
    { r: 255, g: 0, b: 0 },
    { r: 0, g: 255, b: 0 },
    { r: 0, g: 0, b: 255 },
    { r: 255, g: 255, b: 0 },
    { r: 255, g: 0, b: 255 },
    { r: 0, g: 255, b: 255 },
    { r: 128, g: 128, b: 128 },
  ];

  console.log('\nRecherche du marqueur START...');

  for (let y = 0; y < Math.min(20, info.height); y++) {
    for (let x = 0; x < Math.min(60, info.width); x++) {
      for (let testScale = 1; testScale <= 10; testScale++) {
        if (
          x + MARKER_START.length * testScale > info.width ||
          y + testScale > info.height
        ) {
          break;
        }

        let allMatch = true;

        for (let mi = 0; mi < MARKER_START.length && allMatch; mi++) {
          for (let sy = 0; sy < testScale && allMatch; sy++) {
            for (let sx = 0; sx < testScale && allMatch; sx++) {
              const checkX = x + mi * testScale + sx;
              const checkY = y + sy;
              const idx = (checkY * info.width + checkX) * 3;

              if (
                data[idx] !== MARKER_START[mi].r ||
                data[idx + 1] !== MARKER_START[mi].g ||
                data[idx + 2] !== MARKER_START[mi].b
              ) {
                allMatch = false;
              }
            }
          }
        }

        if (allMatch) {
          console.log(`Trouvé à (${x}, ${y}) avec scale ${testScale}`);
        }
      }
    }
  }
}

debugEncoded().catch(console.error);

