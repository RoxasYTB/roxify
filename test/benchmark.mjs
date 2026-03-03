#!/usr/bin/env node
/**
 * Benchmark: zip vs tar.gz vs 7z vs roxify
 *
 * ALL tools use MAXIMUM compression.
 * Measures both compression and decompression time + ratio.
 */

import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const TMP = join(ROOT, '.bench-tmp');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

function pct(compressed, original) {
  return ((compressed / original) * 100).toFixed(1) + '%';
}

function hrMs(start) {
  const diff = process.hrtime.bigint() - start;
  return Number(diff) / 1e6; // ms
}

function fmtTime(ms) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return ms.toFixed(0) + 'ms';
}

function dirSize(dir) {
  let total = 0;
  for (const f of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) {
      total += statSync(join(f.parentPath || f.path, f.name)).size;
    }
  }
  return total;
}

function clean() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

// ─── Dataset generators ──────────────────────────────────────────────────────

function generateTextDataset(dir, sizeTarget) {
  mkdirSync(dir, { recursive: true });
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat'.split(' ');
  let written = 0;
  let idx = 0;
  while (written < sizeTarget) {
    const lines = [];
    const fileSize = Math.min(sizeTarget - written, 4096 + Math.floor(Math.random() * 8192));
    let lineLen = 0;
    while (lineLen < fileSize) {
      const line = [];
      const lineTarget = 60 + Math.floor(Math.random() * 80);
      while (line.join(' ').length < lineTarget) {
        line.push(words[Math.floor(Math.random() * words.length)]);
      }
      const l = line.join(' ') + '\n';
      lines.push(l);
      lineLen += l.length;
    }
    const content = lines.join('');
    writeFileSync(join(dir, `text_${idx}.txt`), content);
    written += content.length;
    idx++;
  }
  return idx;
}

function generateJsonDataset(dir, sizeTarget) {
  mkdirSync(dir, { recursive: true });
  let written = 0;
  let idx = 0;
  while (written < sizeTarget) {
    const obj = {
      id: idx,
      name: `item_${idx}`,
      timestamp: Date.now(),
      values: Array.from({ length: 20 }, () => Math.random()),
      nested: {
        description: 'A nested object with repeated structure for compression benchmarks',
        tags: ['benchmark', 'test', 'compression', 'roxify', `item${idx}`],
        metadata: { version: '1.6.7', format: 'json', encoding: 'utf-8' },
      },
    };
    const content = JSON.stringify(obj, null, 2) + '\n';
    writeFileSync(join(dir, `data_${idx}.json`), content);
    written += content.length;
    idx++;
  }
  return idx;
}

function generateBinaryDataset(dir, sizeTarget) {
  mkdirSync(dir, { recursive: true });
  let written = 0;
  let idx = 0;
  while (written < sizeTarget) {
    const chunkSize = Math.min(sizeTarget - written, 16384 + Math.floor(Math.random() * 32768));
    const buf = randomBytes(chunkSize);
    writeFileSync(join(dir, `bin_${idx}.dat`), buf);
    written += chunkSize;
    idx++;
  }
  return idx;
}

function generateMixedDataset(dir, sizeTarget) {
  mkdirSync(dir, { recursive: true });
  const third = Math.floor(sizeTarget / 3);
  const txtDir = join(dir, 'text');
  const jsonDir = join(dir, 'json');
  const binDir = join(dir, 'binary');
  const n1 = generateTextDataset(txtDir, third);
  const n2 = generateJsonDataset(jsonDir, third);
  const n3 = generateBinaryDataset(binDir, third);
  return n1 + n2 + n3;
}

// ─── Compression runners (ALL at maximum compression) ────────────────────────

