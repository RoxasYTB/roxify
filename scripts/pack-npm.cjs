#!/usr/bin/env node
const { execSync } = require('child_process');
const { copyFileSync, existsSync, unlinkSync, mkdirSync } = require('fs');
const { join } = require('path');

const root = process.cwd();
function run(cmd) {
  console.log('> ' + cmd);
  execSync(cmd, { stdio: 'inherit' });
}

const profile = process.env.FAST_RELEASE === '1' ? 'fastdev' : 'release';

run('npm run build');

run('node scripts/build-native-targets.cjs');

const targets = [
  { triple: 'x86_64-unknown-linux-gnu', ext: 'so', name: 'libroxify_native' },
  { triple: 'x86_64-apple-darwin', ext: 'dylib', name: 'libroxify_native' },
  { triple: 'aarch64-apple-darwin', ext: 'dylib', name: 'libroxify_native' },
  { triple: 'x86_64-pc-windows-msvc', ext: 'dll', name: 'roxify_native' },
  { triple: 'x86_64-pc-windows-gnu', ext: 'dll', name: 'roxify_native' },
];

const copied = [];
for (const t of targets) {
  const src = join(root, 'target', t.triple, profile, `${t.name}.${t.ext}`);
  if (!existsSync(src)) {
    console.warn(`⚠ Missing artifact: ${src}`);
    continue;
  }
  const destName = `roxify_native-${t.triple}.node`;
  const dest = join(root, destName);
  copyFileSync(src, dest);
  console.log(`✓ Copied ${src} → ${destName}`);
  copied.push(dest);
  try {
    mkdirSync(join(root, 'dist'), { recursive: true });
    const distDest = join(root, 'dist', destName);
    copyFileSync(src, distDest);
    console.log(`✓ Copied ${src} → dist/${destName}`);
    copied.push(distDest);
  } catch (e) {}
}

const maybeLinux = join(
  root,
  'target',
  'x86_64-unknown-linux-gnu',
  profile,
  'libroxify_native.so',
);
if (existsSync(maybeLinux)) {
  copyFileSync(maybeLinux, join(root, 'libroxify_native.node'));
  copied.push(join(root, 'libroxify_native.node'));
  try {
    mkdirSync(join(root, 'dist'), { recursive: true });
    const distLinuxDest = join(root, 'dist', 'libroxify_native.node');
    copyFileSync(maybeLinux, distLinuxDest);
    copied.push(distLinuxDest);
  } catch (e) {}
}

run('npm pack');

for (const f of copied) {
  try {
    unlinkSync(f);
    console.log(`✓ Removed ${f}`);
  } catch (e) {}
}

console.log('\nPackage prepared (npm pack created).');
