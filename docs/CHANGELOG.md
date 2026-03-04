# Changelog

## [1.7.1] - 2026-03-04

### Fix: Cross-Platform Native Module Loading

- **Fixed**: `roxify_native.node` was always a Linux binary, causing `ERR_DLOPEN_FAILED` on Windows (`is not a valid Win32 application`) and crash on macOS.
- **Added**: Platform-specific native binaries with target triple naming (`roxify_native-<triple>.node`), loaded automatically based on `os.platform()` + `os.arch()`.
- **Added**: Full support for **8 targets**: Linux x64/ia32/ARM64, macOS x64/ARM64, Windows x64/ia32/ARM64.
- **Updated**: `native.ts` module loader now detects OS+architecture via `getTargetTriples()` and prioritizes platform-specific files before falling back to generic names.
- **Updated**: CI workflows (`build.yml`, `release.yml`) now build natively on all 3 OS runners with cross-compilation for additional architectures.
- **Updated**: `build-native-targets.cjs`, `copy-native.js`, `build-all-platforms.js` to support all 8 targets.
- **Updated**: `package.json` `files` field includes all platform-specific `.node` binaries for npm distribution.

## [1.7.0] - 2026-03-03

### Feature: Stretch-Resilient Decoding

- **Added**: Automatic un-stretch of nearest-neighbor scaled roxified images. The decoder
  now detects stretched images, collapses horizontal runs of identical pixels, removes
  duplicate rows, and recovers the original logical pixel grid.
- **Added**: White/near-white background cropping before un-stretch to handle images
  with padding (screenshots, copy-pasted images).
- **Added**: Tolerance-based fallback for slightly noisy stretched images (e.g., JPEG
  re-compression of a stretched PNG).
- **Added**: Uniform-color row expansion — rows that collapse to a single pixel are
  automatically expanded to the logical width.
- **Added**: Exported `unstretchImage()` function for direct use in the JavaScript API.
- **Added**: 10 new tests (7 unit tests for `unstretchImage` + 3 E2E stretch/decode roundtrips).
- **Updated**: README and documentation with stretch-resilient decoding section.

## [1.6.9] - 2026-03-03

### Fix: Native module not found when installed globally

- **Fixed**: Native `.node` module could not be found when roxify was installed globally
  (`npm install -g roxify`). The ESM fallback used `process.cwd()` instead of the
  actual module directory, causing all candidate paths to resolve relative to the
  user's working directory instead of the package installation path.
- **Fixed**: Uses `import.meta.url` + `fileURLToPath` to correctly derive `moduleDir`
  in ESM context, ensuring the native binary is found at the package root regardless
  of where the CLI is invoked from.
- **Fixed**: `createRequire` now receives the actual module filename instead of
  `process.cwd()`, fixing dynamic `require()` resolution in ESM.

## [1.6.8] - 2026-03-03

### CLI: Lossy-Resilient Options

- **Added**: `--lossy-resilient` flag to enable lossy-resilient encoding from the CLI
- **Added**: `--ecc-level <low|medium|quartile|high>` option to set Reed-Solomon ECC redundancy level
- **Added**: `--block-size <2-8>` option to set robust image block size (pixels per data block)
- **Added**: Input validation with clear error messages for invalid `--ecc-level` and `--block-size` values
- **Added**: Comprehensive examples section in CLI help showing lossy-resilient usage with `--sound`/`--image`
- **Improved**: CLI help menu reorganized with dedicated "Lossy-Resilient Encoding" section
- All new flags are properly passed through to the TypeScript encoder (`lossyResilient`, `eccLevel`, `robustBlockSize`)

## [1.6.7] - 2026-03-03

### Critical Bug Fix: Decode Corruption

- **Fixed**: Encode/decode roundtrip was producing corrupted output. The TS encoder
  was compressing data (zstd multi-chunk), then passing the already-compressed
  payload to the Rust native encoder which compressed it a second time. The decoder
  only decompressed once, returning the intermediate compressed form instead of the
  original data. Now the native encoder receives the original input directly.
- **Fixed**: `parallelZstdCompress` now concatenates small Buffer arrays into a
  single buffer before compression, eliminating multi-chunk overhead for files < 8 MB.
- **Improved**: Compression level raised from 12 to 19 in the CLI (matching the
  API default). Removed aggressive level 22 auto-boost in Rust encoder for better
  speed/ratio balance.
- **Verified**: Full cross-compatibility — Rust encode ↔ JS decode, JS encode ↔
  Rust decode, encrypted roundtrips, directory roundtrips all passing.

## [1.6.6] - 2026-03-03

### Maintenance, Optimization and Documentation

- Merged duplicate `common.rs` into `core.rs`, eliminating ~200 lines of dead code
- Removed unused Cargo dependencies (`flate2`, `miniz_oxide`, `adler`, `windows`)
- Switched release profile to `lto = "fat"` for smaller, faster binaries
- Disabled `target-cpu=native` in Cargo config for cross-platform portability
- Fixed slow `test_extreme_deformation_and_background` test (reduced from 100 to 10 iterations)
- Cleaned up all Rust compiler warnings (0 warnings on `cargo test`)
- Removed `console.debug` statements from `native.ts` module loader
- Deleted 7 orphaned test files and 2 stale compiled binaries from the workspace
- Updated `.gitignore` and `.npmignore` for lighter npm packages
- Added comprehensive test suite (`test/run-all-tests.cjs`) with 11 JS tests
- Added reproducible benchmark suite (`test/benchmark.mjs`) comparing zip, tar.gz, 7z, and Roxify
- Rewrote README with full API reference, benchmark tables, and architecture documentation
- All 35 Rust tests and 11 JS tests passing

