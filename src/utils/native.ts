import { existsSync } from 'fs';
import { createRequire } from 'module';
import { arch, platform } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

function getNativeModule() {
  let moduleDir: string;
  let nativeRequire: NodeRequire;

  if (typeof __dirname !== 'undefined') {
    // Mode CJS - variables globales disponibles
    moduleDir = __dirname;
    // @ts-ignore
    nativeRequire = require;
  } else {
    // Try ESM import.meta.url first (may throw in CJS/bundled contexts), otherwise fallback to CWD
    try {
      // @ts-ignore - import.meta.url exists in proper ESM contexts
      const __filename = fileURLToPath(import.meta.url);
      moduleDir = dirname(__filename);
      nativeRequire = createRequire(import.meta.url);
    } catch {
      // Fallback (bundled CJS without __dirname): use current working directory
      moduleDir = process.cwd();
      try {
        // @ts-ignore
        nativeRequire = require;
      } catch {
        nativeRequire = createRequire(process.cwd());
      }
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

    const prebuiltPath = join(moduleDir, '../../libroxify_native.node');
    const bundlePath = join(moduleDir, '../libroxify_native.node');
    // compute repo root by walking up from moduleDir (fallback to process.cwd())
    // @ts-ignore
    console.debug('[native] moduleDir', moduleDir);
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

    const localTargetRelease = resolve(
      root,
      `target/release/libroxify_native${
        ext === 'node' ? '.node' : `-${target}.${ext}`
      }`,
    );
    const localReleaseGeneric = resolve(
      root,
      'target/release/libroxify_native.so',
    );
    const nodeModulesBase = resolve(root, 'node_modules/roxify');
    const nodeModulesTarget = resolve(
      nodeModulesBase,
      `libroxify_native-${target}.${ext}`,
    );
    const nodeModulesGeneric = resolve(
      nodeModulesBase,
      ext === 'node' ? 'libroxify_native.node' : `libroxify_native.${ext}`,
    );
    const bundleTarget = resolve(
      moduleDir,
      `../libroxify_native-${target}.${ext}`,
    );
    const bundleGeneric = resolve(moduleDir, bundlePath);

    const candidates = [
      localTargetRelease,
      localReleaseGeneric,
      nodeModulesTarget,
      nodeModulesGeneric,
      bundleTarget,
      bundleGeneric,
      prebuiltPath,
    ];

    // use built-in fs.existsSync (static import to work in ESM and CJS)
    for (const c of candidates) {
      try {
        if (!existsSync(c)) continue;
        // If it's a .so (native build) but Node expects .node extension, create a .node symlink
        if (c.endsWith('.so')) {
          const nodeAlias = c.replace(/\.so$/, '.node');
          try {
            if (!existsSync(nodeAlias)) {
              // copy the .so to a .node so Node treats it as a native addon
              // @ts-ignore
              require('fs').copyFileSync(c, nodeAlias);
            }
            // debug
            // @ts-ignore
            console.debug('[native] using node alias', nodeAlias);
            return nodeAlias;
          } catch (e) {
            // fallback to original .so (might fail to load via require)
            return c;
          }
        }
        // debug
        // @ts-ignore
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
