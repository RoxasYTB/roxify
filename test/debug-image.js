import fs from 'fs';
import sharp from 'sharp';

async function debugImage() {
  const pngBuffer = fs.readFileSync('test-with-markers.png');

  const { data, info } = await sharp(pngBuffer).raw().toBuffer({
    resolveWithObject: true,
  });

  console.log('Image dimensions:', info.width, 'x', info.height);
  console.log('Channels:', info.channels);
  console.log('Total pixels:', data.length / 3);

  console.log('\nGrille 2D (premières lignes):');
  for (let y = 0; y < Math.min(4, info.height); y++) {
    let line = `Ligne ${y}: `;
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 3;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      line += `(${r},${g},${b}) `;
    }
    console.log(line);
  }

  console.log('\nGrille 2D (dernières lignes):');
  for (let y = Math.max(0, info.height - 4); y < info.height; y++) {
    let line = `Ligne ${y}: `;
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * 3;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      line += `(${r},${g},${b}) `;
    }
    console.log(line);
  }

  console.log('\nMarqueurs attendus:');
  console.log(
    'START: RGB(255,0,0), RGB(0,255,0), RGB(0,0,255), RGB(255,255,0), RGB(255,0,255), RGB(0,255,255), RGB(128,128,128)',
  );
  console.log(
    'END (inversé): RGB(128,128,128), RGB(0,255,255), RGB(255,0,255), RGB(255,255,0), RGB(0,0,255), RGB(0,255,0), RGB(255,0,0)',
  );
}

debugImage().catch(console.error);

