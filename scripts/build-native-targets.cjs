#!/usr/bin/env node
const { execSync } = require('child_process');
const { existsSync, copyFileSync, mkdirSync, chmodSync } = require('fs');
const { join } = require('path');

const root = process.cwd();
const outDir = join(root, 'target');

const targets = [
  {
    name: 'linux',
    triple: 'x86_64-unknown-linux-gnu',
    ext: 'so',
    out: 'libroxify_native-x86_64-unknown-linux-gnu.node',
  },
  {
    name: 'macos-x64',
    triple: 'x86_64-apple-darwin',
    ext: 'dylib',
    out: 'libroxify_native-x86_64-apple-darwin.node',
  },
  {
    name: 'macos-arm',
    triple: 'aarch64-apple-darwin',
    ext: 'dylib',
    out: 'libroxify_native-aarch64-apple-darwin.node',
  },
  {
    name: 'windows',
    triple: 'x86_64-pc-windows-msvc',
    ext: 'dll',
    out: 'roxify_native-x86_64-pc-windows-msvc.node',
  },
];

function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
}

mkdirSync(outDir, { recursive: true });

let failed = false;
for (const t of targets) {
  console.log(`\n=== Building ${t.name} (${t.triple}) ===`);
  try {
    run(`cargo build --release --lib --target ${t.triple}`);
  } catch (e) {
    console.error(`Failed to build target ${t.triple}:`, e.message || e);
    failed = true;
    continue;
  }

  const builtName = t.ext === 'dll' ? `roxify_native.${t.ext}` : `libroxify_native.${t.ext}`;
  const src = join(root, 'target', t.triple, 'release', builtName);
  if (!existsSync(src)) {
    console.error(`Build succeeded but artifact not found: ${src}`);
    failed = true;
    continue;
  }

  const dest = join(outDir, t.out);
  try {
    copyFileSync(src, dest);
    try { chmodSync(dest, 0o755); } catch {}
    console.log(`Copied ${src} -> ${dest}`);
  } catch (e) {
    console.error(`Failed to copy artifact to ${dest}:`, e.message || e);
    failed = true;
  }
}

if (failed) {
  console.error('\nOne or more targets failed.');
  process.exit(2);
}

console.log('\nAll targets built and copied to target/.');
process.exit(0);