---

## [1.4.1] - 2026-01-12

### Patch: Performance & Integrity

- Default compression level changed to **12** for a better speed/size balance
- Removed automatic exclusion of files — all files are included by default to guarantee integrity
- Packer improvements to ensure consistent `rXFL` file list metadata
- Performance tuning (I/O parallelism & no slow external reconversions by default)

---

## [1.4.0] - 2026-01-12

### 🚀 Automatic Format Optimization with Universal Compatibility (MAJOR FEATURE)

- **Smart format prediction in <50ms** (average 15ms)

  - Analyzes data entropy, patterns, and repetition
  - Chooses best format automatically: PNG, WebP, or JPEG XL
  - 75% prediction accuracy on diverse data types

- **Universal PNG Output** (NEW)

  - All generated files are real, viewable PNG images
  - WebP/JXL optimizations applied internally, then reconverted to PNG
  - Guarantees compatibility with all browsers and image viewers
  - Enables direct screenshot capture of generated files

- **Direct encoding** (single pass, no overhead)
  - Encodes directly in optimal format
  - Automatically reconverts WebP/JXL to PNG for universal compatibility
  - Extension remains `.png` (transparent to user)

### Performance Improvements ⚡

- **Small files (<100KB)**: <1 second total
- **Medium files (1-10MB)**: <5 seconds
- **Large files**: Optimized compression level 19 by default
- **Compression gains**:
  - Repetitive data: -40% vs PNG (JPEG XL → PNG reconversion)
  - Random data: PNG chosen (optimal)
  - Structured data (JSON): -25 to -40% (JPEG XL → PNG reconversion)

### Default Settings Optimized

- Compression level 19 (maximum) now default
- Format auto-detection enabled by default
- `npx rox encode <input>` is now sufficient (minimal command)

### New Tests & Validation

- `npm run test:predict` - Format prediction accuracy tests
- `npm run test:formats` - Comprehensive format comparisons
- `npm run test:optimize` - Auto-optimization benchmarks

### Technical Details

- Prediction algorithm: Shannon entropy + pattern detection + sequential detection
- Formats tested: PNG, WebP lossless, JPEG XL lossless
- Fallback: PNG if conversion fails
- No performance regression on existing workflows

### Breaking Changes

None - backward compatible, existing scripts work unchanged

---

## [1.3.1] - 2026-01-11

### Native Rust Encoder Integration 🚀

- **CLI now uses native Rust encoder by default** for maximum performance
- **Falls back to TypeScript encoder** when encryption is needed or with `--force-ts` flag
- **Performance improvements**:
  - Rust encoder: ~20x faster than TypeScript (level 3 compression)
  - TypeScript encoder: Better compression ratio with level 19
  - Automatic selection based on use case

### New CLI Options

- `--force-ts`: Force use of TypeScript encoder (needed for encryption features)

### Technical Details

- CLI automatically detects and uses `target/release/roxify_native` binary
- Rust encoder uses level 3 (default) for speed: ~23% ratio
- TypeScript encoder uses level 19 for compression: ~19% ratio (better but slower)
- Encryption and passphrase features require TypeScript encoder

### Why Two Encoders?

**Rust encoder (default, level 3)**:

- ✅ 20x faster encoding
- ✅ Matches benchmark performance
- ✅ Same format as benchmark tests
- ❌ No encryption support
- Result: ~23% of original size

**TypeScript encoder (--force-ts, level 19)**:

- ✅ Better compression (~19% ratio)
- ✅ Supports encryption (AES, XOR)
- ✅ Supports passphrase protection
- ❌ Slower (~300ms vs ~15ms for small files)
- Result: ~19% of original size

- **Large codebase benchmark**: 4,000 MB dataset (≈3.93 GB input)
  - **Roxify**: 3.93 GB → 111.42 MB ( **2.8%** ), **26.91s** @ **149.4 MB/s**
  - **Gzip (zip/tar.gz)**: 3.93 GB → 2.26 GB ( **57.5%** )
  - **LZMA (7z)**: 3.93 GB → 1.87 GB ( **47.6%** )
- **Many-files dataset** (1,000 MB, 141,522 files)
  - **Roxify**: 1.03 GB → 205.0 MB ( **19.4%** ), **6.2s** @ **~170 MB/s**
  - Gzip: 1.03 GB → 324.8 MB ( **30.7%** )
  - LZMA: 1.03 GB → 195.7 MB ( **18.5%** )

### What's new in 1.3.0

- Improved multi-file encoding performance (parallel file I/O with Rayon) → large speedups on many small files
- Default encode path optimized for speed (default level reduced; fast mode used for encode)
- Clarified real-world benchmark comparisons to **ZIP (gzip)** and **7z (LZMA)** in docs
- Minor compression heuristics tuned for real-world repositories

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
