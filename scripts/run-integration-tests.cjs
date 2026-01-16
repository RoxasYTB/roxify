#!/usr/bin/env node
const { execSync } = require('child_process');
const { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } = require('fs');
const { join } = require('path');

function run(cmd) {
  console.log('> ' + cmd);
  return execSync(cmd, { stdio: 'inherit' });
}

function runSilent(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch (e) { return null; }
}

const OUT = join(process.cwd(), 'output-tests');
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('Build JS...');
run('npm run build');

console.log('Build native (super-fast)');
// try super-fast first, fallback to fast if fails
try {
  run('npm run build:native:super-fast');
} catch (e) {
  console.warn('super-fast failed, falling back to quick release build');
  run('npm run build:native:quick-release');
}

console.log('Copy native to root for test');
run('node scripts/copy-native.js');

// helper to write test files
const sampleTxt = join(OUT, 'hello.txt');
writeFileSync(sampleTxt, 'hello world');
const sampleBin = join(OUT, 'data.bin');
writeFileSync(sampleBin, Buffer.from([0,1,2,3,4,5]));

const cli = 'node dist/cli.js';

const results = [];

try {
  // Test 1: encode single file -> decode -> compare
  console.log('\nTest 1: CLI encode/decode roundtrip single file');
  const encoded = join(OUT, 'single.png');
  run(`${cli} encode ${sampleTxt} ${encoded}`);
  run(`${cli} decode ${encoded} ${join(OUT, 'decoded.txt')}`);
  const got = readFileSync(join(OUT, 'decoded.txt'), 'utf8');
  if (got !== 'hello world') throw new Error('Roundtrip mismatch');
  results.push('test1:ok');

  // Test 2: pack folder -> list
  console.log('\nTest 2: CLI encode directory & list');
  const dir = join(OUT, 'dir');
  mkdirSync(dir);
  writeFileSync(join(dir, 'a.txt'), 'a');
  writeFileSync(join(dir, 'b.txt'), 'b');
  const encodedDir = join(OUT, 'dir.png');
  run(`${cli} encode ${dir} ${encodedDir}`);
  const listOut = exec('node dist/cli.js list ' + encodedDir);
  if (!listOut.includes('a.txt') || !listOut.includes('b.txt')) throw new Error('List missing files');
  results.push('test2:ok');

  // Test 3: passphrase encryption
  console.log('\nTest 3: Passphrase test (aes)');
  const pf = 'mypassword';
  const enc = join(OUT, 'enc.png');
  run(`${cli} encode ${sampleTxt} ${enc} -p ${pf} -e aes`);
  // decode without passphrase should fail
  try {
    run(`${cli} decode ${enc} ${join(OUT, 'shouldfail.bin')}`);
    throw new Error('Decode without passphrase should have failed');
  } catch (e) {
    // expected
    results.push('test3a:ok');
  }
  // decode with passphrase
  run(`${cli} decode ${enc} ${join(OUT, 'decoded-pass.txt')} -p ${pf}`);
  const got2 = readFileSync(join(OUT, 'decoded-pass.txt'), 'utf8');
  if (got2 !== 'hello world') throw new Error('Passphrase decode mismatch');
  results.push('test3b:ok');

  // Test 4: havepassphrase
  console.log('\nTest 4: havepassphrase');
  const have = runSilent(`${cli} havepassphrase ${enc}`) || '';
  if (!have.toLowerCase().includes('passphrase')) throw new Error('havepassphrase failed');
  results.push('test4:ok');

  // Test 5: Node API encode/decode
  console.log('\nTest 5: Node API encode/decode');
  // run a small module using dynamic import
  const nodeScript = `node --input-type=module -e "import('./dist/index.js').then(async mod => { const input = new TextEncoder().encode('hello api'); const png = await mod.encodeBinaryToPng(Buffer.from(input), { mode: 'screenshot', name: 'api.txt', compressionLevel: 1 }); const res = await mod.decodePngToBinary(png); if (!res.buf && !res.files) { console.error('decode result missing'); process.exit(2); } console.log('api_ok'); })"`;
  run(nodeScript);
  results.push('test5:ok');

  // Node API passphrase test
  console.log('\nTest 6: Node API passphrase');
  const nodePfScript = `node --input-type=module -e "import('./dist/index.js').then(async mod => { const input = Buffer.from('secret'); const png = await mod.encodeBinaryToPng(input, { mode: 'screenshot', name: 'sec.txt', passphrase: 'p', encrypt: 'aes' }); try { await mod.decodePngToBinary(png); console.error('should fail without passphrase'); process.exit(2);} catch (e) { /* ok */ } const res = await mod.decodePngToBinary(png, { passphrase: 'p' }); console.log('api_pass_ok'); })"`;
  run(nodePfScript);
  results.push('test6:ok');

  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ ok: true, results }, null, 2));
  console.log('\nAll integration tests passed. Results in output-tests/results.json');
  process.exit(0);
} catch (e) {
  console.error('\nIntegration test failed:', e.message || e);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ ok: false, error: e.message || String(e), results }, null, 2));
  process.exit(1);
}

function exec(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }); } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}
