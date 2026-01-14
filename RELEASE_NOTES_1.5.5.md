# Release Notes 1.5.5

## Fixes

- Fixed Windows native module loading to support both `x86_64-pc-windows-gnu` and `x86_64-pc-windows-msvc` builds
- Added explicit `.node` extension search for Windows binaries
- Improved cross-platform native module detection with fallback support

## Changes

- Updated `src/utils/native.ts` to support multiple Windows build targets
- Package now includes pre-built Windows native module (`libroxify_native.node`)

## Compatibility

- Windows: Both MinGW (`x86_64-pc-windows-gnu`) and MSVC (`x86_64-pc-windows-msvc`) builds supported
- Linux: `x86_64-unknown-linux-gnu` (unchanged)
- macOS: ARM64 and x64 (unchanged)

## For Pyxelze Integration

This version ensures that the Windows installer will correctly load and use the native Rust module for maximum performance.
