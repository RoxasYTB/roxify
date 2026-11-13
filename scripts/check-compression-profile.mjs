import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function compiled(file) {
  const source = readFileSync(join(repo, 'src', file), 'utf8')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(join(repo, 'dist', file)).href));
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}
function load(code, modules, globals = {}) {
  const context = vm.createContext({
    exports: {}, Buffer, console, process, __dirname: join(repo, 'dist/utils'),
    require: name => Object.hasOwn(modules, name) ? modules[name] : require(name),
    ...globals,
  });
  vm.runInContext(code, context);
  return context;
}

const encoderCode = compiled('utils/encoder.ts');
const calls = [];
const nativeOutput = Buffer.from('native PNG');
const native = Object.fromEntries([
  'nativeEncodePngPartsWithProfile', 'nativeEncodePngParts',
  'nativeEncodePngWithNameAndFilelist', 'nativeEncodePngWithEncryptionNameAndFilelist',
].map(name => [name, (...args) => { calls.push({ name, args }); return nativeOutput; }]));
const encode = load(encoderCode, { './native.js': { native } }).exports.encodeBinaryToPng;
const input = Buffer.from('profile input');

await assert.rejects(() => encode(input, { maxCompression: 'false' }), /maxCompression must be a boolean/);
assert.equal(calls.length, 0, 'a JavaScript string must not enable the expensive native profile');
assert.equal(await encode(input), nativeOutput);
assert.equal(calls.at(-1).name, 'nativeEncodePngWithNameAndFilelist');
assert.equal(calls.at(-1).args[0], input);
assert.equal(calls.at(-1).args[1], 3);

await encode(input, { passphrase: 'test', encrypt: 'xor' });
assert.equal(calls.at(-1).name, 'nativeEncodePngWithEncryptionNameAndFilelist');
assert.equal(calls.at(-1).args[1], 3);

assert.equal(await encode(input, { maxCompression: true }), nativeOutput);
assert.equal(calls.at(-1).name, 'nativeEncodePngPartsWithProfile');
assert.equal(calls.at(-1).args[0][0], input);
assert.equal(calls.at(-1).args[1], 19);
assert.equal(calls.at(-1).args[6], true);

const largeParts = [Buffer.alloc(2 * 1024 * 1024, 1), Buffer.alloc(2 * 1024 * 1024, 2)];
await encode(largeParts);
assert.equal(calls.at(-1).name, 'nativeEncodePngParts');
assert.equal(calls.at(-1).args[0], largeParts);
await encode(largeParts, {
  maxCompression: true, compressionLevel: 9, passphrase: 'test', encrypt: 'xor',
  name: 'archive', includeFileList: true, fileList: [{ name: 'a.bin', size: 4 }],
});
const profiled = calls.at(-1);
assert.equal(profiled.args[0], largeParts);
assert.deepEqual(profiled.args.slice(1), [9, 'test', 'xor', 'archive', '[{"name":"a.bin","size":4}]', true]);

const tinyParts = Array(4000).fill(Buffer.alloc(1280, 7));
await encode(tinyParts, { maxCompression: true, compressionLevel: 22 });
assert.equal(calls.at(-1).args[0].length, 1);
assert.equal(calls.at(-1).args[0][0].length, 4000 * 1280);
await encode([], { maxCompression: true, compressionLevel: 1 });
assert.equal(calls.at(-1).args[0][0].length, 0);

const legacy = { ...native, nativeEncodePngPartsWithProfile: undefined };
const oldEncode = load(encoderCode, { './native.js': { native: legacy } }).exports.encodeBinaryToPng;
const count = calls.length;
await assert.rejects(() => oldEncode(input, { maxCompression: true }), /updated roxify native module/);
assert.equal(calls.length, count, 'unsupported profiles must not call a fast binding');
await oldEncode(input);
for (const level of [0, -1, 23, 1.5, NaN, Infinity]) {
  await assert.rejects(() => encode(input, { compressionLevel: level }), /integer from 1 to 22/);
  await assert.rejects(() => encode(input, { maxCompression: true, compressionLevel: level }), /integer from 1 to 22/);
}
console.log('PASS Node profile defaults, overrides, parts/copies, metadata, encryption arguments and old-native rejection');

const spawned = [];
const wrapper = load(compiled('utils/rust-cli-wrapper.ts'), {
  fs: { existsSync: () => true, accessSync() {}, constants: {} },
  child_process: {
    execSync() { throw new Error('Unexpected PATH search'); },
    spawn(_exe, args) {
      spawned.push(args);
      const proc = new EventEmitter();
      proc.stderr = new EventEmitter(); proc.stdout = new EventEmitter();
      queueMicrotask(() => proc.emit('close', 0, null));
      return proc;
    },
  },
}).exports;
await assert.rejects(() => wrapper.encodeWithRustCLI('input', 'output', undefined, undefined, undefined, undefined, undefined, undefined, { maxCompression: 'true' }), /maxCompression must be a boolean/);
assert.equal(spawned.length, 0, 'an invalid profile boolean must not launch the native CLI');
await wrapper.encodeWithRustCLI('input', 'output');
assert.deepEqual(Array.from(spawned.at(-1)), ['encode', '--level', '3', 'input', 'output']);
await wrapper.encodeWithRustCLI('input', 'output', undefined, undefined, undefined, undefined, undefined, undefined, { maxCompression: true });
assert.deepEqual(Array.from(spawned.at(-1)), ['encode', '--level', '19', '--max-compression', 'input', 'output']);
await wrapper.encodeWithRustCLI('input', 'output', 9, 'test', 'xor', 'name', 512, () => {}, { maxCompression: true });
assert.deepEqual(Array.from(spawned.at(-1)), ['encode', '--level', '9', '--max-compression', '--name', 'name', '--passphrase', 'test', '--encrypt', 'xor', '--ram-budget-mb', '512', 'input', 'output']);
await assert.rejects(() => wrapper.encodeWithRustCLI('input', 'output', 0), /integer from 1 to 22/);
console.log('PASS Rust CLI wrapper defaults, appended options and profile forwarding');

