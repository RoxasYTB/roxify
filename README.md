# Roxify

> Encode binary data into PNG images and decode them back, losslessly. Roxify combines native Rust acceleration, multi-threaded Zstd compression, and AES-256-GCM encryption into a single, portable Node.js module.

[![npm version](https://img.shields.io/npm/v/roxify.svg)](https://www.npmjs.com/package/roxify)
[![License: RPOSL](https://img.shields.io/badge/License-RPOSL-red.svg)](LICENSE)

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
- **BWT-ANS compression** -- Burrows-Wheeler Transform + Move-to-Front + RLE + rANS entropy coding via libsais O(n) SA-IS (18.1 MB/s encode, 31.2 MB/s decode)
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

All measurements below use Roxify native Rust CLI (`roxify_native`) with streaming directory packing, Zstd L3, multi-threading, long-distance matching, and `window_log(30)`.

### Cold-cache throughput on ext4

Measured with targeted page-cache eviction (`POSIX_FADV_DONTNEED`) before both encode and decode. Raw manifest lives in `docs/COLD_BENCHMARK_2026-04-15.json`.

| Dataset | Files | Source | Output PNG | Encode | Encode throughput | Decode | Decode throughput |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Glados-Disc | 19,645 | 208.18 MiB | 54.83 MiB | 2.883 s | 72.22 MiB/s | 0.954 s | 218.16 MiB/s |
| Gmod | 3,936 | 1.36 GiB | 411.09 MiB | 6.127 s | 227.69 MiB/s | 5.850 s | 238.48 MiB/s |

### High-latency source filesystem encode

Roxify 1.13.4 adds adaptive parallel preload for small files before feeding Zstd. This specifically targets metadata-heavy trees on slower filesystems such as NTFS, APFS, exFAT, and network-backed mounts.

| Dataset | Source FS | Before 1.13.4 | Roxify 1.13.4 | Speedup |
| --- | --- | --- | --- | --- |
| Glados-Disc (19,645 files) | NTFS under Linux | 81.608 s | 2.189 s | 37.3x |
| Gmod (3,936 files) | NTFS under Linux | 22.578 s | 4.517 s | 5.0x |

### Data integrity

All benchmark runs completed with byte-exact roundtrip validation. Decode output matched original logical source bytes on every dataset.

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

| Option                    | Description                                     | Default                    |
| ------------------------- | ----------------------------------------------- | -------------------------- |
| `-p, --passphrase <pass>` | Encrypt with AES-256-GCM                        | none                       |
| `-m, --mode <mode>`       | Encoding mode: `screenshot`, `compact`          | `screenshot`               |
| `-q, --quality <0-11>`    | Compression effort (0 = fastest, 11 = smallest) | `1`                        |
| `-e, --encrypt <type>`    | Encryption method: `auto`, `aes`, `xor`, `none` | `aes` if passphrase is set |
| `--no-compress`           | Disable compression entirely                    | false                      |
| `-o, --output <path>`     | Explicit output file path                       | auto-generated             |

### Decoding

```bash
rox decode <input> [output] [options]
```

| Option                    | Description                                | Default                     |
| ------------------------- | ------------------------------------------ | --------------------------- |
| `-p, --passphrase <pass>` | Decryption passphrase                      | none                        |
| `-o, --output <path>`     | Output file path                           | auto-detected from metadata |
| `--dict <file>`           | Zstd dictionary for improved decompression | none                        |

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
  compression?: 'zstd'; // Compression algorithm
  compressionLevel?: number; // Zstd compression level (0-19)
  passphrase?: string; // Encryption passphrase
  dict?: Buffer; // Zstd dictionary for improved ratios
  name?: string; // Original filename stored in metadata
  mode?: 'screenshot'; // Encoding mode
  encrypt?: 'auto' | 'aes' | 'xor' | 'none';
  output?: 'auto' | 'png' | 'rox'; // Output format
  includeName?: boolean; // Include filename in PNG metadata
  includeFileList?: boolean; // Include file manifest in PNG
  fileList?: Array<string | { name: string; size: number }>;
  skipOptimization?: boolean; // Skip PNG optimization pass
  lossyResilient?: boolean; // Enable lossy-resilient encoding (RS ECC)
  eccLevel?: EccLevel; // 'low' | 'medium' | 'quartile' | 'high'
  robustBlockSize?: number; // 2–8 pixels per data block (lossy image)
  container?: 'image' | 'sound'; // Output container format
  onProgress?: (info: ProgressInfo) => void;
  showProgress?: boolean;
  verbose?: boolean;
}
```

### DecodeOptions

```typescript
interface DecodeOptions {
  passphrase?: string; // Decryption passphrase
  outPath?: string; // Output directory for unpacked files
  files?: string[]; // Extract only specific files from archive
  onProgress?: (info: ProgressInfo) => void;
  showProgress?: boolean;
  verbose?: boolean;
}
```

### DecodeResult

```typescript
interface DecodeResult {
  buf?: Buffer; // Decoded binary payload
  meta?: { name?: string }; // Metadata (original filename)
  files?: PackedFile[]; // Unpacked directory entries, if applicable
  correctedErrors?: number; // RS errors corrected (lossy-resilient mode)
}
```

---

## Encoding Modes

| Mode         | Description                                                                                                                                         | Use Case                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `screenshot` | Encodes data as RGB pixels in a standard PNG. The image looks like a gradient or noise pattern and survives re-uploads and social media processing. | Sharing on image-only platforms, bypassing file-type filters |
| `compact`    | Minimal 1x1 PNG with data embedded in a custom ancillary chunk (`rXDT`). Produces the smallest possible output.                                     | Programmatic use, archival, maximum compression ratio        |

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

| Method | Algorithm                                    | Strength                                       | Use Case                               |
| ------ | -------------------------------------------- | ---------------------------------------------- | -------------------------------------- |
| `aes`  | AES-256-GCM with PBKDF2 (100,000 iterations) | Cryptographically secure, authenticated        | Sensitive data, confidential documents |
| `xor`  | XOR cipher with passphrase-derived key       | Obfuscation only, not cryptographically secure | Casual deterrent against inspection    |

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

| Level      | Parity Symbols | Overhead | Correctable Errors |
| ---------- | -------------: | -------: | -----------------: |
| `low`      |     20 / block |     ~10% |                ~4% |
| `medium`   |     40 / block |     ~19% |                ~9% |
| `quartile` |     64 / block |     ~33% |               ~15% |
| `high`     |    128 / block |    ~100% |               ~25% |

### Example

```typescript
// Image that survives JPEG compression
const png = await encodeBinaryToPng(data, {
  lossyResilient: true,
  eccLevel: 'quartile',
  robustBlockSize: 4, // 4×4 pixels per data bit
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

| Level | Speed    | Ratio    | Recommendation                            |
| ----- | -------- | -------- | ----------------------------------------- |
| 0     | Fastest  | Largest  | Files over 100 MB, real-time workflows    |
| 1     | Fast     | Good     | Default; general-purpose use              |
| 5     | Moderate | Better   | Archival of medium-sized datasets         |
| 11    | Slowest  | Smallest | Small files under 1 MB, long-term storage |

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

| Platform | Architecture          | Binary Name                                      |
| -------- | --------------------- | ------------------------------------------------ |
| Linux    | x86_64                | `libroxify_native-x86_64-unknown-linux-gnu.node` |
| macOS    | x86_64                | `libroxify_native-x86_64-apple-darwin.node`      |
| macOS    | ARM64 (Apple Silicon) | `libroxify_native-aarch64-apple-darwin.node`     |
| Windows  | x86_64                | `roxify_native-x86_64-pc-windows-msvc.node`      |

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

| Module              | Responsibility                                                         |
| ------------------- | ---------------------------------------------------------------------- |
| `core.rs`           | Pixel scanning, CRC32, Adler32, delta coding, Zstd compress/decompress |
| `encoder.rs`        | PNG payload encoding with marker pixels and metadata chunks            |
| `packer.rs`         | Directory tree serialization and streaming deserialization             |
| `crypto.rs`         | AES-256-GCM encryption and PBKDF2 key derivation                       |
| `archive.rs`        | Tar-based archiving with optional Zstd compression                     |
| `reconstitution.rs` | Screenshot detection and automatic crop to recover encoded data        |
| `audio.rs`          | WAV container encoding and decoding (PCM byte packing)                 |
| `bwt.rs`            | Parallel Burrows-Wheeler Transform                                     |
| `rans.rs`           | rANS (Asymmetric Numeral Systems) entropy coder                        |
| `hybrid.rs`         | Block-based orchestration of BWT, context mixing, and rANS             |
| `pool.rs`           | Buffer pooling and zero-copy memory management                         |
| `image_utils.rs`    | Image resizing, pixel format conversion, metadata extraction           |
| `png_utils.rs`      | Low-level PNG chunk read/write operations                              |
| `progress.rs`       | Progress tracking for long-running compression/decompression           |
| `streaming_encode.rs` | Streaming directory-to-PNG encoder with real-time progress           |
| `streaming_decode.rs` | Streaming PNG-to-directory decoder with real-time progress           |

### TypeScript Modules

| Module            | Responsibility                                                        |
| ----------------- | --------------------------------------------------------------------- |
| `ecc.ts`          | Reed-Solomon GF(256) codec, block ECC, interleaving                   |
| `robust-audio.ts` | MFSK audio modulation/demodulation, Goertzel detection, sync preamble |
| `robust-image.ts` | QR-code-like block encoding, finder patterns, majority voting         |
| `encoder.ts`      | High-level encoding orchestration (standard + lossy-resilient)        |
| `decoder.ts`      | High-level decoding with automatic format detection                   |
| `audio.ts`        | Standard WAV container (8-bit PCM)                                    |
| `helpers.ts`      | Delta coding, XOR cipher, palette generation                          |
| `zstd.ts`         | Parallel Zstd compression via native module                           |

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

| Error                       | Cause                                             |
| --------------------------- | ------------------------------------------------- |
| `Incorrect passphrase`      | Wrong password provided for decryption            |
| `not a valid PNG`           | Input buffer is not a PNG or lacks Roxify markers |
| `Passphrase required`       | File is encrypted but no passphrase was supplied  |
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

This project is licensed under the **Roxify Proprietary Open Source License (RPOSL)**. The source code is freely available for personal, educational, and research use. All commercial rights are exclusively reserved to the author. See [LICENSE](LICENSE) for details.

---

## Links

- [npm Package](https://www.npmjs.com/package/roxify)
- [GitHub Repository](https://github.com/RoxasYTB/roxify)
- [Issue Tracker](https://github.com/RoxasYTB/roxify/issues)
- [CLI Documentation](./docs/CLI.md)
- [JavaScript SDK Reference](./docs/JAVASCRIPT_SDK.md)
- [Cross-Platform Build Guide](./docs/CROSS_PLATFORM.md)
- [Lossy Resilience Guide](./docs/LOSSY_RESILIENCE.md)
