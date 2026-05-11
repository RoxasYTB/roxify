const { execSync } = require('child_process');
const { existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync } = require('fs');
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
                  try { require('fs').chmodSync(dest, 0o755); } catch { }
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
                        try { require('fs').chmodSync(dest, 0o755); } catch { }
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

if (process.env.ROXIFY_ENABLE_RUST_CLI === '1') {
      ensureCliBinary();
}
ensureNativeLib();

// Cleanup: remove other platform .node artifacts to reduce disk usage after install
try {
      const triples = getTriples();
      if (triples && triples.length) {
            const files = readdirSync(root);
            for (const f of files) {
                  // match roxify_native-<triple>.node or libroxify_native-<triple>.node
                  const m = f.match(/^(lib)?roxify_native-(.+)\.node$/);
                  if (m) {
                        const fileTriple = m[2];
                        // keep if fileTriple is one of the allowed triples
                        if (!triples.includes(fileTriple)) {
                              try { unlinkSync(join(root, f)); console.log(`roxify: removed ${f}`); } catch (e) { }
                        }
                  }
            }
      }
} catch (e) { }

// Cleanup: remove CLI binaries for other platforms from dist/
try {
      const os = platform();
      const distFiles = existsSync(distDir) ? readdirSync(distDir) : [];
      for (const f of distFiles) {
            // Windows: keep roxify_native.exe, remove others
            if (os === 'win32') {
                  if (f === 'roxify_native.exe' || f === 'roxify_native') continue;
                  if (f.match(/^roxify_native/) || f === 'rox-macos-universal') {
                        try { unlinkSync(join(distDir, f)); console.log(`roxify: removed dist/${f}`); } catch (e) { }
                  }
            }
            // Linux: keep roxify_native, remove others
            else if (os === 'linux') {
                  if (f === 'roxify_native') continue;
                  if (f.match(/^roxify_native/) || f === 'rox-macos-universal') {
                        try { unlinkSync(join(distDir, f)); console.log(`roxify: removed dist/${f}`); } catch (e) { }
                  }
            }
            // macOS: keep rox-macos-universal (or roxify_native-macos-*), remove others
            else if (os === 'darwin') {
                  if (f === 'rox-macos-universal') continue;
                  if (f.match(/^roxify_native-macos-/)) continue;
                  if (f.match(/^roxify_native/)) {
                        try { unlinkSync(join(distDir, f)); console.log(`roxify: removed dist/${f}`); } catch (e) { }
                  }
            }
      }
} catch (e) { }