function benchZip(inputDir, outputFile) {
  // -9 = maximum compression (deflate best)
  const start = process.hrtime.bigint();
  execSync(`cd "${inputDir}" && zip -r -q -9 "${outputFile}" .`, { stdio: 'pipe' });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function decompressZip(zipFile, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const start = process.hrtime.bigint();
  execSync(`unzip -q -o "${zipFile}" -d "${outputDir}"`, { stdio: 'pipe' });
  return hrMs(start);
}

function benchTarGz(inputDir, outputFile) {
  // gzip -9 = maximum compression
  const start = process.hrtime.bigint();
  execSync(`tar -cf - -C "${inputDir}" . | gzip -9 > "${outputFile}"`, { stdio: 'pipe', shell: '/bin/bash' });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function decompressTarGz(tgzFile, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const start = process.hrtime.bigint();
  execSync(`tar xzf "${tgzFile}" -C "${outputDir}"`, { stdio: 'pipe' });
  return hrMs(start);
}

function bench7z(inputDir, outputFile) {
  // -mx=9 = ultra compression
  const start = process.hrtime.bigint();
  execSync(`7z a -mx=9 -bso0 -bsp0 "${outputFile}" "${inputDir}/"*`, { stdio: 'pipe' });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function decompress7z(szFile, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const start = process.hrtime.bigint();
  execSync(`7z x -bso0 -bsp0 -o"${outputDir}" "${szFile}"`, { stdio: 'pipe' });
  return hrMs(start);
}

function benchRoxify(inputDir, outputFile) {
  // roxify uses zstd level 19 (near-max) by default via CLI
  const start = process.hrtime.bigint();
  execSync(`node "${join(ROOT, 'dist/cli.js')}" encode "${inputDir}" "${outputFile}" -m compact`, {
    stdio: 'pipe',
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function decompressRoxify(pngFile, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const start = process.hrtime.bigint();
  execSync(`node "${join(ROOT, 'dist/cli.js')}" decode "${pngFile}" "${outputDir}"`, {
    stdio: 'pipe',
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return hrMs(start);
}

function benchRoxifyWav(inputDir, outputFile) {
  // roxify --sound uses WAV container instead of PNG
  const start = process.hrtime.bigint();
  execSync(`node "${join(ROOT, 'dist/cli.js')}" encode "${inputDir}" "${outputFile}" -m compact --sound`, {
    stdio: 'pipe',
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function decompressRoxifyWav(wavFile, outputDir) {
  mkdirSync(outputDir, { recursive: true });
  const start = process.hrtime.bigint();
  execSync(`node "${join(ROOT, 'dist/cli.js')}" decode "${wavFile}" "${outputDir}"`, {
    stdio: 'pipe',
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return hrMs(start);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const DATASETS = [
  { name: 'Text files (1 MB)', generator: generateTextDataset, size: 1 * 1024 * 1024 },
  { name: 'JSON files (1 MB)', generator: generateJsonDataset, size: 1 * 1024 * 1024 },
  { name: 'Binary files (1 MB)', generator: generateBinaryDataset, size: 1 * 1024 * 1024 },
  { name: 'Mixed files (5 MB)', generator: generateMixedDataset, size: 5 * 1024 * 1024 },
  { name: 'Text files (10 MB)', generator: generateTextDataset, size: 10 * 1024 * 1024 },
  { name: 'Mixed files (10 MB)', generator: generateMixedDataset, size: 10 * 1024 * 1024 },
];

const TOOLS = ['zip', 'tar.gz', '7z', 'roxify (PNG)', 'roxify (WAV)'];

(async () => {
  console.log('Roxify Compression Benchmark (MAX compression for all tools)');
  console.log('=============================================================\n');
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Node: ${process.version}`);
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`);
  console.log(`Config: zip -9 | gzip -9 | 7z -mx=9 | roxify zstd-19 (PNG & WAV)\n`);

  const results = [];

  for (const ds of DATASETS) {
    clean();
    const dataDir = join(TMP, 'data');
    mkdirSync(dataDir, { recursive: true });

    console.log(`--- ${ds.name} ---`);
    const fileCount = ds.generator(dataDir, ds.size);
    const totalSize = dirSize(dataDir);
    console.log(`  Files: ${fileCount}, Total: ${fmt(totalSize)}`);

    const row = { dataset: ds.name, files: fileCount, originalSize: totalSize, results: {} };

    // zip -9
    try {
      const zipOut = join(TMP, 'out.zip');
      const r = benchZip(dataDir, zipOut);
      const decDir = join(TMP, 'dec_zip');
      const decMs = decompressZip(zipOut, decDir);
      r.decMs = decMs;
      row.results.zip = r;
      console.log(`  zip:    ${fmt(r.size)} (${pct(r.size, totalSize)}) enc ${fmtTime(r.ms)} | dec ${fmtTime(decMs)}`);
    } catch (e) {
      console.log(`  zip:    FAILED - ${e.message}`);
    }

    // tar.gz (gzip -9)
    try {
      const tgzOut = join(TMP, 'out.tar.gz');
      const r = benchTarGz(dataDir, tgzOut);
      const decDir = join(TMP, 'dec_tgz');
      const decMs = decompressTarGz(tgzOut, decDir);
      r.decMs = decMs;
      row.results['tar.gz'] = r;
      console.log(`  tar.gz: ${fmt(r.size)} (${pct(r.size, totalSize)}) enc ${fmtTime(r.ms)} | dec ${fmtTime(decMs)}`);
    } catch (e) {
      console.log(`  tar.gz: FAILED - ${e.message}`);
    }

    // 7z -mx=9
    try {
      const szOut = join(TMP, 'out.7z');
      const r = bench7z(dataDir, szOut);
      const decDir = join(TMP, 'dec_7z');
      const decMs = decompress7z(szOut, decDir);
      r.decMs = decMs;
      row.results['7z'] = r;
      console.log(`  7z:     ${fmt(r.size)} (${pct(r.size, totalSize)}) enc ${fmtTime(r.ms)} | dec ${fmtTime(decMs)}`);
    } catch (e) {
      console.log(`  7z:     FAILED - ${e.message}`);
    }

    // roxify (PNG)
    try {
      const roxOut = join(TMP, 'out.png');
      const r = benchRoxify(dataDir, roxOut);
      const decDir = join(TMP, 'dec_rox');
      const decMs = decompressRoxify(roxOut, decDir);
      r.decMs = decMs;
      row.results['roxify (PNG)'] = r;
      console.log(`  roxify PNG: ${fmt(r.size)} (${pct(r.size, totalSize)}) enc ${fmtTime(r.ms)} | dec ${fmtTime(decMs)}`);
    } catch (e) {
      console.log(`  roxify PNG: FAILED - ${e.stderr?.toString() || e.message}`);
    }

    // roxify (WAV)
    try {
      const wavOut = join(TMP, 'out.wav');
      const r = benchRoxifyWav(dataDir, wavOut);
      const decDir = join(TMP, 'dec_rox_wav');
      const decMs = decompressRoxifyWav(wavOut, decDir);
      r.decMs = decMs;
      row.results['roxify (WAV)'] = r;
      console.log(`  roxify WAV: ${fmt(r.size)} (${pct(r.size, totalSize)}) enc ${fmtTime(r.ms)} | dec ${fmtTime(decMs)}`);
    } catch (e) {
      console.log(`  roxify WAV: FAILED - ${e.stderr?.toString() || e.message}`);
    }

    results.push(row);
    console.log('');
  }

  // Output markdown table
  console.log('\n=== Markdown Table ===\n');
  console.log('| Dataset | Original | Tool | Compressed | Ratio | Compress | Decompress |');
  console.log('|---------|----------|------|------------|-------|----------|------------|');

  for (const r of results) {
    let first = true;
    for (const tool of TOOLS) {
      const t = r.results[tool];
      const dsLabel = first ? r.dataset : '';
      const origLabel = first ? fmt(r.originalSize) : '';
      first = false;
      if (t) {
        console.log(`| ${dsLabel} | ${origLabel} | ${tool} | ${fmt(t.size)} | ${pct(t.size, r.originalSize)} | ${fmtTime(t.ms)} | ${fmtTime(t.decMs)} |`);
      } else {
        console.log(`| ${dsLabel} | ${origLabel} | ${tool} | N/A | N/A | N/A | N/A |`);
      }
    }
    console.log('|---|---|---|---|---|---|---|');
  }

  // Cleanup
  rmSync(TMP, { recursive: true, force: true });

  console.log('\nBenchmark complete.');
})();
