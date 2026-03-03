import { existsSync } from 'fs';
import { createRequire } from 'module';
import { arch, platform } from 'os';
import { join, resolve } from 'path';

function getNativeModule() {
  let moduleDir: string;
  let nativeRequire: NodeRequire;

  if (typeof __dirname !== 'undefined') {
    moduleDir = __dirname;
    nativeRequire = require;
  } else {
    moduleDir = process.cwd();
    try {
      nativeRequire = require;
    } catch {
      nativeRequire = createRequire(process.cwd() + '/package.json');
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

    const prebuiltPath = join(moduleDir, '../../roxify_native.node');
    const prebuiltLibPath = join(moduleDir, '../../libroxify_native.node');
    const bundlePath = join(moduleDir, '../roxify_native.node');
    const bundleLibPath = join(moduleDir, '../libroxify_native.node');
    const bundlePathWithTarget = join(
      moduleDir,
      `../roxify_native-${target}.node`,
    );
    const bundleLibPathWithTarget = join(
      moduleDir,
      `../libroxify_native-${target}.node`,
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

    const bundleNode = resolve(moduleDir, '../roxify_native.node');
    const bundleLibNode = resolve(moduleDir, '../libroxify_native.node');
    const bundleNodeWithTarget = resolve(
      moduleDir,
      `../roxify_native-${target}.node`,
    );
    const bundleLibNodeWithTarget = resolve(
      moduleDir,
      `../libroxify_native-${target}.node`,
    );
    const repoNode = resolve(root, 'roxify_native.node');
    const repoLibNode = resolve(root, 'libroxify_native.node');
    const repoNodeWithTarget = resolve(root, `roxify_native-${target}.node`);
    const repoLibNodeWithTarget = resolve(
      root,
      `libroxify_native-${target}.node`,
    );
    const targetNode = resolve(root, 'target/release/roxify_native.node');
    const targetSo = resolve(root, 'target/release/roxify_native.so');
    const targetLibSo = resolve(root, 'target/release/libroxify_native.so');
    const nodeModulesNode = resolve(
      root,
      'node_modules/roxify/roxify_native.node',
    );
    const nodeModulesNodeWithTarget = resolve(
      root,
      `node_modules/roxify/roxify_native-${target}.node`,
    );
    const prebuiltNode = resolve(moduleDir, '../../roxify_native.node');
    const prebuiltLibNode = resolve(moduleDir, '../../libroxify_native.node');
    const prebuiltNodeWithTarget = resolve(
      moduleDir,
      `../../roxify_native-${target}.node`,
    );
    const prebuiltLibNodeWithTarget = resolve(
      moduleDir,
      `../../libroxify_native-${target}.node`,
    );

    // Support multiple possible OS triples (e.g. windows-gnu and windows-msvc)
    const targets = targetAlt ? [target, targetAlt] : [target];

    const candidates: string[] = [];

    for (const t of targets) {
      const bundleNodeWithT = resolve(moduleDir, `../roxify_native-${t}.node`);
      const bundleLibNodeWithT = resolve(
        moduleDir,
        `../libroxify_native-${t}.node`,
      );
      const repoNodeWithT = resolve(root, `roxify_native-${t}.node`);
      const repoLibNodeWithT = resolve(root, `libroxify_native-${t}.node`);
      const nodeModulesNodeWithT = resolve(
        root,
        `node_modules/roxify/roxify_native-${t}.node`,
      );
      const prebuiltNodeWithT = resolve(
        moduleDir,
        `../../roxify_native-${t}.node`,
      );
      const prebuiltLibNodeWithT = resolve(
        moduleDir,
        `../../libroxify_native-${t}.node`,
      );

      candidates.push(
        bundleLibNodeWithT,
        bundleNodeWithT,
        repoLibNodeWithT,
        repoNodeWithT,
        nodeModulesNodeWithT,
        prebuiltLibNodeWithT,
        prebuiltNodeWithT,
      );
    }

    candidates.push(
      bundleLibNode,
      bundleNode,
      repoLibNode,
      repoNode,
      targetNode,
      targetLibSo,
      targetSo,
      nodeModulesNode,
      prebuiltLibNode,
      prebuiltNode,
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
            return nodeAlias;
          } catch (e) {
            return c;
          }
        }
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
