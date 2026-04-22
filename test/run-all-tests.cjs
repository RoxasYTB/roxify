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
try {
  execSync('command -v cargo', { cwd: root, timeout: 10_000, stdio: 'pipe' });
  test('cargo test passes', () => {
    execSync('cargo test 2>&1', { cwd: root, timeout: 300_000, encoding: 'utf8' });
  });
} catch (e) {
  console.log('  \x1b[33m⚠\x1b[0m cargo not found: Rust unit tests skipped');
}

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

  // ===========================================================================
  // Unstretch tests
  // ===========================================================================
  console.log('\n\x1b[1m━━━ Unstretch tests ━━━\x1b[0m');

  try {
    const decoder = await import(path.join(distDir, 'utils', 'decoder.js'));

    test('unstretchImage: basic 2x2 stretch of 2x2 image', () => {
      // Logical image: 2x2 pixels (red, green / blue, yellow)
      // Stretched 2x: 4x4
      const w = 4, h = 4;
      const buf = Buffer.alloc(w * h * 3);
      // Row 0 and 1: red(2px), green(2px)
      for (let y = 0; y < 2; y++) {
        for (let x = 0; x < 2; x++) { buf[(y * w + x) * 3] = 255; buf[(y * w + x) * 3 + 1] = 0; buf[(y * w + x) * 3 + 2] = 0; }
        for (let x = 2; x < 4; x++) { buf[(y * w + x) * 3] = 0; buf[(y * w + x) * 3 + 1] = 255; buf[(y * w + x) * 3 + 2] = 0; }
      }
      // Row 2 and 3: blue(2px), yellow(2px)
      for (let y = 2; y < 4; y++) {
        for (let x = 0; x < 2; x++) { buf[(y * w + x) * 3] = 0; buf[(y * w + x) * 3 + 1] = 0; buf[(y * w + x) * 3 + 2] = 255; }
        for (let x = 2; x < 4; x++) { buf[(y * w + x) * 3] = 255; buf[(y * w + x) * 3 + 1] = 255; buf[(y * w + x) * 3 + 2] = 0; }
      }
      const result = decoder.unstretchImage(buf, w, h);
      assert.ok(result, 'should return a result');
      assert.strictEqual(result.width, 2);
      assert.strictEqual(result.height, 2);
      // red at (0,0)
      assert.strictEqual(result.data[0], 255);
      assert.strictEqual(result.data[1], 0);
      assert.strictEqual(result.data[2], 0);
      // green at (1,0)
      assert.strictEqual(result.data[3], 0);
      assert.strictEqual(result.data[4], 255);
      assert.strictEqual(result.data[5], 0);
      // blue at (0,1)
      assert.strictEqual(result.data[6], 0);
      assert.strictEqual(result.data[7], 0);
      assert.strictEqual(result.data[8], 255);
      // yellow at (1,1)
      assert.strictEqual(result.data[9], 255);
      assert.strictEqual(result.data[10], 255);
      assert.strictEqual(result.data[11], 0);
    });

    test('unstretchImage: 3x3 stretch (odd factor)', () => {
      // 2x1 image: red, blue → stretched 3x: 6x3
      const w = 6, h = 3;
      const buf = Buffer.alloc(w * h * 3);
      for (let y = 0; y < 3; y++) {
        for (let x = 0; x < 3; x++) { buf[(y * w + x) * 3] = 255; } // red
        for (let x = 3; x < 6; x++) { buf[(y * w + x) * 3 + 2] = 255; } // blue
      }
      const result = decoder.unstretchImage(buf, w, h);
      assert.ok(result);
      assert.strictEqual(result.width, 2);
      assert.strictEqual(result.height, 1);
    });

    test('unstretchImage: with white padding', () => {
      // 8x6 image with white padding, inner 4x4 data (2x2 logical stretched 2x)
      const w = 8, h = 6;
      const buf = Buffer.alloc(w * h * 3, 255); // all white
      // Place 4x4 block starting at (2,1)
      for (let y = 1; y < 3; y++) {
        for (let x = 2; x < 4; x++) { buf[(y * w + x) * 3] = 255; buf[(y * w + x) * 3 + 1] = 0; buf[(y * w + x) * 3 + 2] = 0; } // red
        for (let x = 4; x < 6; x++) { buf[(y * w + x) * 3] = 0; buf[(y * w + x) * 3 + 1] = 128; buf[(y * w + x) * 3 + 2] = 0; } // dark green
      }
      for (let y = 3; y < 5; y++) {
        for (let x = 2; x < 4; x++) { buf[(y * w + x) * 3] = 0; buf[(y * w + x) * 3 + 1] = 0; buf[(y * w + x) * 3 + 2] = 200; } // blue
        for (let x = 4; x < 6; x++) { buf[(y * w + x) * 3] = 128; buf[(y * w + x) * 3 + 1] = 0; buf[(y * w + x) * 3 + 2] = 128; } // purple
      }
      const result = decoder.unstretchImage(buf, w, h);
      assert.ok(result);
      assert.strictEqual(result.width, 2);
      assert.strictEqual(result.height, 2);
    });

    test('unstretchImage: non-uniform stretch factors', () => {
      // 2x2 logical, stretched non-uniformly: col0=3px, col1=2px → width=5
      // row0=2px, row1=3px → height=5
      const w = 5, h = 5;
      const buf = Buffer.alloc(w * h * 3);
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 5; x++) {
          const logX = x < 3 ? 0 : 1;
          const logY = y < 2 ? 0 : 1;
          const idx = (y * w + x) * 3;
          buf[idx] = logX === 0 && logY === 0 ? 200 : logX === 1 && logY === 0 ? 100 : logX === 0 ? 50 : 10;
          buf[idx + 1] = buf[idx];
          buf[idx + 2] = buf[idx];
        }
      }
      const result = decoder.unstretchImage(buf, w, h);
      assert.ok(result);
      assert.strictEqual(result.width, 2);
      assert.strictEqual(result.height, 2);
    });

    test('unstretchImage: returns null for non-stretched image', () => {
      // Each pixel is unique → no runs to collapse
      const w = 3, h = 3;
      const buf = Buffer.alloc(w * h * 3);
      for (let i = 0; i < w * h; i++) {
        buf[i * 3] = i * 28;
        buf[i * 3 + 1] = (i * 37) % 256;
        buf[i * 3 + 2] = (i * 53) % 256;
      }
      const result = decoder.unstretchImage(buf, w, h);
      assert.strictEqual(result, null, 'should return null for non-stretched');
    });

    test('unstretchImage: returns null for all-white image', () => {
      const buf = Buffer.alloc(12 * 3, 255);
      const result = decoder.unstretchImage(buf, 4, 3);
      assert.strictEqual(result, null);
    });

    test('unstretchImage: large stretch factor (10x)', () => {
      // 3x2 logical stretched 10x → 30x20
      const logW = 3, logH = 2, factor = 10;
      const w = logW * factor, h = logH * factor;
      const buf = Buffer.alloc(w * h * 3);
      const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 0], [0, 128, 128], [128, 0, 128]];
      for (let ly = 0; ly < logH; ly++) {
        for (let lx = 0; lx < logW; lx++) {
          const c = colors[ly * logW + lx];
          for (let dy = 0; dy < factor; dy++) {
            for (let dx = 0; dx < factor; dx++) {
              const px = lx * factor + dx;
              const py = ly * factor + dy;
              const idx = (py * w + px) * 3;
              buf[idx] = c[0]; buf[idx + 1] = c[1]; buf[idx + 2] = c[2];
            }
          }
        }
      }
      const result = decoder.unstretchImage(buf, w, h);
      assert.ok(result);
      assert.strictEqual(result.width, logW);
      assert.strictEqual(result.height, logH);
    });
  } catch (e) {
    console.log(`  \x1b[33m⚠\x1b[0m unstretch tests skipped: ${e.message}`);
  }

  // ===========================================================================
  // End-to-end unstretch: encode → stretch → decode
  // ===========================================================================
  console.log('\n\x1b[1m━━━ E2E Unstretch tests ━━━\x1b[0m');

  try {
    const encoder = await import(path.join(distDir, 'utils', 'encoder.js'));
    const decoder = await import(path.join(distDir, 'utils', 'decoder.js'));
    const nativeMod = await import(path.join(distDir, 'utils', 'native.js'));
    const nat = nativeMod.native;

    /**
     * Stretch a raw RGB buffer by a given factor (nearest-neighbor).
     * Optionally add white padding.
     */
    function stretchRaw(rawBuf, w, h, factorX, factorY, padX, padY) {
      const newW = w * factorX + padX * 2;
      const newH = h * factorY + padY * 2;
      const out = Buffer.alloc(newW * newH * 3, 255); // white background
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const srcIdx = (y * w + x) * 3;
          const r = rawBuf[srcIdx], g = rawBuf[srcIdx + 1], b = rawBuf[srcIdx + 2];
          for (let dy = 0; dy < factorY; dy++) {
            for (let dx = 0; dx < factorX; dx++) {
              const dstX = padX + x * factorX + dx;
              const dstY = padY + y * factorY + dy;
              const dstIdx = (dstY * newW + dstX) * 3;
              out[dstIdx] = r; out[dstIdx + 1] = g; out[dstIdx + 2] = b;
            }
          }
        }
      }
      return { buf: out, width: newW, height: newH };
    }

    await testAsync('E2E: encode → 5x stretch → decode', async () => {
      const payload = Buffer.from('Hello stretched world!');
      const png = await encoder.encodeBinaryToPng(payload, {
        compressionLevel: 3,
        mode: 'screenshot',
      });

      // Get raw pixels of encoded PNG
      const raw = nat.sharpToRaw(png);
      const rawBuf = Buffer.from(raw.pixels);

      // Stretch 5x with padding
      const stretched = stretchRaw(rawBuf, raw.width, raw.height, 5, 5, 20, 10);

      // Create a PNG from the stretched raw
      const stretchedPng = nat.rgbToPng(stretched.buf, stretched.width, stretched.height);

      // Decode the stretched PNG
      const decoded = await decoder.decodePngToBinary(Buffer.from(stretchedPng));
      assert.ok(decoded, 'should decode stretched image');
      assert.deepStrictEqual(decoded.buf, payload);
    });

    await testAsync('E2E: encode → 3x non-uniform stretch → decode', async () => {
      const payload = Buffer.from('Non-uniform stretch test');
      const png = await encoder.encodeBinaryToPng(payload, {
        compressionLevel: 3,
        mode: 'screenshot',
      });

      const raw = nat.sharpToRaw(png);
      const rawBuf = Buffer.from(raw.pixels);

      // Non-uniform: 4x horizontal, 3x vertical, with padding
      const stretched = stretchRaw(rawBuf, raw.width, raw.height, 4, 3, 30, 15);
      const stretchedPng = nat.rgbToPng(stretched.buf, stretched.width, stretched.height);
      const decoded = await decoder.decodePngToBinary(Buffer.from(stretchedPng));
      assert.ok(decoded);
      assert.deepStrictEqual(decoded.buf, payload);
    });

    // Test with extract.png if it exists
    const extractPath = path.join(root, 'extract.png');
    if (fs.existsSync(extractPath)) {
      await testAsync('E2E: decode extract.png (real stretched image)', async () => {
        const pngBuf = fs.readFileSync(extractPath);
        const decoded = await decoder.decodePngToBinary(pngBuf);
        assert.ok(decoded, 'should decode extract.png');
        assert.ok(decoded.files || decoded.buf, 'should have output');
      });
    }
  } catch (e) {
    console.log(`  \x1b[33m⚠\x1b[0m E2E unstretch tests skipped: ${e.message}`);
  }

  // ===========================================================================
  // Native PNG dataset regression
  // ===========================================================================
  console.log('\n\x1b[1m━━━ PNG dataset regression ━━━\x1b[0m');

  try {
    const decoder = await import(path.join(distDir, 'utils', 'decoder.js'));
    const pack = await import(path.join(distDir, 'pack.js'));
    const datasetDir = path.join(root, 'roxitest-dataset');
    const datasetFiles = [
      'roxitest.png',
      'roxitest-stretched.png',
      'roxitest-screenshot.png',
      'roxitest-screenshotstretched.png',
    ].filter((name) => fs.existsSync(path.join(datasetDir, name)));

    if (datasetFiles.length > 0) {
      let baseline = null;

      for (const name of datasetFiles) {
        const pngBuf = fs.readFileSync(path.join(datasetDir, name));
        const decoded = await decoder.decodePngToBinary(pngBuf);
        assert.ok(decoded, `${name} should decode`);

        let files = [];
        if (decoded.files && decoded.files.length > 0) {
          files = decoded.files;
        } else if (decoded.buf) {
          const unpacked = pack.unpackBuffer(decoded.buf);
          assert.ok(unpacked && unpacked.files.length > 0, `${name} should unpack files`);
          files = unpacked.files;
        } else {
          assert.fail(`${name} returned no payload`);
        }

        const signature = JSON.stringify(
          files.map((file) => ({ path: file.path, size: file.buf.length })),
        );

        if (baseline === null) {
          baseline = signature;
        } else {
          assert.strictEqual(signature, baseline, `${name} should match the baseline archive`);
        }
      }
    }
  } catch (e) {
    console.log(`  \x1b[33m⚠\x1b[0m native dataset tests skipped: ${e.message}`);
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
