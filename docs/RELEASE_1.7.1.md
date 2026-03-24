# Roxify v1.7.1 — Cross-Platform Native Module Fix

**Release Date**: 2026-03-04

## Summary

This release fixes the critical issue where the native Rust module shipped in the npm package was always a Linux binary, causing `ERR_DLOPEN_FAILED` on Windows and macOS. Roxify now ships platform-specific native binaries for **all major OS and architectures**.

## What Changed

### Bug Fix: Native Module Loading

The previous release shipped a single `roxify_native.node` file that was always compiled for Linux x86_64. When installed on Windows or macOS, Node.js would fail to load it:

```
Error: roxify_native.node is not a valid Win32 application.
```

### New: Platform-Specific Binaries

Each binary is now named with its Rust target triple:

| Platform | File |
|---|---|
| Linux x64 | `roxify_native-x86_64-unknown-linux-gnu.node` |
| Linux ia32 | `roxify_native-i686-unknown-linux-gnu.node` |
| Linux ARM64 | `roxify_native-aarch64-unknown-linux-gnu.node` |
| macOS x64 (Intel) | `roxify_native-x86_64-apple-darwin.node` |
| macOS ARM64 (Apple Silicon) | `roxify_native-aarch64-apple-darwin.node` |
| Windows x64 | `roxify_native-x86_64-pc-windows-msvc.node` |
| Windows ia32 | `roxify_native-i686-pc-windows-msvc.node` |
| Windows ARM64 | `roxify_native-aarch64-pc-windows-msvc.node` |

The module loader (`native.ts`) automatically detects the current OS + architecture and loads the correct binary. No user configuration needed.

### Updated CI/CD

- `build.yml` and `release.yml` GitHub Actions workflows now build on `ubuntu-latest`, `macos-latest`, and `windows-latest` with cross-compilation for ARM64 and ia32.
- The `release.yml` workflow includes a publish job that aggregates all native binaries and publishes to npm.

## Upgrade

```bash
npm install -g roxify@1.7.1
```
