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
  win32: 'x86_64-pc-windows-gnu',
};

const extMap = {
  linux: 'so',
  darwin: 'dylib',
  win32: 'dll',
};

const libNameMap = {
  linux: 'libroxify_native',
  darwin: 'libroxify_native',
  win32: 'roxify_native',
};

const currentPlatform = platform();
const target = platformMap[currentPlatform];
const ext = extMap[currentPlatform];
const libName = libNameMap[currentPlatform];

if (!target || !ext || !libName) {
  console.error(`Unsupported platform: ${currentPlatform}`);
  process.exit(1);
}

const sourceFile = join(
  rootDir,
  'target',
  target,
  'release',
  `${libName}.${ext}`,
);
const destFile = join(rootDir, 'roxify_native.node');
const destFileWithTarget = join(rootDir, `roxify_native-${target}.node`);

if (existsSync(sourceFile)) {
  copyFileSync(sourceFile, destFile);
  copyFileSync(sourceFile, destFileWithTarget);
  console.log(`✓ Copied ${sourceFile} → ${destFile}`);
  console.log(`✓ Copied ${sourceFile} → ${destFileWithTarget}`);
} else {
  console.warn(`⚠ Source file not found: ${sourceFile}`);
  console.log('Build the native module first with: npm run build:native');
}
