import fs from 'fs';
import sharp from 'sharp';

async function createSimplePng() {
  const raw = Buffer.alloc(3);
  raw[0] = 255;
  raw[1] = 0;
  raw[2] = 0;

  const png = await sharp(raw, {
    raw: { width: 1, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();

  fs.writeFileSync('test-old-format.png', png);
  console.log('Created test-old-format.png');
  console.log('Size:', png.length, 'bytes');
  console.log('Hex:', png.toString('hex'));
}

createSimplePng().catch(console.error);