class Exit extends Error { constructor(code) { super(`exit ${code}`); this.code = code; } }
const cliCode = compiled('cli.ts').replace('main().catch(', 'globalThis.completion = main().catch(');
async function cli(args, { failRust = false, failJs = false, size = 5 } = {}) {
  const result = { rust: [], js: [], logs: [], stats: 0 };
  const fakeFs = {
    readdirSync: () => [], readFileSync: () => input, writeFileSync() {},
    statSync: () => { result.stats++; return { size, isDirectory: () => false }; },
  };
  const context = load(cliCode, {
    fs: fakeFs,
    module: { createRequire: () => () => ({ version: 'test' }) },
    './stub-progress.js': { SingleBar: class { start() {} update() {} stop() {} }, Presets: { shades_classic: {} } },
    './utils/rust-cli-wrapper.js': {
      isRustBinaryAvailable: () => true,
      encodeWithRustCLI: async (...args) => { result.rust.push(args); if (failRust) throw new Error('old Rust CLI'); },
    },
    './index.js': {
      encodeBinaryToPng: async (data, opts) => {
        result.js.push({ data, opts });
        if (failJs) throw new Error('Maximum compression requires an updated roxify native module');
        return nativeOutput;
      },
    },
    './pack.js': {},
  }, {
    process: { argv: ['node', 'cli', ...args], cwd: () => repo, exit: code => { throw new Exit(code); } },
    console: { log: (...args) => result.logs.push(args.join(' ')), error: (...args) => result.logs.push(args.join(' ')), warn: (...args) => result.logs.push(args.join(' ')) },
    setInterval: () => 1, clearInterval() {},
  });
  try { await context.completion; } catch (error) { if (!(error instanceof Exit)) throw error; result.exit = error.code; }
  return result;
}
const help = await cli(['--help']);
assert.match(help.logs.join('\n'), /--max-compression/);
assert.match(help.logs.join('\n'), /adaptively cap/);
for (const args of [
  ['encode', '--max-compression', 'in.bin', 'out.png'],
  ['encode', 'in.bin', 'out.png', '--max-compression'],
]) {
  const result = await cli(args);
  assert.equal(result.exit, undefined);
  assert.equal(result.rust[0][0], resolve(repo, 'in.bin'));
  assert.equal(result.rust[0][1], resolve(repo, 'out.png'));
  assert.equal(result.rust[0][2], 19);
  assert.equal(result.rust[0][8].maxCompression, true);
}
const custom = await cli(['encode', 'in.bin', 'out.png', '--max-compression', '--level', '9']);
assert.equal(custom.rust[0][2], 9);
const fast = await cli(['encode', 'in.bin', 'out.png']);
assert.equal(fast.rust[0][2], 3);
assert.equal(fast.rust[0][8].maxCompression, undefined);
for (const value of [undefined, 'NaN', '1.5', '0', '23', '-1']) {
  const args = ['encode', 'in.bin', '--level'];
  if (value !== undefined) args.push(value);
  const result = await cli(args);
  assert.equal(result.exit, 1);
  assert.match(result.logs.join('\n'), /Invalid --level/);
  assert.equal(result.stats, 0);
}
for (const args of [
  ['encode', 'in.bin', 'out.png', '--max-compression', '--force-ts'],
  ['encode', 'in.bin', 'out.png', '--max-compression'],
]) {
  const result = await cli(args, { failRust: true });
  assert.equal(result.exit, undefined);
  assert.equal(result.js[0].opts.maxCompression, true);
  assert.equal(result.js[0].opts.compressionLevel, 19);
}
const strictJs = await cli(['encode', 'in.bin', 'out.png', '--max-compression', '--level', '9', '--force-ts']);
assert.equal(strictJs.js[0].opts.compressionLevel, 9);
const large = await cli(['encode', 'in.bin', 'out.png', '--max-compression', '--force-ts'], { size: 1024 * 1024 * 1024 + 1 });
assert.equal(large.rust[0][2], 19);
assert.equal(large.rust[0][8].maxCompression, true);
const unavailable = await cli(['encode', 'in.bin', 'out.png', '--max-compression'], { failRust: true, failJs: true });
assert.equal(unavailable.exit, 1);
assert.match(unavailable.logs.join('\n'), /updated roxify native module/);
console.log('PASS CLI help/boolean parsing, level validation, all encode routes and no silent profile downgrade');
