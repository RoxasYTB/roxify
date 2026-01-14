#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const windowsBinary = join(
  rootDir,
  'target',
  'x86_64-pc-windows-gnu',
  'release',
  'roxify_native.exe',
);

const destBinary = join(rootDir, 'dist', 'roxify_native.exe');

const distDir = dirname(destBinary);
if (!existsSync(distDir)) {
  mkdirSync(distDir, { recursive: true });
}

if (existsSync(windowsBinary)) {
  copyFileSync(windowsBinary, destBinary);
  console.log(`✓ Copied Windows CLI binary: ${windowsBinary} → ${destBinary}`);
} else {
  console.warn(`⚠ Windows CLI binary not found: ${windowsBinary}`);
  console.log(
    'Build it first with: cargo build --release --bin roxify_native --target x86_64-pc-windows-gnu',
  );
}
