# Changelog

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
