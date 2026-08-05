#!/usr/bin/env node
const { execSync } = require('child_process');
const {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} = require('fs');
const { join } = require('path');

function run(cmd, opts = {}) {
  console.log('> ' + cmd);
  const options = Object.assign({ stdio: 'inherit', timeout: 600000 }, opts);
  return execSync(cmd, options);
}

function runSilent(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 30000 }).trim();
  } catch (e) {
    return null;
  }
}

const OUT = join(process.cwd(), 'output-tests');
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sampleTxt = join(OUT, 'hello.txt');
writeFileSync(sampleTxt, 'hello world');
const sampleBin = join(OUT, 'data.bin');
writeFileSync(sampleBin, Buffer.from([0, 1, 2, 3, 4, 5]));

if (process.env.SKIP_JS_BUILD === '1') {
  console.log('Skipping JS build (SKIP_JS_BUILD=1)');
} else {
  console.log('Build JS...');
  run('npm run build');
}

if (process.env.SKIP_NATIVE_BUILD === '1') {
  console.log('Skipping native build (SKIP_NATIVE_BUILD=1)');
} else {
  console.log('Build native (super-fast)');
  try {
    run('npm run build:native:super-fast');
  } catch (e) {
    console.warn('super-fast failed, falling back to quick release build');
    run('npm run build:native:quick-release');
  }

  console.log('Build CLI binary (roxify_native)');
  try {
    if (process.env.FAST_RELEASE === '1')
      run('cargo build --profile fastdev --bin roxify_native');
    else run('cargo build --release --bin roxify_native');
  } catch (e) {
    console.warn('Building CLI binary failed:', e.message || e);
  }
}

console.log('Copy native to root for test');
run('node scripts/copy-native.js');

try {
  const binPath = 'target/release/roxify_native';
  if (process.platform === 'win32') {
  }
  if (require('fs').existsSync(binPath)) {
    console.log('Sanity check: running native CLI directly');
    const input = sampleTxt;
    const out = join(OUT, 'native-cli-check.png');
    run(`target/release/roxify_native encode --level 3 ${input} ${out}`);
  }
} catch (e) {
  console.warn('Native CLI sanity check failed:', e.message || e);
}

const cli = 'node dist/cli.js';

const results = [];

try {
  console.log('\nTest 1: CLI encode/decode roundtrip single file');
  const encoded = join(OUT, 'single.png');
  run(`${cli} encode ${sampleTxt} ${encoded}`);
  run(`${cli} decode ${encoded} ${join(OUT, 'decoded.txt')}`);
  const got = readFileSync(join(OUT, 'decoded.txt'), 'utf8');
  if (got !== 'hello world') throw new Error('Roundtrip mismatch');
  results.push('test1:ok');

  console.log('\nTest 2: CLI encode directory & list');
  const dir = join(OUT, 'dir');
  mkdirSync(dir);
  writeFileSync(join(dir, 'a.txt'), 'a');
  writeFileSync(join(dir, 'b.txt'), 'b');
  const encodedDir = join(OUT, 'dir.png');
  run(`${cli} encode ${dir} ${encodedDir}`);
  const listOut = exec('node dist/cli.js list ' + encodedDir);
  if (!listOut.includes('a.txt') || !listOut.includes('b.txt'))
    throw new Error('List missing files');
  results.push('test2:ok');

  console.log('\nTest 3: Passphrase test (aes)');
  const pf = 'mypassword';
  const enc = join(OUT, 'enc.png');
  run(`${cli} encode ${sampleTxt} ${enc} -p ${pf} -e aes`);
  try {
    run(`${cli} decode ${enc} ${join(OUT, 'shouldfail.bin')}`);
    throw new Error('Decode without passphrase should have failed');
  } catch (e) {
    results.push('test3a:ok');
  }
  run(`${cli} decode ${enc} ${join(OUT, 'decoded-pass.txt')} -p ${pf}`);
  const got2 = readFileSync(join(OUT, 'decoded-pass.txt'), 'utf8');
  if (got2 !== 'hello world') throw new Error('Passphrase decode mismatch');
  results.push('test3b:ok');

  console.log('\nTest 4: havepassphrase');
  const have = runSilent(`${cli} havepassphrase ${enc}`) || '';
  if (!have.toLowerCase().includes('passphrase'))
    throw new Error('havepassphrase failed');
  results.push('test4:ok');

  console.log('\nTest 5: Node API encode/decode');
  const nodeScript = `node --input-type=module -e "import('./dist/index.js').then(async mod => { const input = new TextEncoder().encode('hello api'); const png = await mod.encodeBinaryToPng(Buffer.from(input), { mode: 'screenshot', name: 'api.txt', compressionLevel: 1 }); const res = await mod.decodePngToBinary(png); if (!res.buf && !res.files) { console.error('decode result missing'); process.exit(2); } console.log('api_ok'); })"`;
  run(nodeScript);
  results.push('test5:ok');

  console.log('\nTest 6: Node API passphrase');
  const nodePfScript = `node --input-type=module -e "import('./dist/index.js').then(async mod => { const input = Buffer.from('secret'); const png = await mod.encodeBinaryToPng(input, { mode: 'screenshot', name: 'sec.txt', passphrase: 'p', encrypt: 'aes' }); try { await mod.decodePngToBinary(png); console.error('should fail without passphrase'); process.exit(2);} catch (e) { /* ok */ } const res = await mod.decodePngToBinary(png, { passphrase: 'p' }); console.log('api_pass_ok'); })"`;
  run(nodePfScript);
  results.push('test6:ok');

  writeFileSync(
    join(OUT, 'results.json'),
    JSON.stringify({ ok: true, results }, null, 2),
  );
  console.log(
    '\nAll integration tests passed. Results in output-tests/results.json',
  );
  process.exit(0);
} catch (e) {
  console.error('\nIntegration test failed:', e.message || e);
  writeFileSync(
    join(OUT, 'results.json'),
    JSON.stringify(
      { ok: false, error: e.message || String(e), results },
      null,
      2,
    ),
  );
  process.exit(1);
}

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '');
  }
}
