import { copyFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import { arch, platform } from 'os';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Returns the Rust target triple(s) for the current OS + architecture.
 * Multiple triples are returned when there are alternative toolchains
 * (e.g. windows-msvc and windows-gnu).
 */
function getTargetTriples(): string[] {
  const os = platform();
  const cpu = arch();

  const map: Record<string, Record<string, string[]>> = {
    linux: {
      x64: ['x86_64-unknown-linux-gnu'],
      ia32: ['i686-unknown-linux-gnu'],
      arm64: ['aarch64-unknown-linux-gnu'],
      arm: ['armv7-unknown-linux-gnueabihf'],
    },
    win32: {
      x64: ['x86_64-pc-windows-msvc', 'x86_64-pc-windows-gnu'],
      ia32: ['i686-pc-windows-msvc', 'i686-pc-windows-gnu'],
      arm64: ['aarch64-pc-windows-msvc'],
    },
    darwin: {
      x64: ['x86_64-apple-darwin'],
      arm64: ['aarch64-apple-darwin'],
    },
  };

  const archMap = map[os];
  if (!archMap) throw new Error(`Unsupported OS: ${os}`);
  const triples = archMap[cpu];
  if (!triples) throw new Error(`Unsupported architecture: ${os}-${cpu}`);
  return triples;
}

function getNativeModule() {
  let moduleDir: string;
  let nativeRequire: NodeRequire;

  const esmFilename = fileURLToPath(import.meta.url);
  const esmDirname = dirname(esmFilename);

  if (typeof __dirname !== 'undefined') {
    moduleDir = __dirname;
    nativeRequire = require;
  } else {
    moduleDir = esmDirname;
    try {
      nativeRequire = require;
    } catch {
      nativeRequire = createRequire(esmFilename);
    }
  }

  function getNativePath(): string {
    const triples = getTargetTriples();

    // Walk up to find repository / package root
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

    // --- 1. Platform-specific candidates (checked FIRST) ---
    // These are the ONLY safe candidates — they match the current OS+arch.
    const candidates: string[] = [];

    for (const triple of triples) {
      const name = `roxify_native-${triple}.node`;
      const libName = `libroxify_native-${triple}.node`;

      candidates.push(
        // dist/ sibling (npm-installed package)
        resolve(moduleDir, '..', name),
        resolve(moduleDir, '..', libName),
        // package root
        resolve(root, name),
        resolve(root, libName),
        // node_modules/roxify/
        resolve(root, 'node_modules', 'roxify', name),
        resolve(root, 'node_modules', 'roxify', libName),
        // two levels up (global npm install)
        resolve(moduleDir, '..', '..', name),
        resolve(moduleDir, '..', '..', libName),
      );
    }

    // --- 2. Build output candidates (local dev) ---
    for (const triple of triples) {
      for (const profile of ['release', 'fastdev']) {
        // Unix: libroxify_native.so / .dylib → renamed to .node
        candidates.push(resolve(root, 'target', triple, profile, 'libroxify_native.so'));
        candidates.push(resolve(root, 'target', triple, profile, 'libroxify_native.dylib'));
        // Windows: roxify_native.dll
        candidates.push(resolve(root, 'target', triple, profile, 'roxify_native.dll'));
      }
      // Default (non-cross-compiled) output
      for (const profile of ['release', 'fastdev']) {
        candidates.push(resolve(root, 'target', profile, 'libroxify_native.so'));
        candidates.push(resolve(root, 'target', profile, 'libroxify_native.dylib'));
        candidates.push(resolve(root, 'target', profile, 'roxify_native.dll'));
        candidates.push(resolve(root, 'target', profile, 'roxify_native.node'));
      }
    }

    // --- 3. Generic fallback names ---
    // ONLY used when a platform-specific triple file also exists next to it,
    // or when we are on the SAME platform that built the generic file (dev mode).
    // In production (npm install), the platform-specific files MUST exist.
    // We do NOT blindly load roxify_native.node because it could be a Linux
    // binary loaded on Windows (or vice-versa), causing ERR_DLOPEN_FAILED.
    //
    // Generic names are ONLY safe in local dev (where you just built for your
    // own platform). We keep them but ONLY for target/release/ build outputs.
    // The root-level roxify_native.node is intentionally excluded.

    // Deduplicate
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const c of candidates) {
      if (!seen.has(c)) {
        seen.add(c);
        unique.push(c);
      }
    }

    for (const c of unique) {
      try {
        if (!existsSync(c)) continue;
        // .so/.dylib/.dll files need to be aliased as .node for require()
        if (c.endsWith('.so') || c.endsWith('.dylib') || c.endsWith('.dll')) {
          const nodeAlias = c.replace(/\.(so|dylib|dll)$/, '.node');
          try {
            if (!existsSync(nodeAlias)) {
              copyFileSync(c, nodeAlias);
            }
            return nodeAlias;
          } catch {
            return c;
          }
        }
        return c;
      } catch {}
    }

    throw new Error(
      `Native module not found for ${platform()}-${arch()} (triples: ${triples.join(', ')}). Searched ${unique.length} paths:\n${unique.join('\n')}`,
    );
  }

  return nativeRequire(getNativePath());
}

export const native = getNativeModule();
