#!/usr/bin/env node
/**
 * Benchmark: zip vs tar.gz vs 7z vs roxify
 *
 * Generates test datasets of various sizes and types, then compresses
 * with each tool, measuring time and output size.
 */

import { execSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, statSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

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
  // Generate lorem-ipsum-style text files
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
        metadata: { version: '1.6.6', format: 'json', encoding: 'utf-8' },
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

// ─── Compression runners ────────────────────────────────────────────────────

function benchZip(inputDir, outputFile) {
  const start = process.hrtime.bigint();
  execSync(`cd "${inputDir}" && zip -r -q "${outputFile}" .`, { stdio: 'pipe' });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function benchTarGz(inputDir, outputFile) {
  const start = process.hrtime.bigint();
  execSync(`tar czf "${outputFile}" -C "${inputDir}" .`, { stdio: 'pipe' });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

function bench7z(inputDir, outputFile) {
  const start = process.hrtime.bigint();
  execSync(`7z a -mx=5 -bso0 -bsp0 "${outputFile}" "${inputDir}/"*`, { stdio: 'pipe' });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
}

async function benchRoxify(inputDir, outputFile) {
  // Use the CLI to encode the directory
  const start = process.hrtime.bigint();
  execSync(`node "${join(ROOT, 'dist/cli.js')}" encode "${inputDir}" "${outputFile}" -m compact`, {
    stdio: 'pipe',
    cwd: ROOT,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  const ms = hrMs(start);
  return { ms, size: statSync(outputFile).size };
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

const TOOLS = ['zip', 'tar.gz', '7z', 'roxify'];

(async () => {
  console.log('Roxify Compression Benchmark');
  console.log('============================\n');
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Node: ${process.version}`);
  console.log(`Date: ${new Date().toISOString().split('T')[0]}\n`);

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

    // zip
    try {
      const zipOut = join(TMP, 'out.zip');
      const r = benchZip(dataDir, zipOut);
      row.results.zip = r;
      console.log(`  zip:    ${fmt(r.size)} (${pct(r.size, totalSize)}) in ${fmtTime(r.ms)}`);
    } catch (e) {
      console.log(`  zip:    FAILED - ${e.message}`);
    }

    // tar.gz
    try {
      const tgzOut = join(TMP, 'out.tar.gz');
      const r = benchTarGz(dataDir, tgzOut);
      row.results['tar.gz'] = r;
      console.log(`  tar.gz: ${fmt(r.size)} (${pct(r.size, totalSize)}) in ${fmtTime(r.ms)}`);
    } catch (e) {
      console.log(`  tar.gz: FAILED - ${e.message}`);
    }

    // 7z
    try {
      const szOut = join(TMP, 'out.7z');
      const r = bench7z(dataDir, szOut);
      row.results['7z'] = r;
      console.log(`  7z:     ${fmt(r.size)} (${pct(r.size, totalSize)}) in ${fmtTime(r.ms)}`);
    } catch (e) {
      console.log(`  7z:     FAILED - ${e.message}`);
    }

    // roxify
    try {
      const roxOut = join(TMP, 'out.png');
      const r = await benchRoxify(dataDir, roxOut);
      row.results.roxify = r;
      console.log(`  roxify: ${fmt(r.size)} (${pct(r.size, totalSize)}) in ${fmtTime(r.ms)}`);
    } catch (e) {
      console.log(`  roxify: FAILED - ${e.stderr?.toString() || e.message}`);
    }

    results.push(row);
    console.log('');
  }

  // Output markdown table
  console.log('\n=== Markdown Table ===\n');
  console.log('| Dataset | Files | Original | zip | tar.gz | 7z | roxify (PNG) |');
  console.log('|---------|------:|----------|-----|--------|----|--------------|');

  for (const r of results) {
    const cols = [r.dataset, r.files, fmt(r.originalSize)];
    for (const tool of TOOLS) {
      const t = r.results[tool];
      if (t) {
        cols.push(`${fmt(t.size)} (${pct(t.size, r.originalSize)}) ${fmtTime(t.ms)}`);
      } else {
        cols.push('N/A');
      }
    }
    console.log(`| ${cols.join(' | ')} |`);
  }

  // Cleanup
  rmSync(TMP, { recursive: true, force: true });

  console.log('\nBenchmark complete.');
})();
