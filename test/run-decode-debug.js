import fs from 'fs';
import { decodePngToBinary } from '../dist/index.js';

process.env.ROX_DEBUG = '1';

async function run() {
  const buf = fs.readFileSync('../roxify-test/test.png');
  try {
    const res = await decodePngToBinary(buf);
    console.log('Decoded OK, size', res.buf.length);
  } catch (e) {
    console.error('Error:', e);
  }
}

run();

