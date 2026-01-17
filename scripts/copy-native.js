#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { arch, platform } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const platformMap = {
  linux: 'x86_64-unknown-linux-gnu',
  win32: 'x86_64-pc-windows-gnu',
};

const platformAltMap = {
  win32: 'x86_64-pc-windows-msvc',
};

const extMap = {
  linux: 'so',
  win32: 'dll',
};

const libNameMap = {
  linux: 'libroxify_native',
  win32: 'roxify_native',
};

const currentPlatform = platform();
const target = platformMap[currentPlatform];
const targetAlt = platformAltMap[currentPlatform];
const ext = extMap[currentPlatform];
const libName = libNameMap[currentPlatform];

if (!target || !ext || !libName) {
  console.error(`Unsupported platform: ${currentPlatform}`);
  process.exit(1);
}

const profiles = ['release', 'fastdev'];
const possibleBases = [libName, libName.replace(/^lib/, '')];
const destFile = join(rootDir, 'roxify_native.node');
const destFileWithTarget = join(rootDir, `roxify_native-${target}.node`);

let found = false;
for (const profile of profiles) {
  for (const base of possibleBases) {
    const candidates = [
      join(rootDir, 'target', profile, `${base}.${ext}`),
      join(rootDir, 'target', target, profile, `${base}.${ext}`),
      ...(targetAlt
        ? [join(rootDir, 'target', targetAlt, profile, `${base}.${ext}`)]
        : []),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        copyFileSync(candidate, destFile);
        copyFileSync(candidate, destFileWithTarget);
        console.log(`✓ Copied ${candidate} → ${destFile}`);
        console.log(`✓ Copied ${candidate} → ${destFileWithTarget}`);
        // also copy into dist so runtime (dist/utils) can find it after packaging
        try {
          mkdirSync(join(rootDir, 'dist'), { recursive: true });
          const distDest = join(rootDir, 'dist', 'roxify_native.node');
          const distDestWithTarget = join(
            rootDir,
            'dist',
            `roxify_native-${target}.node`,
          );
          copyFileSync(candidate, distDest);
          copyFileSync(candidate, distDestWithTarget);
          console.log(`✓ Copied ${candidate} → ${distDest}`);
          console.log(`✓ Copied ${candidate} → ${distDestWithTarget}`);
        } catch (e) {}
        found = true;
        break;
      }
    }
    if (found) break;
  }
  if (found) break;
}

if (!found) {
  console.warn(
    `⚠ Source file not found for any profile (${profiles.join(
      ', ',
    )}): target/${target}/{${profiles.join(',')}}/*.{${possibleBases.join(
      ',',
    )}}.${ext}`,
  );
  console.log(
    'Build the native module first with: npm run build:native or npm run build:native:quick-release',
  );
}
