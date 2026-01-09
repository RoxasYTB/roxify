# Changelog

## [1.2.10] - 2026-01-09

### Performance 🚀🚀

- **MASSIVE file packing speedup**: 18,750 files (660MB) now in **7 seconds** (was 18s)
- Parallelized file reading with `fs.promises.readFile()` and `Promise.all()` batching
- Batch size optimized to 1000 files per parallel read
- Improved buffer concatenation strategy (array accumulation + single concat)
- Added error handling for unreadable files during parallel reads

### Benchmarks

- Single file 1GB: 389ms (2.63 GB/s)
- Directory 18,750 files (660MB): **6.8s** (97 MB/s including I/O overhead)

## [1.2.9] - 2026-01-09

### Performance 🚀

- **EXTREME SPEED**: 1GB encode in 0.39s (**2.6 GB/s throughput**)
- Optimized PNG pixel copying from byte-by-byte loops to bulk Buffer.copy() operations
- Reduced PNG deflate overhead by using zlib level 0 (data already compressed with Zstd)
- Lowered large image threshold from 50M to 10M pixels for faster manual PNG generation
- Default Zstd compression level changed from 15 to 3 (much faster, still excellent ratio)

### Changed

- Added `compressionLevel` option to `EncodeOptions` (default: 3)
- Added `skipOptimization` option to disable zopfli PNG optimization
- CLI now disables PNG optimization by default for maximum speed

### Benchmarks

- 1KB: 14.77ms
- 100MB: 63.74ms (1.57 GB/s)
- 500MB: 203ms (2.46 GB/s)
- 1GB: 389ms (2.63 GB/s)

## [1.2.8] - 2026-01-09

### Added

- 🦀 **Native Rust acceleration** via N-API for extreme performance
  - Delta encoding/decoding with Rayon parallelization
  - Multi-threaded Zstd compression (level 19) with `zstdmt` feature
  - Fast CRC32 and Adler32 checksums
  - Parallel pixel scanning for ROX1 magic and markers
- ⚡ **Performance improvements**: Up to 1GB/s throughput on modern hardware
  - 1GB encode: ~1.2s (863 MB/s)
  - 1GB decode: ~1.0s (1031 MB/s)
- 🔄 **Automatic fallback**: Pure TypeScript implementation when native module unavailable
- 📦 **Unified repository**: Rust and TypeScript code in single npm package

### Changed

- Switched from `@mongodb-js/zstd` to native Rust zstd for better performance
- Updated package description to highlight native acceleration
- Compression ratio improved to 0.01-0.05% with Zstd level 19

### Technical

- Added `build:native` and `build:all` npm scripts
- Native module compiled to `libroxify_native.node` (1.8MB)
- Cargo workspace configured with `native/` directory
- Updated dependencies: Rust crates (napi, rayon, zstd, crc32fast, adler)

## [1.0.4] - Previous release

- Initial TypeScript implementation
- Brotli compression
- Multiple encoding modes (compact, chunk, pixel, screenshot)
- AES-256-GCM encryption support
