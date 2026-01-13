import { createRequire } from 'module';
import { arch, platform } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const require = createRequire(import.meta.url);

function getNativePath(): string {
  const platformMap: Record<string, string> = {
    linux: 'x86_64-unknown-linux-gnu',
    darwin: arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin',
    win32: 'x86_64-pc-windows-msvc',
  };

  const extMap: Record<string, string> = {
    linux: 'so',
    darwin: 'dylib',
    win32: 'dll',
  };

  const currentPlatform = platform();
  const target = platformMap[currentPlatform];
  const ext = extMap[currentPlatform];

  if (!target || !ext) {
    throw new Error(`Unsupported platform: ${currentPlatform}`);
  }

  const prebuiltPath = join(__dirname, '../../libroxify_native.node');
  const targetPath = join(__dirname, `../../libroxify_native-${target}.${ext}`);

  try {
    return require.resolve(prebuiltPath);
  } catch {
    try {
      return require.resolve(targetPath);
    } catch {
      throw new Error(
        `Native module not found for ${currentPlatform}-${arch()}. ` +
          `Expected: ${prebuiltPath} or ${targetPath}`,
      );
    }
  }
}

export const native = require(getNativePath());
