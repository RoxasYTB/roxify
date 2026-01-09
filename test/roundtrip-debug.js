import { decodePngToBinary, encodeBinaryToPng } from '../dist/index.js';

process.env.ROX_DEBUG = '1';

async function run() {
  const input = Buffer.from('Test message', 'utf8');
  const png = await encodeBinaryToPng(input, {
    mode: 'screenshot',
    name: 'test.txt',
  });
  try {
    const res = await decodePngToBinary(png);
    console.log('Decoded OK, len', res.buf.length, res.meta);
  } catch (e) {
    console.error('Decode failed:', e);
  }
}

run();

