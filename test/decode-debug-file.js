import fs from 'fs';
import { decodePngToBinary } from '../dist/index.js';

const path =
  process.argv[2] ||
  'D:\\Users\\yohan\\Bureau\\RoxCompressor\\roxify-test\\test.png';
process.env.ROX_DEBUG = '1';

async function run() {
  const buf = fs.readFileSync(path);
  try {
    const res = await decodePngToBinary(buf);
    console.log('Decoded OK, size', res.buf.length);
  } catch (e) {
    console.error('Error:', e);
  }
}

run();

