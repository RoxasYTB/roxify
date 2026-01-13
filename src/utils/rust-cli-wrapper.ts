import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

let moduleDir: string;
try {
  // CJS bundlers may provide __dirname; prefer it when available
  if (typeof __dirname !== 'undefined') {
    // @ts-ignore
    moduleDir = __dirname;
  } else {
    // @ts-ignore - import.meta.url exists in ESM
    const __filename = fileURLToPath(import.meta.url);
    moduleDir = dirname(__filename);
  }
} catch {
  moduleDir = process.cwd();
}

function findRustBinary(): string | null {
  const candidates = [] as string[];

  const binNames =
    process.platform === 'win32'
      ? ['roxify-cli.exe', 'roxify_cli.exe', 'roxify_native.exe']
      : ['roxify-cli', 'roxify_cli', 'roxify_native'];

  const baseDir = typeof moduleDir !== 'undefined' ? moduleDir : process.cwd();

  // Possible locations relative to this file (works in repo and in packaged dist)
  const relativeDirs = [
    join(baseDir, '..', '..', 'target', 'release'),
    join(baseDir, '..', '..', 'dist'),
    join(baseDir, '..'),
    join(baseDir, '..', '..'),
    join(baseDir, '..', 'target', 'release'),
  ];

  for (const dir of relativeDirs) {
    for (const name of binNames) {
      candidates.push(join(dir, name));
    }
  }

  // Walk up parents to find a workspace-level target/release (repo root may contain target)
  try {
    let cur = baseDir;
    for (let i = 0; i < 8; i++) {
      for (const name of binNames) {
        candidates.push(
          join(
            cur,
            '..',
            '..',
            '..',
            '..',
            '..',
            '..',
            '..',
            'target',
            'release',
            name,
          ),
        );
        candidates.push(
          join(cur, '..', '..', '..', '..', '..', 'target', 'release', name),
        );
        candidates.push(join(cur, '..', '..', '..', 'target', 'release', name));
        candidates.push(join(cur, '..', '..', 'target', 'release', name));
        candidates.push(join(cur, '..', 'target', 'release', name));
        candidates.push(join(cur, 'target', 'release', name));
      }
      const parent = join(cur, '..');
      if (parent === cur) break;
      cur = parent;
    }
  } catch (e) {}

  // Common global paths (last resort)
  if (process.platform !== 'win32') {
    candidates.push('/usr/local/bin/roxify_native');
    candidates.push('/usr/bin/roxify_native');
  }

  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        // eslint-disable-next-line no-console
        console.log(`Found Rust binary candidate: ${p}`);
        return p;
      }
    } catch (e) {}
  }

  // Search in PATH for common binary names
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const { execSync } = require('child_process');
    for (const name of binNames) {
      try {
        const out = execSync(`${which} ${name}`, { encoding: 'utf-8' })
          .split('\n')[0]
          .trim();
        if (out && existsSync(out)) {
          // eslint-disable-next-line no-console
          console.debug(`Found Rust binary in PATH: ${out}`);
          return out;
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {}

  return null;
}

export function isRustBinaryAvailable(): boolean {
  return findRustBinary() !== null;
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

  if (!cliPath) {
    throw new Error('Rust CLI binary not found. Run: cargo build --release');
  }

  return new Promise((resolve, reject) => {
    const baseArgs = ['encode', '--level', String(compressionLevel)];

    const addNameArgs = (arr: string[]) => {
      if (name) {
        arr.push('--name', name);
      }
    };

    const addPassArgs = (arr: string[]) => {
      if (passphrase) {
        arr.push('--passphrase', passphrase);
        arr.push('--encrypt', encryptType);
      }
    };

    const args = [...baseArgs];
    addNameArgs(args);
    addPassArgs(args);
    args.push(inputPath, outputPath);

    const spawnAndWait = (argsToUse: string[]) => {
      return new Promise<{ code: number | null; stderr: string }>(
        (res, rej) => {
          const proc = spawn(cliPath, argsToUse);
          let stderr = '';
          proc.stderr.on('data', (data) => {
            stderr += data.toString();
          });
          proc.on('error', (err) => rej(err));
          proc.on('close', (code) => res({ code, stderr }));
        },
      );
    };

    (async () => {
      try {
        const debugMsg = `Rust CLI: ${cliPath} ${args.join(' ')}`;
        // eslint-disable-next-line no-console
        console.log(debugMsg);
        let result = await spawnAndWait(args);
        if (result.code === 0) return resolve();

        // If the error mentions an unexpected '--name' arg (older binary), retry without name
        if (
          name &&
          result.stderr &&
          (/unexpected argument.*--name/.test(result.stderr) ||
            /unexpected argument .*'--name'/.test(result.stderr) ||
            result.stderr.includes("'--name'"))
        ) {
          const argsNoName = [...baseArgs];
          addPassArgs(argsNoName);
          argsNoName.push(inputPath, outputPath);
          // eslint-disable-next-line no-console
          console.log('Rust CLI rejected --name; retrying without --name');
          const retryDebug = `Retrying Rust CLI: ${cliPath} ${argsNoName.join(
            ' ',
          )}`;
          // eslint-disable-next-line no-console
          console.log(retryDebug);
          result = await spawnAndWait(argsNoName);
          // eslint-disable-next-line no-console
          console.log(`Rust retry exited with code ${result.code}`);
          if (result.code === 0) return resolve();
        }

        reject(
          new Error(
            `Rust CLI exited with code ${result.code}: ${result.stderr}`,
          ),
        );
      } catch (err: any) {
        reject(new Error(`Failed to spawn Rust CLI: ${err.message || err}`));
      }
    })();
  });
}
