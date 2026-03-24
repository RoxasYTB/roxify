#!/usr/bin/env node
const { execSync } = require('child_process');
const { existsSync, copyFileSync, mkdirSync, chmodSync } = require('fs');
const { join } = require('path');

const root = process.cwd();
const outDir = join(root, 'target');

const targets = [
  // Linux
  {
    name: 'linux-x64',
    triple: 'x86_64-unknown-linux-gnu',
    ext: 'so',
    out: 'roxify_native-x86_64-unknown-linux-gnu.node',
    libPrefix: true,
  },
  {
    name: 'linux-ia32',
    triple: 'i686-unknown-linux-gnu',
    ext: 'so',
    out: 'roxify_native-i686-unknown-linux-gnu.node',
    libPrefix: true,
  },
  {
    name: 'linux-arm64',
    triple: 'aarch64-unknown-linux-gnu',
    ext: 'so',
    out: 'roxify_native-aarch64-unknown-linux-gnu.node',
    libPrefix: true,
  },
  // macOS
  {
    name: 'macos-x64',
    triple: 'x86_64-apple-darwin',
    ext: 'dylib',
    out: 'roxify_native-x86_64-apple-darwin.node',
    libPrefix: true,
  },
  {
    name: 'macos-arm64',
    triple: 'aarch64-apple-darwin',
    ext: 'dylib',
    out: 'roxify_native-aarch64-apple-darwin.node',
    libPrefix: true,
  },
  // Windows
  {
    name: 'windows-x64',
    triple: 'x86_64-pc-windows-msvc',
    ext: 'dll',
    out: 'roxify_native-x86_64-pc-windows-msvc.node',
    libPrefix: false,
  },
  {
    name: 'windows-ia32',
    triple: 'i686-pc-windows-msvc',
    ext: 'dll',
    out: 'roxify_native-i686-pc-windows-msvc.node',
    libPrefix: false,
  },
  {
    name: 'windows-arm64',
    triple: 'aarch64-pc-windows-msvc',
    ext: 'dll',
    out: 'roxify_native-aarch64-pc-windows-msvc.node',
    libPrefix: false,
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
    const features = process.env.BUILD_FEATURES
      ? ` --features ${process.env.BUILD_FEATURES}`
      : '';

    const useSystemZstd =
      process.env.USE_SYSTEM_ZSTD === '1' ? 'ZSTD_SYS_USE_PKG_CONFIG=1 ' : '';

    let rustflags = process.env.RUSTFLAGS || '';
    if (process.env.FAST_RELEASE === '1') {
      rustflags = `${rustflags} -C codegen-units=4 -C opt-level=2`.trim();
    }

    const rustcWrapper = process.env.RUSTC_WRAPPER
      ? `RUSTC_WRAPPER=${process.env.RUSTC_WRAPPER} `
      : '';

    const envPrefix = `${useSystemZstd}${rustcWrapper}${
      rustflags ? `RUSTFLAGS='${rustflags}' ` : ''
    }`;

    const profile =
      process.env.FAST_RELEASE === '1' ? '--profile fastdev' : '--release';

    const jobs = process.env.MAX_JOBS ? ` -j ${process.env.MAX_JOBS}` : '';

    const priorityPrefix = process.env.LOW_CPU === '1' ? 'nice -n 10 ' : '';

    const cmd = `${priorityPrefix}${envPrefix}cargo build ${profile} --lib --no-default-features${features} --target ${t.triple}${jobs}`;
    run(cmd);
  } catch (e) {
    console.error(`Failed to build target ${t.triple}:`, e.message || e);
    failed = true;
    continue;
  }

  const builtName = t.libPrefix
    ? `libroxify_native.${t.ext}`
    : `roxify_native.${t.ext}`;
  const profileDir =
    process.env.FAST_RELEASE === '1' ? 'fastdev' : 'release';
  const src = join(root, 'target', t.triple, profileDir, builtName);
  if (!existsSync(src)) {
    console.error(`Build succeeded but artifact not found: ${src}`);
    failed = true;
    continue;
  }

  const dest = join(outDir, t.out);
  const rootDest = join(root, t.out);
  try {
    copyFileSync(src, dest);
    copyFileSync(src, rootDest);
    try {
      chmodSync(dest, 0o755);
      chmodSync(rootDest, 0o755);
    } catch {}
    console.log(`Copied ${src} -> ${dest}`);
    console.log(`Copied ${src} -> ${rootDest}`);
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
