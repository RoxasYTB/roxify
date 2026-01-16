# RoxCompressor Transform

> Encode binary data into PNG images and decode them back. Fast, efficient, with optional encryption and native Rust acceleration.

[![npm version](https://img.shields.io/npm/v/roxify.svg)](https://www.npmjs.com/package/roxify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Features

- ⚡ **Blazing Fast**: Native Rust acceleration via N-API — **1GB/s** throughput on modern hardware
- 🚀 **Optimized Compression**: Multi-threaded Zstd compression (level 19) with parallel processing
- 🔒 **Secure**: AES-256-GCM encryption support with PBKDF2 key derivation
- 🎨 **Multiple modes**: Compact, chunk, pixel, and screenshot modes
- 📦 **CLI & API**: Use as command-line tool or JavaScript library
- 🔄 **Lossless**: Perfect roundtrip encoding/decoding
- 📖 **Full TSDoc**: Complete TypeScript documentation
- 🦀 **Rust Powered**: Optional native module for extreme performance (falls back to pure JS)

## Real-world benchmarks 🔧

**Highlights**

- Practical benchmarks on large codebase datasets showing significant compression and high throughput while handling many small files efficiently.

**Results**

| Dataset  |   Files | Original | Compressed |     Ratio |   Time | Throughput | Notes                                       |
| -------- | ------: | -------: | ---------: | --------: | -----: | ---------: | ------------------------------------------- |
| 4,000 MB | 731,340 |  3.93 GB |  111.42 MB |  **2.8%** | 26.9 s | 149.4 MB/s | gzip: 2.26 GB (57.5%); 7z: 1.87 GB (47.6%)  |
| 1,000 MB | 141,522 |  1.03 GB |     205 MB | **19.4%** | ~6.2 s |  ≈170 MB/s | shows benefits for many-small-file datasets |

### Methodology

- Compression: multithreaded Zstd (level 19) and Brotli (configurable).
- Setup: parallel I/O and multithreaded compression on modern SSD-backed systems.
- Measurements: wall-clock time; throughput = original size / time; comparisons against gzip and 7z with typical defaults.
- Reproducibility: full benchmark details, commands and raw data are available in `docs/BENCHMARK_FINAL_REPORT.md`.

These results demonstrate Roxify's strength for packaging large codebases and many-small-file archives where speed and a good compression/throughput trade-off matter.

## Documentation

- 📘 **[CLI Documentation](./docs/CLI.md)** - Complete command-line usage guide
- 📗 **[JavaScript SDK](./docs/JAVASCRIPT_SDK.md)** - Programmatic API reference with examples
- 📙 **[Quick Start](#quick-start)** - Get started in 2 minutes

## Installation

### As CLI tool (npx)

No installation needed! Use directly with npx:

```bash
  npx rox encode input.zip output.png
  npx rox decode output.png original.zip
```

### As library

```bash
npm install roxify
```

## CLI Usage

### Quick Start

```bash
# Encode a file
  npx rox encode document.pdf document.png

# Decode it back
  npx rox decode document.png document.pdf

# With encryption
  npx rox encode secret.zip secret.png -p mypassword
  npx rox decode secret.png secret.zip -p mypassword
```

### CLI Commands

#### `encode` - Encode file to PNG

```bash
  npx rox encode <input> [output] [options]
```

**Options:**

- `-p, --passphrase <pass>` - Encrypt with passphrase (AES-256-GCM)
- `-m, --mode <mode>` - Encoding mode: `compact|chunk|pixel|screenshot` (default: `screenshot`)
- `-q, --quality <0-11>` - Brotli compression quality (default: `1`)
  - `0` = fastest, largest
  - `11` = slowest, smallest
- `-e, --encrypt <type>` - Encryption: `auto|aes|xor|none` (default: `aes` if passphrase)
- `--no-compress` - Disable compression
- `-o, --output <path>` - Output file path

**Examples:**

```bash
# Basic encoding
  npx rox encode data.bin output.png

# Fast compression for large files
  npx rox encode large-video.mp4 output.png -q 0

# High compression for small files
  npx rox encode config.json output.png -q 11

# With encryption
  npx rox encode secret.pdf secure.png -p "my secure password"

# Compact mode (smallest PNG)
  npx rox encode data.bin tiny.png -m compact

# Screenshot mode (recommended, looks like a real image)
  npx rox encode archive.tar.gz screenshot.png -m screenshot
```

#### `decode` - Decode PNG to file

```bash
  npx rox decode <input> [output] [options]
```

**Options:**

- `-p, --passphrase <pass>` - Decryption passphrase
- `-o, --output <path>` - Output file path (auto-detected from metadata if not provided)

**Examples:**

```bash
# Basic decoding
  npx rox decode encoded.png output.bin

# Auto-detect filename from metadata
  npx rox decode encoded.png

# With decryption
  npx rox decode encrypted.png output.pdf -p "my secure password"
```

## JavaScript API

### Basic Usage

```typescript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';
import { readFileSync, writeFileSync } from 'fs';

// Encode
const input = readFileSync('input.zip');
const png = await encodeBinaryToPng(input, {
  mode: 'screenshot',
  name: 'input.zip',
});
writeFileSync('output.png', png);

// Decode
const encoded = readFileSync('output.png');
const result = await decodePngToBinary(encoded);
writeFileSync(result.meta?.name || 'output.bin', result.buf);
```

### With Encryption

```typescript
// Encode with AES-256-GCM
const png = await encodeBinaryToPng(input, {
  mode: 'screenshot',
  passphrase: 'my-secret-password',
  encrypt: 'aes',
  name: 'secret.zip',
});

// Decode with passphrase
const result = await decodePngToBinary(encoded, {
  passphrase: 'my-secret-password',
});
```

### Fast Compression

```typescript
// Optimize for speed (recommended for large files)
const png = await encodeBinaryToPng(largeBuffer, {
  mode: 'screenshot',
  brQuality: 0, // Fastest
  name: 'large-file.bin',
});

// Optimize for size (recommended for small files)
const png = await encodeBinaryToPng(smallBuffer, {
  mode: 'compact',
  brQuality: 11, // Best compression
  name: 'config.json',
});
```

### Encoding Modes

#### `screenshot` (Recommended)

Encodes data as RGB pixel values, optimized for screenshot-like appearance. Best balance of size and compatibility.

```typescript
const png = await encodeBinaryToPng(data, { mode: 'screenshot' });
```

#### `compact` (Smallest)

Minimal 1x1 PNG with data in custom chunk. Fastest and smallest.

```typescript
const png = await encodeBinaryToPng(data, { mode: 'compact' });
```

#### `pixel`

Encodes data as RGB pixel values without screenshot optimization.

```typescript
const png = await encodeBinaryToPng(data, { mode: 'pixel' });
```

#### `chunk`

Standard PNG with data in custom rXDT chunk.

```typescript
const png = await encodeBinaryToPng(data, { mode: 'chunk' });
```

## API Reference

### `encodeBinaryToPng(input, options)`

Encodes binary data into a PNG image.

**Parameters:**

- `input: Buffer` - The binary data to encode
- `options?: EncodeOptions` - Encoding options

**Returns:** `Promise<Buffer>` - The encoded PNG

**Options:**

```typescript
interface EncodeOptions {
  // Compression algorithm ('br' = Brotli, 'none' = no compression)
  compression?: 'br' | 'none';

  // Passphrase for encryption
  passphrase?: string;

  // Original filename to embed
  name?: string;

  // Encoding mode
  mode?: 'compact' | 'chunk' | 'pixel' | 'screenshot';

  // Encryption method
  encrypt?: 'auto' | 'aes' | 'xor' | 'none';

  // Output format
  output?: 'auto' | 'png' | 'rox';

  // Include filename in metadata (default: true)
  includeName?: boolean;

  // Brotli quality 0-11 (default: 1)
  brQuality?: number;
}
```

### `decodePngToBinary(pngBuf, options)`

Decodes a PNG image back to binary data.

**Parameters:**

- `pngBuf: Buffer` - The PNG image to decode
- `options?: DecodeOptions` - Decoding options

**Returns:** `Promise<DecodeResult>` - The decoded data and metadata

**Options:**

```typescript
interface DecodeOptions {
  // Passphrase for decryption
  passphrase?: string;
}
```

**Result:**

```typescript
interface DecodeResult {
  // Decoded binary data
  buf: Buffer;

  // Extracted metadata
  meta?: {
    // Original filename
    name?: string;
  };
}
```

## Performance Tips

### For Large Files (>10 MB)

```bash
# Use quality 0 for fastest encoding
npx rox encode large.bin output.png -q 0
```

```typescript
const png = await encodeBinaryToPng(largeFile, {
  mode: 'screenshot',
  brQuality: 0, // 10-20x faster than default
});
```

### For Small Files (<1 MB)

```bash
# Use quality 11 for best compression
npx rox encode small.json output.png -q 11 -m compact
```

```typescript
const png = await encodeBinaryToPng(smallFile, {
  mode: 'compact',
  brQuality: 11, // Best compression ratio
});
```

### Benchmark Results

File: 3.8 MB binary

- **Quality 0**: ~500-800ms, output ~1.2 MB
- **Quality 1** (default): ~1-2s, output ~800 KB
- **Quality 5**: ~8-12s, output ~750 KB
- **Quality 11**: ~20-30s, output ~720 KB

## Error Handling

```typescript
try {
  const result = await decodePngToBinary(encoded, {
    passphrase: 'wrong-password',
  });
} catch (err) {
  if (err.message.includes('Incorrect passphrase')) {
    console.error('Wrong password!');
  } else if (err.message.includes('Invalid ROX format')) {
    console.error('Not a valid RoxCompressor PNG');
  } else {
    console.error('Decode failed:', err.message);
  }
}
```

## Security

- **AES-256-GCM**: Authenticated encryption with 100,000 PBKDF2 iterations
- **XOR cipher**: Simple obfuscation (not cryptographically secure)
- **No encryption**: Data is compressed but not encrypted

⚠️ **Warning**: Use strong passphrases for sensitive data. The `xor` encryption mode is not secure and should only be used for obfuscation.

## License

MIT © RoxCompressor

## Contributing

Contributions welcome! Please open an issue or PR on GitHub.

## Links

- [GitHub Repository](https://github.com/RoxasYTB/roxify)
- [npm Package](https://www.npmjs.com/package/roxify)
- [Report Issues](https://github.com/RoxasYTB/roxify/issues)

## CI / Multi-platform builds

This project runs continuous integration on Linux, Windows and macOS via GitHub Actions. Native modules are built on each platform and attached to the workflow (and release) as artifacts. On releases we also publish platform artifacts to GitHub Releases. For npm publishing, set the `NPM_TOKEN` secret in your repository settings to allow automated publishes on release.
