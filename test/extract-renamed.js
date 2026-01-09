import fs from 'fs';
import { decodePngToBinary } from '../dist/index.js';

async function extractRenamed() {
  const path = 'renammed.txt';
  if (!fs.existsSync(path)) {
    console.error('File not found:', path);
    process.exit(1);
  }

  const buf = fs.readFileSync(path);

  try {
    const res = await decodePngToBinary(buf);
    const name = res.meta?.name || 'extracted.bin';
    fs.writeFileSync(name, res.buf);
    console.log('Extracted to', name);
    console.log('Size:', res.buf.length, 'bytes');
  } catch (e) {
    console.error('Failed to extract:', e.message || String(e));
    process.exit(1);
  }
}

extractRenamed().catch((err) => {
  console.error(err);
  process.exit(1);
});

