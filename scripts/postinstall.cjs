const { execSync } = require('child_process');
const { existsSync, copyFileSync, mkdirSync, readdirSync, unlinkSync, chmodSync } = require('fs');
const { join } = require('path');
const { platform, arch } = require('os');

const root = join(__dirname, '..');
const distDir = join(root, 'dist');

// Try to import download helper
try {
      var { downloadBinary, downloadNativeLib } = require('./download-binary.cjs');
} catch (e) {
      console.log('roxify: Download helper not available, will use local build only');
      var downloadBinary = null;
      var downloadNativeLib = null;
}

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
            win32: { x64: ['x86_64-pc-windows-msvc'], arm64: ['aarch64-pc-windows-msvc'] },
            darwin: { x64: ['x86_64-apple-darwin'], arm64: ['aarch64-apple-darwin'] },
      };
      return (map[os] && map[os][cpu]) || [];
}

function getBinaryName() {
      return platform() === 'win32' ? 'roxify_native.exe' : 'roxify_native';
}

function getMacosBinaryName() {
      return 'rox-macos-universal';
}

function buildBinaryLocally() {
      if (!hasCargo()) {
            console.log('roxify: Cargo not found, will try to download prebuilt binary');
            return false;
      }
      console.log('roxify: Building native CLI binary locally...');
      try {
            execSync('cargo build --release --bin roxify_native', { cwd: root, stdio: 'inherit', timeout: 600000 });
            return true;
      } catch (e) {
            console.log('roxify: Local build failed, will try to download prebuilt binary');
            return false;
      }
}

async function ensureCliBinary() {
      if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });

      const binaryName = platform() === 'darwin' ? getMacosBinaryName() : getBinaryName();
      const dest = join(distDir, binaryName);

      if (existsSync(dest)) {
            console.log(`roxify: CLI binary already exists at ${dest}`);
            return true;
      }

      // Check if built locally exists
      const localBuilt = join(root, 'target', 'release', getBinaryName());
      if (existsSync(localBuilt)) {
            copyFileSync(localBuilt, dest);
            if (platform() !== 'win32') {
                  try { chmodSync(dest, 0o755); } catch { }
            }
            console.log(`roxify: CLI binary copied from local build`);
            return true;
      }

      if (process.env.ROXIFY_SKIP_BUILD === '1') return false;

      // PRIMARY: Try download from GitHub releases (fast, no compilation)
      if (downloadBinary && !process.env.ROXIFY_FORCE_LOCAL_BUILD) {
            console.log(`roxify: Attempting to download prebuilt binary from GitHub...`);
            const downloaded = await downloadBinary();
            if (downloaded) {
                  console.log(`roxify: Successfully downloaded prebuilt binary`);
                  return true;
            }
            console.log(`roxify: Download failed, will try local build...`);
      }

      // FALLBACK: Try local build (requires Cargo)
      if (buildBinaryLocally()) {
            if (existsSync(localBuilt)) {
                  copyFileSync(localBuilt, dest);
                  if (platform() !== 'win32') {
                        try { chmodSync(dest, 0o755); } catch { }
                  }
                  console.log(`roxify: CLI binary built locally`);
                  return true;
            }
      }

      console.log('roxify: No native binary available, TypeScript fallback will be used');
      return false;
}

async function ensureNativeLib() {
      const triples = getTriples();
      if (!triples.length) return;

      const triple = triples[0];
      const dest = join(root, `roxify_native-${triple}.node`);

      if (existsSync(dest)) return;

      // Check if built locally
      const ext = platform() === 'win32' ? 'dll' : (platform() === 'darwin' ? 'dylib' : 'so');
      const prefix = platform() === 'win32' ? '' : 'lib';
      const localBuilt = join(root, 'target', 'release', `${prefix}roxify_native.${ext}`);

      if (existsSync(localBuilt)) {
            copyFileSync(localBuilt, dest);
            console.log(`roxify: Native lib copied from local build → ${dest}`);
            return;
      }

      if (process.env.ROXIFY_SKIP_BUILD === '1') return;

      // PRIMARY: Try download from GitHub releases
      if (downloadNativeLib && !process.env.ROXIFY_FORCE_LOCAL_BUILD) {
            console.log(`roxify: Attempting to download native lib from GitHub...`);
            const downloaded = await downloadNativeLib();
            if (downloaded) {
                  console.log(`roxify: Successfully downloaded native lib`);
                  return;
            }
            console.log(`roxify: Native lib download failed, will try local build...`);
      }

      // FALLBACK: Try build locally
      if (hasCargo()) {
            console.log(`roxify: Building native lib locally...`);
            try {
                  execSync('cargo build --release --lib', { cwd: root, stdio: 'inherit', timeout: 600000 });
                  if (existsSync(localBuilt)) {
                        copyFileSync(localBuilt, dest);
                        console.log(`roxify: Native lib built locally → ${dest}`);
                  }
            } catch {
                  console.log('roxify: Native lib build failed, TypeScript fallback will be used');
            }
      }
}

// Always ensure CLI binary is available (download first, build as fallback)
(async () => {
      await ensureCliBinary();
      await ensureNativeLib();

      // Summary
      console.log('');
      console.log('roxify: Post-install complete');
      console.log(`roxify: Platform: ${platform()}/${arch()}`);
      if (!existsSync(join(distDir, platform() === 'darwin' ? getMacosBinaryName() : getBinaryName()))) {
            console.log('roxify: WARNING: No native CLI binary available - will use TypeScript fallback');
      }
})();

// Cleanup: remove ALL other platform .node artifacts
try {
      const triples = getTriples();
      const files = readdirSync(root);
      for (const f of files) {
            const m = f.match(/^roxify_native-(.+)\.node$/);
            if (m) {
                  const fileTriple = m[1];
                  if (!triples.includes(fileTriple)) {
                        try {
                              unlinkSync(join(root, f));
                              console.log(`roxify: removed unused native lib ${f}`);
                        } catch (e) { }
                  }
            }
      }
} catch (e) { }

// Cleanup: remove ALL other platform CLI binaries from dist/
try {
      const os = platform();
      const distFiles = existsSync(distDir) ? readdirSync(distDir) : [];
      const keepName = os === 'darwin' ? getMacosBinaryName() : getBinaryName();

      for (const f of distFiles) {
            // Skip if it's the correct binary for this platform
            if (f === keepName) continue;

            // Remove any roxify_native binary
            if (f.match(/^roxify_native/) || f === 'rox-macos-universal') {
                  try {
                        unlinkSync(join(distDir, f));
                        console.log(`roxify: removed unused binary dist/${f}`);
                  } catch (e) { }
            }
      }
} catch (e) { }
