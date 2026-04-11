import { execSync, spawn } from 'child_process';
import { accessSync, constants, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

let moduleDir: string;
if (typeof __dirname !== 'undefined') {
  moduleDir = __dirname;
} else {
  try {
    moduleDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    moduleDir = process.cwd();
  }
}

function canExecute(p: string): boolean {
  if (!existsSync(p)) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findRustBinary(): string | null {
  const platformBins: Record<string, string[]> = {
    win32: ['roxify_native.exe', 'roxify-cli.exe', 'roxify_cli.exe'],
    darwin: ['rox-macos-universal', 'roxify_native-macos-arm64', 'roxify_native-macos-x64', 'roxify_native', 'roxify-cli', 'roxify_cli'],
    linux: ['roxify_native', 'roxify-cli', 'roxify_cli'],
  };
  const binNames = platformBins[process.platform] || platformBins.linux;

  const baseDir = moduleDir;

  for (const name of binNames) {
    const sameDirPath = join(baseDir, name);
    if (canExecute(sameDirPath)) return sameDirPath;
    const parentPath = join(baseDir, '..', name);
    if (canExecute(parentPath)) return parentPath;
    const parentDistPath = join(baseDir, '..', 'dist', name);
    if (canExecute(parentDistPath)) return parentDistPath;
  }

  if ((process as any).pkg) {
    const snapshotPaths = [
      join(baseDir, '..', '..', 'target', 'release'),
      join(baseDir, '..', 'target', 'release'),
      join(baseDir, 'target', 'release'),
    ];

    for (const basePath of snapshotPaths) {
      for (const name of binNames) {
        const binPath = join(basePath, name);
        if (canExecute(binPath)) return binPath;
      }
    }

    try {
      const execDir = require('path').dirname(process.execPath || '');
      if (execDir) {
        const execCandidates = [
          join(execDir, 'tools', 'roxify', 'dist'),
          join(execDir, 'tools', 'roxify'),
          join(execDir, '..', 'tools', 'roxify', 'dist'),
          join(execDir, '..', 'tools', 'roxify'),
        ];
        for (const c of execCandidates) {
          for (const name of binNames) {
            const p = join(c, name);
            if (canExecute(p)) return p;
          }
        }
      }
    } catch { }
  }

  try {
    let paths: string[] = [];
    if (process.platform === 'win32') {
      try {
        const out = execSync('where rox', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (out) paths = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      } catch { }
    } else {
      try {
        const out = execSync('which rox', { encoding: 'utf-8', timeout: 5000 }).trim();
        if (out) paths = [out.trim()];
      } catch { }
    }

    for (const p of paths) {
      try {
        const d = dirname(p);
        const candidates = [
          d,
          join(d, 'dist'),
          join(d, '..', 'dist'),
          join(d, '..'),
          join(d, 'node_modules', 'roxify', 'dist'),
        ];
        for (const c of candidates) {
          for (const name of binNames) {
            const candidate = join(c, name);
            if (canExecute(candidate)) return candidate;
          }
        }
      } catch { }
    }
  } catch { }

  for (const name of binNames) {
    const parentParentLocal = join(baseDir, '..', '..', name);
    if (canExecute(parentParentLocal)) return parentParentLocal;
    const nodeModulesPath = join(baseDir, '..', '..', '..', '..', name);
    if (canExecute(nodeModulesPath)) return nodeModulesPath;
  }

  const targetRelease = join(baseDir, '..', '..', 'target', 'release');
  for (const name of binNames) {
    const targetPath = join(targetRelease, name);
    if (canExecute(targetPath)) return targetPath;
  }

  return null;
}

export { findRustBinary };

export function isRustBinaryAvailable(): boolean {
  return findRustBinary() !== null;
}

import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';

function extractToTemp(pathToRead: string): string {
  const buf = readFileSync(pathToRead);
  const tmp = mkdtempSync(join(tmpdir(), 'roxify-'));
  const dest = join(tmp, pathToRead.replace(/.*[\\/]/, ''));
  writeFileSync(dest, buf);
  try {
    chmodSync(dest, 0o755);
  } catch (e) { }
  return dest;
}

function spawnRustCLI(
  args: string[],
  options?: { collectStdout?: boolean },
): Promise<string> {
  const cliPath = findRustBinary();
  if (!cliPath) throw new Error('Rust CLI binary not found');

  return new Promise((resolve, reject) => {
    let triedExtract = false;
    let tempExe: string | undefined;
    let stdout = '';

    const runSpawn = (exePath: string) => {
      let proc;
      const stdio: any = options?.collectStdout
        ? ['pipe', 'pipe', 'inherit']
        : 'inherit';
      try {
        proc = spawn(exePath, args, { stdio });
      } catch (err: any) {
        if (!triedExtract) {
          triedExtract = true;
          try { tempExe = extractToTemp(cliPath); } catch (ex) { return reject(ex); }
          return runSpawn(tempExe);
        }
        return reject(err);
      }

      if (options?.collectStdout && proc.stdout) {
        proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      }

      proc.on('error', (err: any) => {
        if (!triedExtract) {
          triedExtract = true;
          try { tempExe = extractToTemp(cliPath); } catch (ex) { return reject(ex); }
          return runSpawn(tempExe);
        }
        reject(err);
      });

      proc.on('close', (code, signal) => {
        if (tempExe) { try { unlinkSync(tempExe); } catch (e) { } }
        if (code === 0 || (code === null && signal === null)) resolve(stdout);
        else reject(new Error(`Rust CLI exited with status ${code ?? signal}`));
      });
    };

    runSpawn(cliPath);
  });
}

export async function encodeWithRustCLI(
  inputPath: string,
  outputPath: string,
  compressionLevel = 3,
  passphrase?: string,
  encryptType: 'aes' | 'xor' = 'aes',
  name?: string,
): Promise<void> {
  const cliPath = findRustBinary();
  if (!cliPath) throw new Error('Rust CLI binary not found');

  const args = ['encode', '--level', String(compressionLevel)];

  if (name) {
    try {
      const helpOut = execSync(`"${cliPath}" --help`, { encoding: 'utf8', timeout: 2000 });
      if (helpOut && helpOut.includes('--name')) args.push('--name', name);
    } catch (e) { }
  }

  if (passphrase) {
    args.push('--passphrase', passphrase);
    args.push('--encrypt', encryptType);
  }

  args.push(inputPath, outputPath);
  await spawnRustCLI(args);
}

export async function decodeWithRustCLI(
  inputPath: string,
  outputPath: string,
  passphrase?: string,
  files?: string[],
  dict?: string,
): Promise<void> {
  const args = ['decompress', inputPath, outputPath];

  if (passphrase) args.push('--passphrase', passphrase);
  if (files && files.length > 0) args.push('--files', JSON.stringify(files));
  if (dict) args.push('--dict', dict);

  await spawnRustCLI(args);
}

export async function listWithRustCLI(inputPath: string): Promise<string> {
  return spawnRustCLI(['list', inputPath], { collectStdout: true });
}

export async function havepassphraseWithRustCLI(inputPath: string): Promise<string> {
  return spawnRustCLI(['havepassphrase', inputPath], { collectStdout: true });
}
