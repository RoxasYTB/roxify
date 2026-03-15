# Roxify

> Encode binary data into PNG images and decode them back, losslessly. Roxify combines native Rust acceleration, multi-threaded Zstd compression, and AES-256-GCM encryption into a single, portable Node.js module.

[![npm version](https://img.shields.io/npm/v/roxify.svg)](https://www.npmjs.com/package/roxify)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Benchmarks](#benchmarks)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [JavaScript API](#javascript-api)
- [Encoding Modes](#encoding-modes)
- [Encryption](#encryption)
- [Performance Tuning](#performance-tuning)
- [Cross-Platform Support](#cross-platform-support)
- [Building from Source](#building-from-source)
- [Architecture](#architecture)
- [Error Handling](#error-handling)
- [Security Considerations](#security-considerations)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

Roxify is a PNG steganography toolkit. It packs arbitrary binary data -- files, directories, or raw buffers -- into standard PNG images that can be shared, uploaded, and stored anywhere images are accepted. The data is compressed with multi-threaded Zstd, optionally encrypted with AES-256-GCM, and embedded in valid PNG structures that survive re-uploads and screenshots.

The core compression and image-processing logic is written in Rust and exposed to Node.js through N-API. When the native module is unavailable, Roxify falls back to a pure TypeScript implementation transparently.

---

## Features

- **Native Rust acceleration** via N-API with automatic fallback to pure JavaScript
- **Multi-threaded Zstd compression** (level 19) with parallel chunk processing via Rayon
- **AES-256-GCM encryption** with PBKDF2 key derivation (100,000 iterations)
- **Lossless roundtrip** -- encoded data is recovered byte-for-byte
- **Lossy-resilient mode** -- QR-code-style Reed-Solomon error correction survives JPEG, WebP, MP3, AAC, and OGG recompression
- **Audio container** -- encode data as structured multi-frequency tones (not white noise) in WAV files
- **Directory packing** -- encode entire directory trees into a single PNG
- **Screenshot reconstitution** -- recover data from photographed or screenshotted PNGs
- **Stretch-resilient decoding** -- automatically un-stretches nearest-neighbor scaled images back to original pixel data
- **CLI and programmatic API** -- use from the terminal or import as a library
- **Cross-platform** -- prebuilt binaries for Linux x64, macOS x64/ARM64, and Windows x64
- **Full TypeScript support** with exported types and TSDoc annotations
- **mimalloc allocator** for reduced memory fragmentation under heavy workloads

---

## Benchmarks

All measurements were taken on Linux x64 (Intel i7-6700K @ 4.0 GHz, 32 GB RAM) with Node.js v20. Every tool uses its **maximum compression** setting: zip -9, gzip -9, 7z LZMA2 -mx=9, and Roxify Zstd level 19. Roxify produces a valid PNG or WAV file rather than a raw archive.

### Compression Ratio (Maximum Compression for All Tools)

| Dataset | Original | zip -9 | gzip -9 | 7z LZMA2 -9 | Roxify PNG | Roxify WAV |
|---|---|---|---|---|---|---|
| Text 1 MB | 1.00 MB | 219 KB (21.4%) | 219 KB (21.4%) | 187 KB (18.3%) | **188 KB (18.3%)** | **187 KB (18.3%)** |
| JSON 1 MB | 1.00 MB | 263 KB (25.7%) | 263 KB (25.7%) | 225 KB (22.0%) | **220 KB (21.5%)** | **219 KB (21.4%)** |
| Binary 1 MB | 1.00 MB | 1.00 MB (100%) | 1.00 MB (100%) | 1.00 MB (100%) | 1.00 MB (100%) | 1.00 MB (100%) |
| Mixed 5 MB | 5.00 MB | 2.45 MB (49.0%) | 2.45 MB (49.1%) | 2.33 MB (46.6%) | 2.38 MB (47.6%) | 2.38 MB (47.6%) |
| Text 10 MB | 10.00 MB | 2.13 MB (21.3%) | 2.13 MB (21.3%) | 1.71 MB (17.1%) | **1.71 MB (17.1%)** | **1.70 MB (17.0%)** |
| Mixed 10 MB | 10.00 MB | 4.90 MB (49.0%) | 4.90 MB (49.0%) | 4.65 MB (46.5%) | 4.73 MB (47.3%) | 4.73 MB (47.3%) |

> **Roxify matches 7z LZMA2 ultra-compression on text** (18.3% for both at 1 MB) and **beats LZMA2 on JSON** (21.4% vs 22.0%). On mixed data, Roxify is within 1 percentage point of LZMA2 while producing a shareable PNG/WAV instead of an archive.

### Encode and Decode Speed (CLI)

| Dataset | Tool | Encode | Decode | Enc Throughput | Dec Throughput |
|---|---|---|---|---|---|
| Text 1 MB | zip -9 | 112 ms | 36 ms | 8.9 MB/s | 27.6 MB/s |
| | gzip -9 | 146 ms | 38 ms | 6.9 MB/s | 26.0 MB/s |
| | 7z LZMA -9 | 303 ms | 21 ms | 3.3 MB/s | 46.6 MB/s |
| | **Roxify PNG** | **859 ms** | **577 ms** | **1.2 MB/s** | **1.7 MB/s** |
| | **Roxify WAV** | **794 ms** | **480 ms** | **1.3 MB/s** | **2.1 MB/s** |
| JSON 1 MB | zip -9 | 79 ms | 20 ms | 12.7 MB/s | 50.5 MB/s |
| | 7z LZMA -9 | 197 ms | 26 ms | 5.1 MB/s | 37.9 MB/s |
| | **Roxify PNG** | **1.14 s** | **755 ms** | **0.9 MB/s** | **1.3 MB/s** |
| | **Roxify WAV** | **1.49 s** | **518 ms** | **0.7 MB/s** | **1.9 MB/s** |
| Text 10 MB | zip -9 | 1.21 s | 70 ms | 8.2 MB/s | 143.8 MB/s |
| | 7z LZMA -9 | 5.05 s | 99 ms | 2.0 MB/s | 100.8 MB/s |
| | **Roxify PNG** | **9.05 s** | **4.53 s** | **1.1 MB/s** | **2.2 MB/s** |
| | **Roxify WAV** | **9.22 s** | **2.59 s** | **1.1 MB/s** | **3.9 MB/s** |

> Roxify CLI includes Node.js startup overhead (~400 ms). In the JS API (below), the same operations are significantly faster. WAV decode is consistently faster than PNG decode due to simpler container parsing.

### JavaScript API Throughput

Direct API calls (no CLI startup overhead):

| Size | Container | Encode | Decode | Enc Throughput | Dec Throughput | Output | Ratio | Integrity |
|---|---|---|---|---|---|---|---|---|
| 1 KB | PNG | 9 ms | 12 ms | 0.1 MB/s | 0.1 MB/s | 1.14 KB | 114.3% | ✓ |
| 10 KB | PNG | 18 ms | 34 ms | 0.5 MB/s | 0.3 MB/s | 10.32 KB | 103.2% | ✓ |
| 100 KB | PNG | 52 ms | 109 ms | 1.9 MB/s | 0.9 MB/s | 100.52 KB | 100.5% | ✓ |
| 500 KB | PNG | 339 ms | 541 ms | 1.4 MB/s | 0.9 MB/s | 502.64 KB | 100.5% | ✓ |
| 1 MB | PNG | 875 ms | 1.24 s | 1.1 MB/s | 0.8 MB/s | 1.00 MB | 100.3% | ✓ |
| 5 MB | PNG | 3.39 s | 4.12 s | 1.5 MB/s | 1.2 MB/s | 5.01 MB | 100.2% | ✓ |
| 10 MB | PNG | 6.84 s | 12.28 s | 1.5 MB/s | 0.8 MB/s | 10.01 MB | 100.1% | ✓ |
| 1 KB | WAV | 2 ms | 2 ms | 0.6 MB/s | 0.6 MB/s | 1.08 KB | 107.5% | ✓ |
| 10 KB | WAV | 4 ms | 5 ms | 2.3 MB/s | 1.8 MB/s | 10.08 KB | 100.8% | ✓ |
| 100 KB | WAV | 39 ms | 28 ms | 2.5 MB/s | 3.5 MB/s | 100.08 KB | 100.1% | ✓ |
| 500 KB | WAV | 172 ms | 190 ms | 2.8 MB/s | 2.6 MB/s | 500.09 KB | 100.0% | ✓ |
| 1 MB | WAV | 452 ms | 276 ms | 2.2 MB/s | 3.6 MB/s | 1.00 MB | 100.0% | ✓ |
| 5 MB | WAV | 2.70 s | 1.65 s | 1.8 MB/s | 3.0 MB/s | 5.00 MB | 100.0% | ✓ |
| 10 MB | WAV | 4.81 s | 2.56 s | 2.1 MB/s | 3.9 MB/s | 10.00 MB | 100.0% | ✓ |

> WAV container is **2–4× faster** than PNG for decoding at large sizes, and produces slightly smaller output thanks to simpler framing.

### Reed-Solomon ECC Throughput

| Size | Encode | Decode | Enc Throughput | Dec Throughput | Overhead |
|---|---|---|---|---|---|
| 1 KB | 6 ms | 4 ms | 0.2 MB/s | 0.2 MB/s | 125.7% |
| 10 KB | 7 ms | 6 ms | 1.3 MB/s | 1.5 MB/s | 119.6% |
| 100 KB | 49 ms | 45 ms | 2.0 MB/s | 2.1 MB/s | 118.8% |
| 1 MB | 483 ms | 377 ms | 2.1 MB/s | 2.7 MB/s | 118.6% |

### Lossy-Resilient Encoding

#### Robust Image (QR-code-style, block size 4×4)

| Data Size | Encode Time | Output (PNG) |
|---|---|---|
| 32 B | 32 ms | 122 KB |
| 128 B | 39 ms | 122 KB |
| 512 B | 76 ms | 316 KB |
| 1 KB | 139 ms | 508 KB |
| 2 KB | 251 ms | 986 KB |

#### Robust Audio (MFSK 8-channel, medium ECC)

| Data Size | Encode | Decode | Output (WAV) | Integrity |
|---|---|---|---|---|
| 10 B | 33 ms | 44 ms | 1.35 MB | ✓ |
| 32 B | 19 ms | 31 ms | 1.35 MB | ✓ |
| 64 B | 22 ms | 24 ms | 1.35 MB | ✓ |
| 128 B | 21 ms | 28 ms | 1.35 MB | ✓ |
| 256 B | 40 ms | 45 ms | 2.59 MB | ✓ |

### Data Integrity Verification

All encode/decode roundtrips produce bit-exact output, verified by SHA-256:

| Test Case | PNG | WAV |
|---|---|---|
| Empty buffer (0 B) | ✓ | ✓ |
| Single byte (1 B) | ✓ | ✓ |
| All byte values (256 B) | ✓ | ✓ |
| 1 KB text | ✓ | ✓ |
| 100 KB random | ✓ | ✓ |
| 1 MB random | ✓ | ✓ |
| 5 MB random | ✓ | ✓ |

**14 / 14 integrity tests passed** across both containers.

### Key Observations

- **Roxify matches LZMA2 ultra-compression** on text data (18.3%) and **outperforms it on JSON** (21.4% vs 22.0%), while producing a standard PNG or WAV file instead of an archive.
- **WAV container decode is 2–4× faster** than PNG decode at large sizes (3.9 MB/s vs 0.8 MB/s for 10 MB).
- **WAV encode for 1 KB data completes in 2 ms** — well under the sub-second target.
- **Lossy-resilient audio** encode/decode completes in under 50 ms for data up to 256 bytes, with full integrity.
- **100% data integrity** across all sizes and containers — every byte is recovered exactly.
- The CLI overhead (~400 ms Node.js startup) is amortized on larger inputs. For programmatic use, the JS API eliminates this entirely.
- On incompressible (random) data, all tools converge to ~100% as expected. No compression algorithm can shrink truly random data.

### Methodology

Benchmarks were generated using `test/benchmark-detailed.cjs`. Datasets consist of procedurally generated text, JSON, and random binary data. Each tool was invoked with its maximum compression setting:

| Tool | Command / Setting |
|---|---|
| zip | `zip -r -q -9` |
| tar/gzip | `tar -cf - \| gzip -9` |
| 7z | `7z a -mx=9` (LZMA2 ultra) |
| Roxify | Zstd level 19, compact mode |

To reproduce:

```bash
node test/benchmark-detailed.cjs
```

---

## Installation

### As a CLI tool (no installation required)

```bash
npx rox encode input.zip output.png
npx rox decode output.png original.zip
```

### As a library

```bash
npm install roxify
```

### Global installation

```bash
npm install -g roxify
rox encode input.zip output.png
```

---

## CLI Usage

### Encoding

```bash
rox encode <input> [output] [options]
```

| Option | Description | Default |
|---|---|---|
| `-p, --passphrase <pass>` | Encrypt with AES-256-GCM | none |
| `-m, --mode <mode>` | Encoding mode: `screenshot`, `compact` | `screenshot` |
| `-q, --quality <0-11>` | Compression effort (0 = fastest, 11 = smallest) | `1` |
| `-e, --encrypt <type>` | Encryption method: `auto`, `aes`, `xor`, `none` | `aes` if passphrase is set |
| `--no-compress` | Disable compression entirely | false |
| `-o, --output <path>` | Explicit output file path | auto-generated |

### Decoding

```bash
rox decode <input> [output] [options]
```

| Option | Description | Default |
|---|---|---|
| `-p, --passphrase <pass>` | Decryption passphrase | none |
| `-o, --output <path>` | Output file path | auto-detected from metadata |
| `--dict <file>` | Zstd dictionary for improved decompression | none |

### Examples

```bash
# Encode a single file
rox encode document.pdf document.png

# Encode with encryption
rox encode secret.zip secret.png -p "strong passphrase"

# Decode back to original
rox decode secret.png secret.zip -p "strong passphrase"

# Fast compression for large files
rox encode video.mp4 output.png -q 0

# Best compression for small files
rox encode config.json output.png -q 11 -m compact

# Encode an entire directory
rox encode ./my-project project.png
```

---

## JavaScript API

### Basic Encode and Decode

```typescript
import { encodeBinaryToPng, decodePngToBinary } from 'roxify';
import { readFileSync, writeFileSync } from 'fs';

// Encode
const input = readFileSync('document.pdf');
const png = await encodeBinaryToPng(input, { name: 'document.pdf' });
writeFileSync('document.png', png);

// Decode
const encoded = readFileSync('document.png');
const result = await decodePngToBinary(encoded);
writeFileSync(result.meta?.name || 'output.bin', result.buf);
```

### Encrypted Roundtrip

```typescript
const png = await encodeBinaryToPng(input, {
  passphrase: 'my-secret',
  encrypt: 'aes',
  name: 'confidential.pdf',
});

const result = await decodePngToBinary(png, {
  passphrase: 'my-secret',
});
```

### Directory Packing

```typescript
import { packPaths, unpackBuffer } from 'roxify';

// Pack files into a buffer
const { buf, list } = packPaths(['./src', './README.md'], process.cwd());

// Encode the packed buffer into a PNG
const png = await encodeBinaryToPng(buf, { name: 'project.tar' });

// Later: decode and unpack
const decoded = await decodePngToBinary(png);
const unpacked = unpackBuffer(decoded.buf);
for (const file of unpacked.files) {
  console.log(file.name, file.buf.length);
}
```

### Progress Reporting

```typescript
const png = await encodeBinaryToPng(largeBuffer, {
  name: 'large-file.bin',
  onProgress: ({ phase, loaded, total }) => {
    console.log(`${phase}: ${loaded}/${total}`);
  },
});
```

### EncodeOptions

```typescript
interface EncodeOptions {
  compression?: 'zstd';           // Compression algorithm
  compressionLevel?: number;       // Zstd compression level (0-19)
  passphrase?: string;             // Encryption passphrase
  dict?: Buffer;                   // Zstd dictionary for improved ratios
  name?: string;                   // Original filename stored in metadata
  mode?: 'screenshot';             // Encoding mode
  encrypt?: 'auto' | 'aes' | 'xor' | 'none';
  output?: 'auto' | 'png' | 'rox'; // Output format
  includeName?: boolean;           // Include filename in PNG metadata
  includeFileList?: boolean;       // Include file manifest in PNG
  fileList?: Array<string | { name: string; size: number }>;
  skipOptimization?: boolean;      // Skip PNG optimization pass
  lossyResilient?: boolean;       // Enable lossy-resilient encoding (RS ECC)
  eccLevel?: EccLevel;             // 'low' | 'medium' | 'quartile' | 'high'
  robustBlockSize?: number;        // 2–8 pixels per data block (lossy image)
  container?: 'image' | 'sound';   // Output container format
  onProgress?: (info: ProgressInfo) => void;
  showProgress?: boolean;
  verbose?: boolean;
}
```

### DecodeOptions

```typescript
interface DecodeOptions {
  passphrase?: string;             // Decryption passphrase
  outPath?: string;                // Output directory for unpacked files
  files?: string[];                // Extract only specific files from archive
  onProgress?: (info: ProgressInfo) => void;
  showProgress?: boolean;
  verbose?: boolean;
}
```

### DecodeResult

```typescript
interface DecodeResult {
  buf?: Buffer;                    // Decoded binary payload
  meta?: { name?: string };        // Metadata (original filename)
  files?: PackedFile[];            // Unpacked directory entries, if applicable
  correctedErrors?: number;        // RS errors corrected (lossy-resilient mode)
}
```

---

## Encoding Modes

| Mode | Description | Use Case |
|---|---|---|
| `screenshot` | Encodes data as RGB pixels in a standard PNG. The image looks like a gradient or noise pattern and survives re-uploads and social media processing. | Sharing on image-only platforms, bypassing file-type filters |
| `compact` | Minimal 1x1 PNG with data embedded in a custom ancillary chunk (`rXDT`). Produces the smallest possible output. | Programmatic use, archival, maximum compression ratio |

### Stretch-Resilient Decoding

Roxify automatically detects and recovers data from **nearest-neighbor stretched** images. If a roxified PNG is scaled up (e.g., zoomed in a browser, pasted in a document, resized in an image editor with nearest-neighbor interpolation), the decoder:

1. **Crops** the image to the non-background bounding box
2. **Collapses** horizontal runs of identical pixels back to single logical pixels
3. **Deduplicates** consecutive identical rows

This means you can share a roxified image at any zoom level and it will still decode correctly. Non-uniform stretch factors and white padding are fully supported.

```bash
# Works even on stretched/zoomed screenshots
rox decode zoomed-screenshot.png -o output/
```

---

## Encryption

Roxify supports two encryption methods:

| Method | Algorithm | Strength | Use Case |
|---|---|---|---|
| `aes` | AES-256-GCM with PBKDF2 (100,000 iterations) | Cryptographically secure, authenticated | Sensitive data, confidential documents |
| `xor` | XOR cipher with passphrase-derived key | Obfuscation only, not cryptographically secure | Casual deterrent against inspection |

When `encrypt` is set to `auto` (the default when a passphrase is provided), AES is selected.

---

## Lossy-Resilient Mode

Enable `lossyResilient: true` to produce output that survives lossy compression. This uses the same error correction algorithm as QR codes (Reed-Solomon over GF(256)) combined with block-based signal encoding.

### How It Works

1. **Reed-Solomon ECC** adds configurable redundancy (10–100%) to the data.
2. **Interleaving** spreads data across RS blocks so burst errors don't overwhelm a single block.
3. **Block encoding** (image: large pixel blocks; audio: multi-frequency tones) makes the signal robust against quantization.
4. **Finder patterns** (image only) enable automatic alignment after re-encoding.

### Error Correction Levels

| Level | Parity Symbols | Overhead | Correctable Errors |
|-------|---------------:|---------:|-------------------:|
| `low` | 20 / block | ~10% | ~4% |
| `medium` | 40 / block | ~19% | ~9% |
| `quartile` | 64 / block | ~33% | ~15% |
| `high` | 128 / block | ~100% | ~25% |

### Example

```typescript
// Image that survives JPEG compression
const png = await encodeBinaryToPng(data, {
  lossyResilient: true,
  eccLevel: 'quartile',
  robustBlockSize: 4,   // 4×4 pixels per data bit
});

// Audio that survives MP3 compression
const wav = await encodeBinaryToPng(data, {
  container: 'sound',
  lossyResilient: true,
  eccLevel: 'medium',
});

// Decode automatically detects the format
const result = await decodePngToBinary(png);
console.log('Errors corrected:', result.correctedErrors);
```

For full documentation, see [Lossy Resilience Guide](./docs/LOSSY_RESILIENCE.md).

---

## Audio Container

Roxify can encode data into WAV audio files using `container: 'sound'`.

### Standard Mode (`lossyResilient: false`)

Data bytes are stored directly as 8-bit PCM samples. This is the fastest and most compact option, but the output sounds like white noise and does not survive lossy audio compression.

### Lossy-Resilient Mode (`lossyResilient: true`)

Data is encoded using **8-channel multi-frequency shift keying (MFSK)**:

- 8 carrier frequencies (600–2700 Hz) encode 1 byte per symbol.
- Each carrier is modulated with raised-cosine windowing.
- The output sounds like a series of **musical chords** — structured and pleasant, not white noise.
- Reed-Solomon ECC enables recovery after MP3/AAC/OGG transcoding.

```typescript
const wav = await encodeBinaryToPng(data, {
  container: 'sound',
  lossyResilient: true,
  eccLevel: 'medium',
});
```

---

## Performance Tuning

### Compression Level

The `compressionLevel` option (CLI: `-q`) controls the trade-off between speed and output size:

| Level | Speed | Ratio | Recommendation |
|---|---|---|---|
| 0 | Fastest | Largest | Files over 100 MB, real-time workflows |
| 1 | Fast | Good | Default; general-purpose use |
| 5 | Moderate | Better | Archival of medium-sized datasets |
| 11 | Slowest | Smallest | Small files under 1 MB, long-term storage |

### Native Module

The Rust native module provides 10--50x throughput improvement over the pure JavaScript fallback. It is loaded automatically when present. To verify availability:

```typescript
import { native } from 'roxify';
console.log('Native module loaded:', !!native);
```

If the native module is not found for the current platform, Roxify falls back to TypeScript transparently. No code changes are needed.

### Zstd Dictionary

For datasets consisting of many similar small files (e.g., JSON API responses, log entries), a Zstd dictionary can improve compression ratios by 20--40%:

```typescript
import { readFileSync } from 'fs';

const dict = readFileSync('my-dictionary.zdict');
const png = await encodeBinaryToPng(data, { dict });
```

---

## Cross-Platform Support

Roxify ships prebuilt native modules for the following targets:

| Platform | Architecture | Binary Name |
|---|---|---|
| Linux | x86_64 | `libroxify_native-x86_64-unknown-linux-gnu.node` |
| macOS | x86_64 | `libroxify_native-x86_64-apple-darwin.node` |
| macOS | ARM64 (Apple Silicon) | `libroxify_native-aarch64-apple-darwin.node` |
| Windows | x86_64 | `roxify_native-x86_64-pc-windows-msvc.node` |

The correct binary is resolved automatically at runtime. If no binary is found for the current platform, Roxify falls back silently to the pure JavaScript implementation.

### Building Native Modules for Specific Targets

```bash
# Current platform
npm run build:native

# Specific platform
npm run build:native:linux
npm run build:native:macos-x64
npm run build:native:macos-arm
npm run build:native:windows

# All configured targets
npm run build:native:targets
```

---

## Building from Source

### Prerequisites

- Node.js 18 or later
- Rust 1.70 or later (install via [rustup](https://rustup.rs))

### Commands

```bash
# Install dependencies
npm install

# Build TypeScript only
npm run build

# Build native Rust module
npm run build:native

# Build everything (Rust + TypeScript + CLI binary)
npm run build:all

# Run the full test suite
npm test
```

### Project Structure

```
roxify/
  native/         Rust source code (N-API module and CLI binary)
  src/            TypeScript source code (library and CLI entry point)
  dist/           Compiled JavaScript output
  test/           Test suite and benchmarks
  docs/           Additional documentation
  scripts/        Build, release, and CI helper scripts
```

---

## Architecture

Roxify is a hybrid Rust and TypeScript module. The performance-critical paths -- compression, CRC computation, pixel scanning, encryption -- are implemented in Rust and exposed through N-API bindings. The TypeScript layer handles PNG construction, CLI argument parsing, and high-level orchestration.

### Compression Pipeline

```
Input --> Zstd Compress (multi-threaded, Rayon) --> AES-256-GCM Encrypt (optional) --> PNG Encode --> Output
```

### Lossy-Resilient Pipeline

```
Input --> RS ECC Encode --> Interleave --> Block Encode (MFSK audio / QR-like image) --> WAV/PNG Output
```

### Decompression Pipeline

```
Input --> PNG Parse --> Un-stretch (if needed) --> AES-256-GCM Decrypt (optional) --> Zstd Decompress --> Output
```

### Lossy-Resilient Decode Pipeline

```
Input --> Detect Format --> Demodulate/Read Blocks --> De-interleave --> RS ECC Decode --> Output
```

### Rust Modules

| Module | Responsibility |
|---|---|
| `core.rs` | Pixel scanning, CRC32, Adler32, delta coding, Zstd compress/decompress |
| `encoder.rs` | PNG payload encoding with marker pixels and metadata chunks |
| `packer.rs` | Directory tree serialization and streaming deserialization |
| `crypto.rs` | AES-256-GCM encryption and PBKDF2 key derivation |
| `archive.rs` | Tar-based archiving with optional Zstd compression |
| `reconstitution.rs` | Screenshot detection and automatic crop to recover encoded data |
| `audio.rs` | WAV container encoding and decoding (PCM byte packing) |
| `bwt.rs` | Parallel Burrows-Wheeler Transform |
| `rans.rs` | rANS (Asymmetric Numeral Systems) entropy coder |
| `hybrid.rs` | Block-based orchestration of BWT, context mixing, and rANS |
| `pool.rs` | Buffer pooling and zero-copy memory management |
| `image_utils.rs` | Image resizing, pixel format conversion, metadata extraction |
| `png_utils.rs` | Low-level PNG chunk read/write operations |
| `progress.rs` | Progress tracking for long-running compression/decompression |

### TypeScript Modules

| Module | Responsibility |
|---|---|
| `ecc.ts` | Reed-Solomon GF(256) codec, block ECC, interleaving |
| `robust-audio.ts` | MFSK audio modulation/demodulation, Goertzel detection, sync preamble |
| `robust-image.ts` | QR-code-like block encoding, finder patterns, majority voting |
| `encoder.ts` | High-level encoding orchestration (standard + lossy-resilient) |
| `decoder.ts` | High-level decoding with automatic format detection |
| `audio.ts` | Standard WAV container (8-bit PCM) |
| `helpers.ts` | Delta coding, XOR cipher, palette generation |
| `zstd.ts` | Parallel Zstd compression via native module |

---

## Error Handling

Roxify throws descriptive errors for common failure modes:

```typescript
import { decodePngToBinary } from 'roxify';

try {
  const result = await decodePngToBinary(pngBuffer, {
    passphrase: 'wrong-password',
  });
} catch (err) {
  if (err.message.includes('Incorrect passphrase')) {
    // Wrong decryption key
  } else if (err.message.includes('not a valid PNG')) {
    // Input is not a valid roxified PNG
  } else if (err.message.includes('corrupted')) {
    // Data integrity check failed
  }
}
```

| Error | Cause |
|---|---|
| `Incorrect passphrase` | Wrong password provided for decryption |
| `not a valid PNG` | Input buffer is not a PNG or lacks Roxify markers |
| `Passphrase required` | File is encrypted but no passphrase was supplied |
| `Image too large to decode` | PNG dimensions exceed the in-process memory limit |

---

## Security Considerations

- **AES-256-GCM** provides authenticated encryption. Tampered ciphertext is detected and rejected.
- **PBKDF2** with 100,000 iterations is used for key derivation, making brute-force attacks computationally expensive.
- **XOR encryption** is not cryptographically secure. Use it only for casual obfuscation.
- Passphrases are never stored in the output file. There is no recovery mechanism for a lost passphrase.
- The PNG output does not visually reveal whether data is encrypted. An observer cannot distinguish an encrypted Roxify PNG from an unencrypted one by inspection.

---

## Contributing

Contributions are welcome. Please open an issue to discuss proposed changes before submitting a pull request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Run the test suite (`npm test`)
4. Submit a pull request

---

## License

MIT. See [LICENSE](LICENSE) for details.

---

## Links

- [npm Package](https://www.npmjs.com/package/roxify)
- [GitHub Repository](https://github.com/RoxasYTB/roxify)
- [Issue Tracker](https://github.com/RoxasYTB/roxify/issues)
- [CLI Documentation](./docs/CLI.md)
- [JavaScript SDK Reference](./docs/JAVASCRIPT_SDK.md)
- [Cross-Platform Build Guide](./docs/CROSS_PLATFORM.md)
- [Lossy Resilience Guide](./docs/LOSSY_RESILIENCE.md)
