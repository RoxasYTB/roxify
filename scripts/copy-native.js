#!/usr/bin/env node

import { copyFileSync, existsSync } from 'fs';
import { arch, platform } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const platformMap = {
  linux: 'x86_64-unknown-linux-gnu',
  darwin: arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
  win32: 'x86_64-pc-windows-msvc',
};

const extMap = {
  linux: 'so',
  darwin: 'dylib',
  win32: 'dll',
};

const currentPlatform = platform();
const target = platformMap[currentPlatform];
const ext = extMap[currentPlatform];

if (!target || !ext) {
  console.error(`Unsupported platform: ${currentPlatform}`);
  process.exit(1);
}

const sourceFile = join(
  rootDir,
  'target',
  'release',
  `libroxify_native.${ext}`,
);
const destFile = join(rootDir, 'libroxify_native.node');

if (existsSync(sourceFile)) {
  copyFileSync(sourceFile, destFile);
  console.log(`✓ Copied ${sourceFile} → ${destFile}`);
} else {
  console.warn(`⚠ Source file not found: ${sourceFile}`);
  console.log('Build the native module first with: npm run build:native');
}
