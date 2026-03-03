#!/usr/bin/env node
'use strict';

/**
 * Roxify test suite – runs both TypeScript (compiled JS) and Rust tests.
 * Executed via `npm test`.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`    ${e.message}`);
  }
}

// =============================================================================
// 1. Rust unit tests
// =============================================================================
console.log('\n\x1b[1m━━━ Rust unit tests ━━━\x1b[0m');
test('cargo test passes', () => {
  execSync('cargo test 2>&1', { cwd: root, timeout: 300_000, encoding: 'utf8' });
});

// =============================================================================
// 2. TypeScript compilation check
// =============================================================================
console.log('\n\x1b[1m━━━ TypeScript build ━━━\x1b[0m');
test('dist/ exists with compiled JS', () => {
  assert.ok(fs.existsSync(path.join(distDir, 'index.js')), 'dist/index.js missing');
  assert.ok(fs.existsSync(path.join(distDir, 'index.d.ts')), 'dist/index.d.ts missing');
  assert.ok(fs.existsSync(path.join(distDir, 'cli.js')), 'dist/cli.js missing');
});

// =============================================================================
// 3. JS unit tests – helpers (pure functions, no native dependency)
// =============================================================================
console.log('\n\x1b[1m━━━ JS unit tests ━━━\x1b[0m');

async function runJsTests() {
  // Dynamic import the ESM module
  const helpers = await import(path.join(distDir, 'utils', 'helpers.js'));
  const crc = await import(path.join(distDir, 'utils', 'crc.js'));

  test('deltaEncode + deltaDecode roundtrip', () => {
    const data = Buffer.from([10, 20, 30, 40, 250]);
    const enc = helpers.deltaEncode(data);
    const dec = helpers.deltaDecode(enc);
    assert.deepStrictEqual(dec, data);
  });

  test('deltaEncode empty buffer', () => {
    const data = Buffer.alloc(0);
    const enc = helpers.deltaEncode(data);
    assert.strictEqual(enc.length, 0);
  });

  test('crc32 basic', () => {
    const buf = Buffer.from('hello');
    const c = crc.crc32(buf);
    assert.strictEqual(typeof c, 'number');
    assert.ok(c !== 0, 'crc32 should not be zero for non-empty input');
    // Verify deterministic
    assert.strictEqual(crc.crc32(buf), c);
  });

  test('adler32 basic', () => {
    const buf = Buffer.from('hello');
    const a = crc.adler32(buf);
    assert.strictEqual(typeof a, 'number');
    assert.ok(a !== 0);
  });

  test('colorsToBytes converts RGB array to buffer', () => {
    const colors = [
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 255, b: 0 },
    ];
    const result = helpers.colorsToBytes(colors);
    assert.strictEqual(result.length, 6);
    assert.strictEqual(result[0], 255);
    assert.strictEqual(result[1], 0);
    assert.strictEqual(result[3], 0);
    assert.strictEqual(result[4], 255);
  });

  test('applyXor roundtrip', () => {
    const data = Buffer.from('secret data');
    const key = 'mypassword';
    const encrypted = helpers.applyXor(data, key);
    const decrypted = helpers.applyXor(encrypted, key);
    assert.deepStrictEqual(decrypted, data);
  });

  test('generatePalette256 returns 768 bytes', () => {
    const palette = helpers.generatePalette256();
    assert.strictEqual(palette.length, 768);
  });

  // Encode/decode via JS-only path (no native module needed)
  try {
    const encoder = await import(path.join(distDir, 'utils', 'encoder.js'));
    const decoder = await import(path.join(distDir, 'utils', 'decoder.js'));

    await testAsync('encode then decode roundtrip (small payload)', async () => {
      const payload = Buffer.from('Hello roxify! This is a steganography test.');
      const png = await encoder.encodeBinaryToPng(payload, {
        compressionLevel: 3,
        forceJs: true,
      });
      assert.ok(Buffer.isBuffer(png), 'result should be a buffer');
      assert.ok(png.length > 8, 'PNG should have content');
      // Check PNG magic
      assert.strictEqual(png[0], 137);
      assert.strictEqual(png[1], 80); // P
      assert.strictEqual(png[2], 78); // N
      assert.strictEqual(png[3], 71); // G

      const decoded = await decoder.decodePngToBinary(png);
      assert.ok(decoded, 'decode should return a result');
      assert.deepStrictEqual(decoded.buf, payload);
    });
  } catch (e) {
    console.log(`  \x1b[33m⚠\x1b[0m encode/decode roundtrip skipped: ${e.message}`);
  }

  // Pack/unpack test
  try {
    const pack = await import(path.join(distDir, 'pack.js'));

    test('packPaths + unpackBuffer roundtrip', () => {
      const tmpDir = path.join(root, 'test', '.tmp-pack-test');
      const tmpFile = path.join(tmpDir, 'test.txt');
      fs.mkdirSync(tmpDir, { recursive: true });
      fs.writeFileSync(tmpFile, 'pack test content');
      try {
        const { buf, list } = pack.packPaths([tmpFile], tmpDir);
        assert.ok(Buffer.isBuffer(buf));
        assert.ok(buf.length > 0);
        assert.ok(Array.isArray(list));

        const result = pack.unpackBuffer(buf);
        assert.ok(result, 'unpack should return a result');
        assert.ok(result.files.length > 0, 'should have at least one file');
        assert.strictEqual(
          result.files[0].buf.toString(),
          'pack test content',
        );
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  } catch (e) {
    console.log(`  \x1b[33m⚠\x1b[0m pack/unpack test skipped: ${e.message}`);
  }
}

// =============================================================================
// Run all tests
// =============================================================================
(async () => {
  await runJsTests();

  console.log(
    `\n\x1b[1m━━━ Results: ${passed} passed, ${failed} failed ━━━\x1b[0m\n`,
  );

  if (failed > 0) {
    process.exit(1);
  }
})();
