const { execSync } = require('child_process');
const { existsSync, copyFileSync, mkdirSync } = require('fs');
const { join, dirname } = require('path');

const root = join(__dirname, '..');
const distDir = join(root, 'dist');

function hasCargo() {
      try {
            execSync('cargo --version', { stdio: 'ignore', timeout: 5000 });
            return true;
      } catch { return false; }
}

function getBinaryName() {
      return process.platform === 'win32' ? 'roxify_native.exe' : 'roxify_native';
}

function findExistingBinary() {
      const name = getBinaryName();
      const candidates = [
            join(distDir, name),
            join(root, 'target', 'release', name),
      ];

      if (process.platform === 'win32') {
            candidates.push(join(root, 'target', 'x86_64-pc-windows-gnu', 'release', name));
            candidates.push(join(root, 'target', 'x86_64-pc-windows-msvc', 'release', name));
      } else if (process.platform === 'linux') {
            candidates.push(join(root, 'target', 'x86_64-unknown-linux-gnu', 'release', name));
      } else if (process.platform === 'darwin') {
            candidates.push(join(root, 'target', 'x86_64-apple-darwin', 'release', name));
            candidates.push(join(root, 'target', 'aarch64-apple-darwin', 'release', name));
      }

      for (const c of candidates) {
            if (existsSync(c)) return c;
      }
      return null;
}

function buildBinary() {
      if (!hasCargo()) {
            console.log('roxify: Cargo not found, skipping native binary build (TypeScript fallback will be used)');
            return false;
      }

      console.log('roxify: Building native CLI binary with Cargo...');
      try {
            execSync('cargo build --release --bin roxify_native', {
                  cwd: root,
                  stdio: 'inherit',
                  timeout: 600000,
            });
            return true;
      } catch (e) {
            console.log('roxify: Native build failed, TypeScript fallback will be used');
            return false;
      }
}

function run() {
      if (!existsSync(distDir)) {
            mkdirSync(distDir, { recursive: true });
      }

      const dest = join(distDir, getBinaryName());
      if (existsSync(dest)) {
            return;
      }

      const existing = findExistingBinary();
      if (existing && existing !== dest) {
            copyFileSync(existing, dest);
            if (process.platform !== 'win32') {
                  try { require('fs').chmodSync(dest, 0o755); } catch { }
            }
            console.log(`roxify: Copied native binary from ${existing}`);
            return;
      }

      if (existing) return;

      if (process.env.ROXIFY_SKIP_BUILD === '1') {
            console.log('roxify: ROXIFY_SKIP_BUILD=1, skipping native build');
            return;
      }

      if (buildBinary()) {
            const built = join(root, 'target', 'release', getBinaryName());
            if (existsSync(built)) {
                  copyFileSync(built, dest);
                  if (process.platform !== 'win32') {
                        try { require('fs').chmodSync(dest, 0o755); } catch { }
                  }
                  console.log('roxify: Native binary built and copied to dist/');
            }
      }
}

run();
