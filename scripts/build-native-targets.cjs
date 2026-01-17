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

  const builtName =
    t.ext === 'dll' ? `roxify_native.${t.ext}` : `libroxify_native.${t.ext}`;
  const src = join(root, 'target', t.triple, 'release', builtName);
  if (!existsSync(src)) {
    console.error(`Build succeeded but artifact not found: ${src}`);
    failed = true;
    continue;
  }

  const dest = join(outDir, t.out);
  try {
    copyFileSync(src, dest);
    try {
      chmodSync(dest, 0o755);
    } catch {}
    console.log(`Copied ${src} -> ${dest}`);
  } catch (e) {
    console.error(`Failed to copy artifact to ${dest}:`, e.message || e);
    failed = true;
  }
}

if (failed) {
  if (process.env.IGNORE_TARGET_FAILURES === '1') {
    console.warn(
      '\nOne or more targets failed, but IGNORE_TARGET_FAILURES=1 so continuing.',
    );
    console.log('\nArtifacts prepared in target/ (some targets missing).');
    process.exit(0);
  }

  console.error('\nOne or more targets failed.');
  process.exit(2);
}

console.log('\nAll targets built and copied to target/.');
process.exit(0);
