#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const targets = [
  { platform: 'win32', triple: 'x86_64-pc-windows-gnu', src: 'roxify_native.exe', dest: 'roxify_native.exe' },
  { platform: 'win32', triple: 'x86_64-pc-windows-msvc', src: 'roxify_native.exe', dest: 'roxify_native.exe' },
  { platform: 'linux', triple: 'x86_64-unknown-linux-gnu', src: 'roxify_native', dest: 'roxify_native' },
  { platform: 'darwin', triple: 'x86_64-apple-darwin', src: 'roxify_native', dest: 'roxify_native-macos-x64' },
  { platform: 'darwin', triple: 'aarch64-apple-darwin', src: 'roxify_native', dest: 'roxify_native-macos-arm64' },
];

function safeCopy(src, dest, isUnix) {
  copyFileSync(src, dest);
  if (isUnix) {
    try { chmodSync(dest, 0o755); } catch { }
  }
  console.log(`Copied CLI binary: ${src} -> ${dest}`);
}

let copied = false;

for (const t of targets) {
  const src = join(rootDir, 'target', t.triple, 'release', t.src);
  if (!existsSync(src)) continue;
  safeCopy(src, join(distDir, t.dest), t.platform !== 'win32');
  copied = true;
}

const darwinArm = join(distDir, 'roxify_native-macos-arm64');
const darwinX64 = join(distDir, 'roxify_native-macos-x64');
if (existsSync(darwinArm) || existsSync(darwinX64)) {
  const active = existsSync(darwinArm) ? darwinArm : darwinX64;
  safeCopy(active, join(distDir, 'roxify_native'), true);
}

const hostBinName = process.platform === 'win32' ? 'roxify_native.exe' : 'roxify_native';
const hostRelease = join(rootDir, 'target', 'release', hostBinName);
if (!copied && existsSync(hostRelease)) {
  safeCopy(hostRelease, join(distDir, hostBinName), process.platform !== 'win32');
  copied = true;
}

if (!copied) {
  console.warn('No CLI binary found. Build with: cargo build --release --bin roxify_native');
}
