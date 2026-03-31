const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const files = process.argv.slice(2);
if (files.length === 0) {
      console.log('Usage: node check_marker.cjs <png_file> [png_file2] ...');
      process.exit(1);
}

const MARKER_END = [
      { r: 0, g: 0, b: 255 },
      { r: 0, g: 255, b: 0 },
      { r: 255, g: 0, b: 0 },
];

const MARKER_START = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
      { r: 0, g: 0, b: 255 },
];

for (const file of files) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`File: ${file}`);
      const buf = fs.readFileSync(file);
      const img = PNG.sync.read(buf);
      const w = img.width;
      const h = img.height;
      const totalPixels = w * h;
      const rgba = img.data;

      console.log(`Size: ${w}x${h} = ${totalPixels} pixels`);

      const getPixel = (i) => ({
            r: rgba[i * 4],
            g: rgba[i * 4 + 1],
            b: rgba[i * 4 + 2],
      });

      const first3 = [getPixel(0), getPixel(1), getPixel(2)];
      const last3 = [getPixel(totalPixels - 3), getPixel(totalPixels - 2), getPixel(totalPixels - 1)];

      const startOk = MARKER_START.every((m, i) => m.r === first3[i].r && m.g === first3[i].g && m.b === first3[i].b);
      const endOk = MARKER_END.every((m, i) => m.r === last3[i].r && m.g === last3[i].g && m.b === last3[i].b);

      console.log(`First 3 pixels: ${JSON.stringify(first3)}`);
      console.log(`MARKER_START: ${startOk ? 'OK' : 'MISSING'}`);
      console.log(`Last 3 pixels: ${JSON.stringify(last3)}`);
      console.log(`MARKER_END: ${endOk ? 'OK' : 'MISSING'}`);

      if (!endOk) {
            let found = false;
            for (let p = 0; p < totalPixels - 2; p++) {
                  const px = [getPixel(p), getPixel(p + 1), getPixel(p + 2)];
                  if (MARKER_END.every((m, i) => m.r === px[i].r && m.g === px[i].g && m.b === px[i].b)) {
                        console.log(`  Found MARKER_END at pixel ${p} (${totalPixels - p - 3} pixels from end)`);
                        found = true;
                  }
            }
            if (!found) {
                  console.log('  MARKER_END NOT FOUND ANYWHERE in the image!');
            }

            console.log(`\n  ALL ${totalPixels} pixels:`);
            for (let i = 0; i < totalPixels; i++) {
                  const px = getPixel(i);
                  console.log(`    Pixel ${i}: [${px.r}, ${px.g}, ${px.b}]`);
            }
      }
}
