# RoxCompressor JavaScript SDK Documentation

Complete API documentation for using RoxCompressor programmatically.

## Table of Contents

1. [Installation](#installation)
2. [Quick Start](#quick-start)
3. [API Reference](#api-reference)
4. [Examples](#examples)
5. [Performance Guide](#performance-guide)
6. [Error Handling](#error-handling)
7. [TypeScript Support](#typescript-support)

## Installation

```bash
npm install roxify
```

Or use directly in browser (ESM):

```html
<script type="module">
  import {
    encodeBinaryToPng,
    decodePngToBinary,
  } from 'https://unpkg.com/roxify/dist/index.js';
</script>
```

## Quick Start

### Node.js

```javascript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';
import { readFileSync, writeFileSync } from 'fs';

// Encode
const data = readFileSync('input.zip');
const png = await encodeBinaryToPng(data, {
  mode: 'screenshot',
  name: 'input.zip',
});
writeFileSync('output.png', png);

// Decode
const encoded = readFileSync('output.png');
const result = await decodePngToBinary(encoded);
writeFileSync(result.meta.name, result.buf);
console.log('Decoded:', result.meta.name);
```

### Browser

```javascript
// Encode file from file input
const file = document.getElementById('fileInput').files[0];
const arrayBuffer = await file.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);

const png = await encodeBinaryToPng(buffer, {
  mode: 'screenshot',
  name: file.name,
});

// Download result
const blob = new Blob([png], { type: 'image/png' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'encoded.png';
a.click();
```

## API Reference

### `encodeBinaryToPng(input, options?)`

Encodes binary data into a PNG image with optional compression and encryption.

#### Parameters

**`input: Buffer`** (required)

- The binary data to encode
- Can be any Node.js Buffer or Uint8Array

**`options?: EncodeOptions`** (optional)

- Configuration object for encoding

#### Options

```typescript
interface EncodeOptions {
  /**
   * Compression algorithm
   * @default 'br' (Brotli)
   */
  compression?: 'br' | 'none';

  /**
   * Passphrase for encryption
   * If provided, data will be encrypted with AES-256-GCM
   */
  passphrase?: string;

  /**
   * Original filename to embed in metadata
   * Useful for preserving filename during decode
   */
  name?: string;

  /**
   * Encoding mode
   * - 'compact': 1x1 PNG with custom chunk (fastest, smallest)
   * - 'chunk': Standard PNG with rXDT chunk
   * - 'pixel': Encode as RGB pixel values
   * - 'screenshot': Optimized for visual appearance (recommended)
   * @default 'compact'
   */
  mode?: 'compact' | 'chunk' | 'pixel' | 'screenshot';

  /**
   * Encryption method
   * - 'auto': Try all and pick smallest
   * - 'aes': AES-256-GCM (secure)
   * - 'xor': Simple XOR (fast, insecure)
   * - 'none': No encryption
   * @default 'aes' when passphrase is provided
   */
  encrypt?: 'auto' | 'aes' | 'xor' | 'none';

  /**
   * Output format
   * - 'auto': Choose best format
   * - 'png': Force PNG output
   * - 'rox': Raw ROX binary (no PNG wrapper)
   * @default 'auto'
   */
  output?: 'auto' | 'png' | 'rox';

  /**
   * Include filename in metadata
   * @default true
   */
  includeName?: boolean;

  /**
   * Brotli compression quality (0-11)
   * - 0: Fastest, largest output
   * - 11: Slowest, smallest output
   * @default 1 (optimized for speed)
   */
  brQuality?: number;
}
```

#### Returns

`Promise<Buffer>` - The encoded PNG image as a Buffer

#### Example

```javascript
const png = await encodeBinaryToPng(data, {
  mode: 'screenshot',
  brQuality: 1,
  name: 'document.pdf',
  passphrase: 'secret123',
  encrypt: 'aes',
});
```

---

### `decodePngToBinary(pngBuf, options?)`

Decodes a PNG image back to the original binary data.

#### Parameters

**`pngBuf: Buffer`** (required)

- The PNG image buffer to decode
- Must be a valid RoxCompressor-encoded PNG

**`options?: DecodeOptions`** (optional)

- Configuration object for decoding

#### Options

```typescript
interface DecodeOptions {
  /**
   * Passphrase for decryption
   * Required if the data was encrypted during encoding
   */
  passphrase?: string;
}
```

#### Returns

`Promise<DecodeResult>` - Object containing decoded data and metadata

```typescript
interface DecodeResult {
  /**
   * The decoded binary data
   */
  buf: Buffer;

  /**
   * Extracted metadata
   */
  meta?: {
    /**
     * Original filename (if embedded during encoding)
     */
    name?: string;
  };
}
```

#### Example

```javascript
const result = await decodePngToBinary(pngBuffer, {
  passphrase: 'secret123',
});

console.log('Filename:', result.meta?.name);
console.log('Size:', result.buf.length, 'bytes');
writeFileSync(result.meta?.name || 'output.bin', result.buf);
```

---

## Examples

### 1. Basic File Encoding

```javascript
import { encodeBinaryToPng } from 'roxify';
import { readFileSync, writeFileSync } from 'fs';

const input = readFileSync('document.pdf');
const png = await encodeBinaryToPng(input, {
  mode: 'screenshot',
  name: 'document.pdf',
});
writeFileSync('document.png', png);

console.log('Encoded:', input.length, '→', png.length, 'bytes');
console.log('Ratio:', ((png.length / input.length) * 100).toFixed(1) + '%');
```

### 2. With AES-256-GCM Encryption

```javascript
// Encode with encryption
const encrypted = await encodeBinaryToPng(data, {
  mode: 'screenshot',
  passphrase: 'my-secure-password',
  encrypt: 'aes',
  name: 'secret.zip',
});

// Decode with passphrase
const result = await decodePngToBinary(encrypted, {
  passphrase: 'my-secure-password',
});
```

### 3. Fast Compression for Large Files

```javascript
// For files > 10 MB, use quality 0
const largePng = await encodeBinaryToPng(largeFile, {
  mode: 'screenshot',
  brQuality: 0, // Fastest compression
  name: 'large-video.mp4',
});

// Encoding time: ~500-1000ms for 10 MB
```

### 4. Best Compression for Small Files

```javascript
// For files < 1 MB, use quality 11
const smallPng = await encodeBinaryToPng(smallFile, {
  mode: 'compact',
  brQuality: 11, // Best compression
  name: 'config.json',
});

// Smallest possible output
```

### 5. No Compression (Maximum Speed)

```javascript
const fastPng = await encodeBinaryToPng(data, {
  mode: 'screenshot',
  compression: 'none',
  name: 'raw-data.bin',
});

// Fastest encoding, but larger output
```

### 6. Batch Processing Multiple Files

```javascript
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { encodeBinaryToPng } from 'roxify';

const files = readdirSync('./input');

for (const file of files) {
  const data = readFileSync(`./input/${file}`);
  const png = await encodeBinaryToPng(data, {
    mode: 'screenshot',
    brQuality: 1,
    name: file,
  });
  writeFileSync(`./output/${file}.png`, png);
  console.log(`Encoded: ${file}`);
}
```

### 7. Stream Processing (Large Files)

```javascript
import { createReadStream, createWriteStream } from 'fs';
import { encodeBinaryToPng } from 'roxify';

// Read file in chunks
const chunks = [];
const stream = createReadStream('large-file.bin');

for await (const chunk of stream) {
  chunks.push(chunk);
}

const buffer = Buffer.concat(chunks);
const png = await encodeBinaryToPng(buffer, {
  mode: 'screenshot',
  brQuality: 0,
  name: 'large-file.bin',
});

writeFileSync('large-file.png', png);
```

### 8. Error Handling & Retry

```javascript
async function encodeWithRetry(data, options, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await encodeBinaryToPng(data, options);
    } catch (err) {
      console.error(`Attempt ${i + 1} failed:`, err.message);
      if (i === maxRetries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

const png = await encodeWithRetry(data, {
  mode: 'screenshot',
  name: 'important.zip',
});
```

### 9. Verify Roundtrip Integrity

```javascript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';

const original = Buffer.from('Hello, world!');
const png = await encodeBinaryToPng(original, {
  mode: 'screenshot',
  name: 'test.txt',
});

const decoded = await decodePngToBinary(png);

if (original.equals(decoded.buf)) {
  console.log('✅ Roundtrip successful!');
} else {
  console.error('❌ Data corruption detected!');
}
```

### 10. Auto-Detect Best Encryption

```javascript
// Let the library choose best encryption (smallest result)
const png = await encodeBinaryToPng(data, {
  mode: 'screenshot',
  passphrase: 'password',
  encrypt: 'auto', // Tries none, xor, aes
  name: 'data.bin',
});

// The library will pick the encryption method that produces the smallest PNG
```

## Performance Guide

### Compression Quality vs Speed

| Quality | Speed           | Size           | Use Case                         |
| ------- | --------------- | -------------- | -------------------------------- |
| 0       | Fastest (100%)  | Largest (100%) | Real-time encoding, >50 MB files |
| 1       | Very Fast (80%) | Good (85%)     | **Default, recommended**         |
| 5       | Medium (30%)    | Better (75%)   | Balanced compression             |
| 11      | Slowest (5%)    | Best (70%)     | Archival, <1 MB files            |

### Benchmark Results (3.8 MB file)

```
Quality 0:  ~500ms   → 1.2 MB
Quality 1:  ~1000ms  → 800 KB  ← Default
Quality 5:  ~8000ms  → 750 KB
Quality 11: ~25000ms → 720 KB
```

### Mode Comparison

| Mode         | Speed   | Size     | Visual | Use Case                |
| ------------ | ------- | -------- | ------ | ----------------------- |
| `compact`    | Fastest | Smallest | No     | CLI, batch processing   |
| `chunk`      | Fast    | Small    | No     | Standard PNG embedding  |
| `pixel`      | Medium  | Medium   | Yes    | Visual steganography    |
| `screenshot` | Medium  | Medium   | Yes    | **Recommended default** |

### Optimization Tips

**For Maximum Speed:**

```javascript
const png = await encodeBinaryToPng(data, {
  mode: 'compact',
  brQuality: 0,
  compression: 'none', // Disable if speed > size
});
```

**For Minimum Size:**

```javascript
const png = await encodeBinaryToPng(data, {
  mode: 'compact',
  brQuality: 11,
  encrypt: 'auto',
});
```

**For Large Files (>10 MB):**

```javascript
const png = await encodeBinaryToPng(largeData, {
  mode: 'screenshot',
  brQuality: 0, // Critical for performance
});
```

## Error Handling

### Common Errors

**1. Incorrect Passphrase**

```javascript
try {
  await decodePngToBinary(png, { passphrase: 'wrong' });
} catch (err) {
  if (err.message.includes('Incorrect passphrase')) {
    console.error('Wrong password provided');
  }
}
```

**2. Invalid PNG Format**

```javascript
try {
  await decodePngToBinary(invalidBuffer);
} catch (err) {
  if (err.message.includes('Invalid ROX format')) {
    console.error('Not a RoxCompressor PNG');
  }
}
```

**3. Corrupted Data**

```javascript
try {
  await decodePngToBinary(corruptedPng);
} catch (err) {
  if (err.message.includes('decompression failed')) {
    console.error('PNG data is corrupted');
  }
}
```

### Robust Error Handling

```javascript
async function safeEncode(data, options) {
  try {
    return await encodeBinaryToPng(data, options);
  } catch (err) {
    console.error('Encoding failed:', err.message);

    // Fallback: try without compression
    console.log('Retrying without compression...');
    return await encodeBinaryToPng(data, {
      ...options,
      compression: 'none',
    });
  }
}

async function safeDecode(png, passphrase) {
  try {
    return await decodePngToBinary(png, { passphrase });
  } catch (err) {
    if (err.message.includes('passphrase')) {
      throw new Error('Authentication failed: incorrect password');
    }
    throw new Error(`Decode error: ${err.message}`);
  }
}
```

## TypeScript Support

Full TypeScript definitions included:

```typescript
import {
  encodeBinaryToPng,
  decodePngToBinary,
  EncodeOptions,
  DecodeResult,
} from 'roxify';

const options: EncodeOptions = {
  mode: 'screenshot',
  brQuality: 1,
  name: 'file.bin',
  passphrase: 'secret',
};

const png: Buffer = await encodeBinaryToPng(data, options);
const result: DecodeResult = await decodePngToBinary(png, {
  passphrase: 'secret',
});

// Type-safe metadata access
if (result.meta?.name) {
  console.log('Filename:', result.meta.name);
}
```

## Browser Usage

### With Webpack/Vite

```javascript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';

// File input handler
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const png = await encodeBinaryToPng(buffer, {
    mode: 'screenshot',
    name: file.name,
  });

  // Download result
  const blob = new Blob([png], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name + '.png';
  a.click();
});
```

### Polyfills Required

For browser usage, you may need to polyfill Node.js APIs:

```bash
npm install buffer browserify-zlib crypto-browserify stream-browserify
```

Vite config:

```javascript
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      buffer: 'buffer',
      crypto: 'crypto-browserify',
      stream: 'stream-browserify',
      zlib: 'browserify-zlib',
    },
  },
});
```

## License

MIT © RoxCompressor

## Support

- 📖 [Full Documentation](https://github.com/RoxasYTB/RoxCompressor)
- 🐛 [Report Issues](https://github.com/RoxasYTB/RoxCompressor/issues)
- 💬 [Discussions](https://github.com/RoxasYTB/RoxCompressor/discussions)
