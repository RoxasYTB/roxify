#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');

if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

const targets = [
  { platform: 'win32', triple: 'x86_64-pc-windows-gnu', name: 'roxify_native.exe' },
  { platform: 'win32', triple: 'x86_64-pc-windows-msvc', name: 'roxify_native.exe' },
  { platform: 'linux', triple: 'x86_64-unknown-linux-gnu', name: 'roxify_native' },
  { platform: 'darwin', triple: 'x86_64-apple-darwin', name: 'roxify_native' },
  { platform: 'darwin', triple: 'aarch64-apple-darwin', name: 'roxify_native' },
];

let copied = false;

for (const t of targets) {
  const src = join(rootDir, 'target', t.triple, 'release', t.name);
  if (!existsSync(src)) continue;
  const dest = join(distDir, t.name);
  copyFileSync(src, dest);
  if (t.platform !== 'win32') {
    try { chmodSync(dest, 0o755); } catch { }
  }
  console.log(`Copied CLI binary: ${src} -> ${dest}`);
  copied = true;
}

const hostBinName = process.platform === 'win32' ? 'roxify_native.exe' : 'roxify_native';
const hostRelease = join(rootDir, 'target', 'release', hostBinName);
if (!copied && existsSync(hostRelease)) {
  const dest = join(distDir, hostBinName);
  copyFileSync(hostRelease, dest);
  if (process.platform !== 'win32') {
    try { chmodSync(dest, 0o755); } catch { }
  }
  console.log(`Copied host CLI binary: ${hostRelease} -> ${dest}`);
  copied = true;
}

if (!copied) {
  console.warn('No CLI binary found. Build with: cargo build --release --bin roxify_native');
}
