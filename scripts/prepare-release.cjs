#!/usr/bin/env node
const { execSync } = require('child_process');
const { copyFileSync, existsSync, mkdirSync } = require('fs');
const { join } = require('path');

const root = process.cwd();
const releaseDir = join(root, 'release');

function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
}

run('npm run build');

const targetsScript = 'node scripts/build-native-targets.cjs';
run(targetsScript);

mkdirSync(releaseDir, { recursive: true });

const targets = [
  { triple: 'x86_64-unknown-linux-gnu', ext: 'so', name: 'libroxify_native' },
  { triple: 'x86_64-apple-darwin', ext: 'dylib', name: 'libroxify_native' },
  { triple: 'aarch64-apple-darwin', ext: 'dylib', name: 'libroxify_native' },
  { triple: 'x86_64-pc-windows-msvc', ext: 'dll', name: 'roxify_native' },
];

const profile = process.env.FAST_RELEASE === '1' ? 'fastdev' : 'release';

for (const t of targets) {
  const src = join(root, 'target', t.triple, profile, `${t.name}.${t.ext}`);
  const dest = join(releaseDir, `roxify_native-${t.triple}.node`);
  try {
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`✓ Copied ${src} → ${dest}`);
    } else {
      console.warn(`⚠ Not found ${src} (skipped)`);
    }
  } catch (e) {
    console.error('Copy error:', e.message || e);
  }
}

console.log('\nRelease artifacts prepared in release/');
process.exit(0);
