#!/usr/bin/env node

import { copyFileSync, existsSync } from 'fs';
import { arch, platform } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

/**
 * Map Node.js os.platform()+os.arch() to Rust target triple(s).
 */
function getTargets() {
  const os = platform();
  const cpu = arch();

  const map = {
    linux: {
      x64: { triples: ['x86_64-unknown-linux-gnu'], ext: 'so', libPrefix: true },
      ia32: { triples: ['i686-unknown-linux-gnu'], ext: 'so', libPrefix: true },
      arm64: { triples: ['aarch64-unknown-linux-gnu'], ext: 'so', libPrefix: true },
    },
    darwin: {
      x64: { triples: ['x86_64-apple-darwin'], ext: 'dylib', libPrefix: true },
      arm64: { triples: ['aarch64-apple-darwin'], ext: 'dylib', libPrefix: true },
    },
    win32: {
      x64: { triples: ['x86_64-pc-windows-msvc', 'x86_64-pc-windows-gnu'], ext: 'dll', libPrefix: false },
      ia32: { triples: ['i686-pc-windows-msvc', 'i686-pc-windows-gnu'], ext: 'dll', libPrefix: false },
      arm64: { triples: ['aarch64-pc-windows-msvc'], ext: 'dll', libPrefix: false },
    },
  };

  const archMap = map[os];
  if (!archMap || !archMap[cpu]) {
    console.error(`Unsupported platform: ${os}-${cpu}`);
    process.exit(1);
  }
  return archMap[cpu];
}

const { triples, ext, libPrefix } = getTargets();
const profiles = ['release', 'fastdev'];
const possibleBases = libPrefix
  ? ['libroxify_native', 'roxify_native']
  : ['roxify_native', 'libroxify_native'];

let found = false;

for (const triple of triples) {
  if (found) break;
  for (const profile of profiles) {
    if (found) break;
    for (const base of possibleBases) {
      const candidates = [
        join(rootDir, 'target', triple, profile, `${base}.${ext}`),
        join(rootDir, 'target', profile, `${base}.${ext}`),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) {
          // Copy as generic name (backward compat)
          const destGeneric = join(rootDir, 'roxify_native.node');
          copyFileSync(candidate, destGeneric);
          console.log(`✓ Copied ${candidate} → ${destGeneric}`);

          // Copy with platform-specific name (primary lookup)
          const destTarget = join(rootDir, `roxify_native-${triple}.node`);
          copyFileSync(candidate, destTarget);
          console.log(`✓ Copied ${candidate} → ${destTarget}`);

          found = true;
          break;
        }
      }
    }
  }
}

if (!found) {
  console.warn(
    `⚠ Native binary not found for ${platform()}-${arch()} (triples: ${triples.join(', ')}).`,
  );
  console.log(
    'Build the native module first with: npm run build:native or npm run build:native:quick-release',
  );
}
