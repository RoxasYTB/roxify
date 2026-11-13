import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Run: node --expose-gc scripts/benchmark-pack.mjs <baseline-git-ref>
// Measures packing cached files only; this is not an end-to-end encode benchmark.
const baselineRef = process.argv[2];
if (!baselineRef || !global.gc) {
  throw new Error('Usage: node --expose-gc scripts/benchmark-pack.mjs <baseline-git-ref>');
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseline = execFileSync('git', ['show', `${baselineRef}:src/pack.ts`], { cwd: repo, encoding: 'utf8' });
const current = readFileSync(join(repo, 'src/pack.ts'), 'utf8');
const load = async (source) => {
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const modules = { baseline: await load(baseline), current: await load(current) };
const fixture = mkdtempSync(join(tmpdir(), 'roxify-pack-bench-'));
const results = { baseline: [], current: [] };
let expected;

try {
  const payload = Buffer.alloc(1024 * 1024, 37);
  for (let i = 0; i < 100; i++) writeFileSync(join(fixture, `${i}.bin`), payload);
  for (let i = 0; i < 10; i++) {
    for (const key of (i % 2 ? ['current', 'baseline'] : ['baseline', 'current'])) {
      global.gc();
      const start = performance.now();
      const { stream } = await modules[key].packPathsGenerator([fixture], fixture);
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of stream) {
        bytes += chunk.length;
        hash.update(chunk);
      }
      const ms = performance.now() - start;
      const digest = hash.digest('hex');
      expected ??= digest;
      if (digest !== expected) throw new Error('Packed bytes changed between versions');
      // Discard two warmup rounds; alternate execution order to reduce bias.
      if (i >= 2) results[key].push(ms);
      console.log(JSON.stringify({ round: i, version: key, ms, bytes, sha256: digest }));
    }
  }
  const medians = {};
  for (const [key, times] of Object.entries(results)) {
    times.sort((a, b) => a - b);
    medians[key] = (times[3] + times[4]) / 2;
  }
  console.log(JSON.stringify({
    node: process.version,
    platform: process.platform,
    baselineRef,
    inputBytes: 100 * 1024 * 1024,
    medianMs: medians,
    lessTimePercent: 100 * (1 - medians.current / medians.baseline),
  }, null, 2));
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
