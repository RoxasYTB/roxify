#!/usr/bin/env node

import { execSync } from 'child_process';
import { platform } from 'os';

const targets = [
  // Linux
  { name: 'Linux x64', target: 'x86_64-unknown-linux-gnu', ext: 'so', libPrefix: true },
  { name: 'Linux ia32', target: 'i686-unknown-linux-gnu', ext: 'so', libPrefix: true },
  { name: 'Linux ARM64', target: 'aarch64-unknown-linux-gnu', ext: 'so', libPrefix: true },
  // macOS
  { name: 'macOS x64', target: 'x86_64-apple-darwin', ext: 'dylib', libPrefix: true },
  { name: 'macOS ARM64', target: 'aarch64-apple-darwin', ext: 'dylib', libPrefix: true },
  // Windows
  { name: 'Windows x64', target: 'x86_64-pc-windows-msvc', ext: 'dll', libPrefix: false },
  { name: 'Windows ia32', target: 'i686-pc-windows-msvc', ext: 'dll', libPrefix: false },
  { name: 'Windows ARM64', target: 'aarch64-pc-windows-msvc', ext: 'dll', libPrefix: false },
];

console.log('🔧 Cross-Platform Build Script\n');

const currentPlatform = platform();
console.log(`Current platform: ${currentPlatform}\n`);

for (const { name, target, ext, libPrefix } of targets) {
  console.log(`Building ${name} (${target})...`);

  try {
    execSync(`rustup target add ${target}`, { stdio: 'inherit' });

    execSync(`cargo build --release --lib --no-default-features --target ${target}`, {
      stdio: 'inherit',
    });

    const prefix = libPrefix ? 'lib' : '';
    const sourcePath = `target/${target}/release/${prefix}roxify_native.${ext}`;
    const destDir = `artifacts/${target}`;
    const destPath = `${destDir}/roxify_native-${target}.node`;

    execSync(`mkdir -p ${destDir}`);
    execSync(`cp ${sourcePath} ${destPath}`);
    console.log(`✓ ${name} built: ${destPath}\n`);
  } catch (error) {
    console.error(`✗ Failed to build ${name}`);
    console.error(error.message);
    console.log('');
  }
}

console.log('✅ Build complete!');
