import { existsSync } from 'fs';
import { createRequire } from 'module';
import { arch, platform } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

function getNativeModule() {
  let moduleDir: string;
  let nativeRequire: NodeRequire;

  if (typeof __dirname !== 'undefined') {
    moduleDir = __dirname;
    nativeRequire = require;
  } else {
    // ESM: derive module directory from this file's URL and create a require based on it
    moduleDir = dirname(fileURLToPath(import.meta.url));
    try {
      nativeRequire = require;
    } catch {
      nativeRequire = createRequire(import.meta.url);
    }
  }

  function getNativePath(): string {
    const platformMap: Record<string, string> = {
      linux: 'x86_64-unknown-linux-gnu',
      darwin:
        arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
      win32: 'x86_64-pc-windows-gnu',
    };

    const platformAltMap: Record<string, string> = {
      win32: 'x86_64-pc-windows-msvc',
    };

    const extMap: Record<string, string> = {
      linux: 'so',
      darwin: 'dylib',
      win32: 'node',
    };

    const currentPlatform = platform();
    const target = platformMap[currentPlatform];
    const targetAlt = platformAltMap[currentPlatform];
    const ext = extMap[currentPlatform];

    if (!target || !ext) {
      throw new Error(`Unsupported platform: ${currentPlatform}`);
    }

    console.debug('[native] moduleDir', moduleDir);

    const targets = targetAlt ? [target, targetAlt] : [target];
    const candidates: string[] = [];

    for (const t of targets) {
      candidates.push(
        resolve(moduleDir, `../roxify_native-${t}.node`),
        resolve(moduleDir, `../libroxify_native-${t}.node`),
      );
    }

    candidates.push(
      resolve(moduleDir, '../roxify_native.node'),
      resolve(moduleDir, '../libroxify_native.node'),
    );

    let root = moduleDir && moduleDir !== '.' ? moduleDir : process.cwd();
    while (
      root.length > 1 &&
      !existsSync(resolve(root, 'package.json')) &&
      !existsSync(resolve(root, 'Cargo.toml'))
    ) {
      const parent = resolve(root, '..');
      if (parent === root) break;
      root = parent;
    }

    for (const t of targets) {
      candidates.push(
        resolve(root, `roxify_native-${t}.node`),
        resolve(root, `libroxify_native-${t}.node`),
      );
    }

    candidates.push(
      resolve(root, 'target/release/roxify_native.node'),
      resolve(root, 'target/release/libroxify_native.so'),
      resolve(root, 'target/release/roxify_native.so'),
      resolve(root, 'node_modules/roxify/roxify_native.node'),
    );

    for (const c of candidates) {
      try {
        if (!existsSync(c)) continue;
        if (c.endsWith('.so')) {
          const nodeAlias = c.replace(/\.so$/, '.node');
          try {
            if (!existsSync(nodeAlias)) {
              require('fs').copyFileSync(c, nodeAlias);
            }
            console.debug('[native] using node alias', nodeAlias);
            return nodeAlias;
          } catch (e) {
            return c;
          }
        }
        console.debug('[native] using path', c);
        return c;
      } catch {}
    }

    throw new Error(
      `Native module not found for ${currentPlatform}-${arch()}. Checked: ${candidates.join(
        ' ',
      )}`,
    );
  }

  return nativeRequire(getNativePath());
}

export const native = getNativeModule();
