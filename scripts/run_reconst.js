import fs from 'fs';
import { cropAndReconstitute } from '../dist/utils/reconstitution.js';

const input = fs.readFileSync('test.png');
(async () => {
  const out = await cropAndReconstitute(input, process.cwd());
  console.log('cropAndReconstitute returned len', out.length);
  const raw = (await import('../dist/utils/native.js')).native.sharpToRaw(out);
  console.log(
    'raw dims:',
    raw.width,
    raw.height,
    'pixels=',
    Math.floor(raw.pixels.length / 3),
  );
})();
