import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';

let moduleDir: string;
if (typeof __dirname !== 'undefined') {
  moduleDir = __dirname;
} else {
  moduleDir = process.cwd();
}

function findRustBinary(): string | null {
  const binNames =
    process.platform === 'win32'
      ? ['roxify_native.exe', 'roxify-cli.exe', 'roxify_cli.exe']
      : ['roxify_native', 'roxify-cli', 'roxify_cli'];

  const baseDir = typeof moduleDir !== 'undefined' ? moduleDir : process.cwd();

  if ((process as any).pkg) {
    const snapshotPaths = [
      join(baseDir, '..', '..', 'target', 'release'),
      join(baseDir, '..', 'target', 'release'),
      join(baseDir, 'target', 'release'),
    ];

    for (const basePath of snapshotPaths) {
      for (const name of binNames) {
        const binPath = join(basePath, name);
        if (existsSync(binPath)) {
          return binPath;
        }
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
          join(execDir, 'tools', 'roxify', 'roxify_native.exe'),
        ];
        for (const c of execCandidates) {
          for (const name of binNames) {
            const p = c.endsWith(name) ? c : join(c, name);
            if (existsSync(p)) {
              return p;
            }
          }
        }
      }
    } catch (e) {}
  }

  try {
    let paths: string[] = [];
    if (process.platform === 'win32') {
      try {
        const out = execSync('where rox', { encoding: 'utf-8' }).trim();
        if (out)
          paths = out
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
      } catch (e) {}
    } else {
      try {
        const out = execSync('which rox', { encoding: 'utf-8' }).trim();
        if (out) paths = [out.trim()];
      } catch (e) {}
    }

    for (const p of paths) {
      try {
        const d = dirname(p);
        const candidates = [
          d,
          join(d, 'dist'),
          join(d, '..', 'dist'),
          join(d, '..'),
        ];
        for (const c of candidates) {
          for (const name of binNames) {
            const candidate = join(c, name);
            if (existsSync(candidate)) {
              return candidate;
            }
          }
        }
      } catch (e) {}
    }
  } catch (e) {}

  for (const name of binNames) {
    const local = join(baseDir, name);
    if (existsSync(local)) {
      return local;
    }
    const parentLocal = join(baseDir, '..', name);
    if (existsSync(parentLocal)) {
      return parentLocal;
    }
    const parentParentLocal = join(baseDir, '..', '..', name);
    if (existsSync(parentParentLocal)) {
      return parentParentLocal;
    }
    const nodeModulesPath = join(baseDir, '..', '..', '..', '..', name);
    if (existsSync(nodeModulesPath)) {
      return nodeModulesPath;
    }
  }

  const targetRelease = join(baseDir, '..', '..', 'target', 'release');
  for (const name of binNames) {
    const targetPath = join(targetRelease, name);
    if (existsSync(targetPath)) {
      return targetPath;
    }
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

export async function encodeWithRustCLI(
  inputPath: string,
  outputPath: string,
  compressionLevel = 3,
  passphrase?: string,
  encryptType: 'aes' | 'xor' = 'aes',
  name?: string,
): Promise<void> {
  const cliPath = findRustBinary();

  if (!cliPath) {
    throw new Error('Rust CLI binary not found');
  }

  function extractToTemp(pathToRead: string): string {
    const buf = readFileSync(pathToRead);
    const tmp = mkdtempSync(join(tmpdir(), 'roxify-'));
    const dest = join(tmp, pathToRead.replace(/.*[\\/]/, ''));
    writeFileSync(dest, buf);
    try {
      chmodSync(dest, 0o755);
    } catch (e) {}
    return dest;
  }

  return new Promise((resolve, reject) => {
    const args = ['encode', '--level', String(compressionLevel)];

    let supportsName = false;
    if (name) {
      try {
        const helpOut = execSync(`"${cliPath}" --help`, {
          encoding: 'utf8',
          timeout: 2000,
        });
        if (helpOut && helpOut.includes('--name')) supportsName = true;
      } catch (e) {
        supportsName = false;
      }
      if (supportsName) {
        args.push('--name', name);
      }
    }

    if (passphrase) {
      args.push('--passphrase', passphrase);
      args.push('--encrypt', encryptType);
    }

    args.push(inputPath, outputPath);

    let triedExtract = false;
    let tempExe: string | undefined;

    const runSpawn = (exePath: string) => {
      let proc;
      try {
        proc = spawn(exePath, args, { stdio: 'inherit' });
      } catch (err: any) {
        if (!triedExtract) {
          triedExtract = true;
          try {
            tempExe = extractToTemp(cliPath);
          } catch (ex) {
            return reject(ex);
          }
          return runSpawn(tempExe);
        }
        return reject(err);
      }

      proc.on('error', (err: any) => {
        if (!triedExtract) {
          triedExtract = true;
          try {
            tempExe = extractToTemp(cliPath);
          } catch (ex) {
            return reject(ex);
          }
          return runSpawn(tempExe);
        }
        reject(err);
      });

      proc.on('close', (code) => {
        if (tempExe) {
          try {
            unlinkSync(tempExe);
          } catch (e) {}
        }
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Rust encoder exited with status ${code}`));
        }
      });
    };

    runSpawn(cliPath);
  });
}
