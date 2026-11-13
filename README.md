# roxify

> I don't even know why I'm writing this readme. Nobody reads it, nobody cares, they'll ask an AI to summarize it anyway. I wont bother to detail my project, because it will be used by 3 people. Use an AI to analyse the code, since the users don't want to get technical détails.

## Benchmark

| | Size | Time | Throughput |
|---|---|---|---|
| ZIP | 1.9 GB | 1m59s | 29 MiB/s |
| **rox encode** | **1.3 GB** | **0m55s** | **62 MiB/s** |

Machine: ~10 year old PC (i7-6700K / 8 cores), 3.3 GB source code on ext4.

## CLI

```bash
npx rox encode <input> [output.png]
npx rox decode <input.png> [output]
```

For a higher compression ratio, opt into the slower profile:

```bash
npx rox encode <input> [output.png] --max-compression
npx rox encode <input> [output.png] --max-compression --level 9
```

The default fast profile keeps its adaptive level caps. `--max-compression` uses
level 19 by default and honors `--level 1` through `--level 22` without those caps.
It can take substantially longer and use more RAM; a higher level does not
guarantee a smaller result for every input. The archive format and decoder stay
compatible. Level 9 is an alternative when level 19 takes too long.

## Node.js

```typescript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';

const png = await encodeBinaryToPng(buf, { name: 'file.bin' });
const { buf: decoded, meta } = await decodePngToBinary(png);

const smaller = await encodeBinaryToPng(buf, {
  name: 'file.bin',
  maxCompression: true,
  compressionLevel: 9, // Omit for level 19; valid levels are 1-22.
});
```

The size-focused Node API requires the matching native module. An older native
module produces an explicit update/rebuild error instead of silently using the
fast profile.

## Build

```bash
npm install
npm run build:native
npm run build
```
