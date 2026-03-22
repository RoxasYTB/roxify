const { execSync } = require('child_process');
const { existsSync, copyFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const { platform, arch } = require('os');

const root = join(__dirname, '..');
const distDir = join(root, 'dist');

function hasCargo() {
      try {
            execSync('cargo --version', { stdio: 'ignore', timeout: 5000 });
            return true;
      } catch { return false; }
}

function getTriples() {
      const os = platform();
      const cpu = arch();
      const map = {
            linux: { x64: ['x86_64-unknown-linux-gnu'], arm64: ['aarch64-unknown-linux-gnu'] },
            win32: { x64: ['x86_64-pc-windows-msvc', 'x86_64-pc-windows-gnu'], arm64: ['aarch64-pc-windows-msvc'] },
            darwin: { x64: ['x86_64-apple-darwin'], arm64: ['aarch64-apple-darwin'] },
      };
      return (map[os] && map[os][cpu]) || [];
}

function getLibExt() {
      if (platform() === 'win32') return 'dll';
      if (platform() === 'darwin') return 'dylib';
      return 'so';
}

function getBinaryName() {
      return platform() === 'win32' ? 'roxify_native.exe' : 'roxify_native';
}

function findExistingBinary() {
      const name = getBinaryName();
      const triples = getTriples();
      const candidates = [join(distDir, name), join(root, 'target', 'release', name)];
      for (const t of triples) {
            candidates.push(join(root, 'target', t, 'release', name));
      }
      for (const c of candidates) {
            if (existsSync(c)) return c;
      }
      return null;
}

function findExistingNativeLib() {
      const triples = getTriples();
      const ext = getLibExt();
      const prefix = platform() === 'win32' ? '' : 'lib';
      for (const t of triples) {
            const specific = join(root, `roxify_native-${t}.node`);
            if (existsSync(specific)) return { path: specific, triple: t };
      }
      for (const t of triples) {
            for (const profile of ['release', 'fastdev']) {
                  const paths = [
                        join(root, 'target', t, profile, `${prefix}roxify_native.${ext}`),
                        join(root, 'target', profile, `${prefix}roxify_native.${ext}`),
                  ];
                  for (const p of paths) {
                        if (existsSync(p)) return { path: p, triple: t };
                  }
            }
      }
      return null;
}

function buildNative(target) {
      if (!hasCargo()) return false;
      const args = target ? ` --target ${target}` : '';
      console.log(`roxify: Building native lib${args}...`);
      try {
            execSync(`cargo build --release --lib${args}`, { cwd: root, stdio: 'inherit', timeout: 600000 });
            return true;
      } catch {
            console.log('roxify: Native lib build failed');
            return false;
      }
}

function buildBinary() {
      if (!hasCargo()) {
            console.log('roxify: Cargo not found, skipping native build (TypeScript fallback will be used)');
            return false;
      }
      console.log('roxify: Building native CLI binary...');
      try {
            execSync('cargo build --release --bin roxify_native', { cwd: root, stdio: 'inherit', timeout: 600000 });
            return true;
      } catch {
            console.log('roxify: Native build failed, TypeScript fallback will be used');
            return false;
      }
}

function ensureCliBinary() {
      if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
      const dest = join(distDir, getBinaryName());
      if (existsSync(dest)) return;

      const existing = findExistingBinary();
      if (existing && existing !== dest) {
            copyFileSync(existing, dest);
            if (platform() !== 'win32') {
                  try { require('fs').chmodSync(dest, 0o755); } catch {}
            }
            console.log(`roxify: Copied CLI binary from ${existing}`);
            return;
      }
      if (existing) return;
      if (process.env.ROXIFY_SKIP_BUILD === '1') return;

      if (buildBinary()) {
            const built = join(root, 'target', 'release', getBinaryName());
            if (existsSync(built)) {
                  copyFileSync(built, dest);
                  if (platform() !== 'win32') {
                        try { require('fs').chmodSync(dest, 0o755); } catch {}
                  }
                  console.log('roxify: CLI binary built and copied to dist/');
            }
      }
}

function ensureNativeLib() {
      const triples = getTriples();
      if (!triples.length) return;

      for (const t of triples) {
            if (existsSync(join(root, `roxify_native-${t}.node`))) return;
      }

      const found = findExistingNativeLib();
      if (found) {
            const dest = join(root, `roxify_native-${found.triple}.node`);
            copyFileSync(found.path, dest);
            console.log(`roxify: Copied native lib → ${dest}`);
            return;
      }

      if (process.env.ROXIFY_SKIP_BUILD === '1') return;

      const triple = triples[0];
      if (buildNative(null)) {
            const ext = getLibExt();
            const prefix = platform() === 'win32' ? '' : 'lib';
            const built = join(root, 'target', 'release', `${prefix}roxify_native.${ext}`);
            if (existsSync(built)) {
                  const dest = join(root, `roxify_native-${triple}.node`);
                  copyFileSync(built, dest);
                  console.log(`roxify: Native lib built → ${dest}`);
            }
      }
}

ensureCliBinary();
ensureNativeLib();
