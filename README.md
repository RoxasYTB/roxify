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

## Node.js

```typescript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';

const png = await encodeBinaryToPng(buf, { name: 'file.bin' });
const { buf: decoded, meta } = await decodePngToBinary(png);
```

## Build

```bash
npm install
npm run build:native
npm run build
```
