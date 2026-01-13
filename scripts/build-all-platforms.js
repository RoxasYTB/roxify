#!/usr/bin/env node

import { execSync } from 'child_process';
import { platform } from 'os';

const targets = [
  { name: 'Linux x64', target: 'x86_64-unknown-linux-gnu', ext: 'so' },
  { name: 'macOS x64', target: 'x86_64-apple-darwin', ext: 'dylib' },
  { name: 'macOS ARM64', target: 'aarch64-apple-darwin', ext: 'dylib' },
  { name: 'Windows x64', target: 'x86_64-pc-windows-msvc', ext: 'dll' },
];

console.log('🔧 Cross-Platform Build Script\n');

const currentPlatform = platform();
console.log(`Current platform: ${currentPlatform}\n`);

for (const { name, target, ext } of targets) {
  console.log(`Building ${name} (${target})...`);

  try {
    execSync(`rustup target add ${target}`, { stdio: 'inherit' });

    execSync(`cargo build --release --lib --target ${target}`, {
      stdio: 'inherit',
    });

    const sourcePath = `target/${target}/release/libroxify_native.${ext}`;
    const destPath = `libroxify_native-${target}.${ext}`;

    execSync(`cp ${sourcePath} ${destPath}`);
    console.log(`✓ ${name} built: ${destPath}\n`);
  } catch (error) {
    console.error(`✗ Failed to build ${name}`);
    console.error(error.message);
    console.log('');
  }
}

console.log('✅ Build complete!');
