# Building Roxify

## Prerequisites

- Node.js 18+ and npm
- Rust 1.70+ and Cargo (for native module)

## Development Build

```bash
# Install dependencies
npm install

# Build TypeScript only
npm run build

# Build native Rust module only
npm run build:native

# Build everything (Rust + TypeScript)
npm run build:all
```

## Publishing

```bash
# Prepare for publish (builds native + TS)
npm run prepublishOnly

# Create package tarball (dry-run)
npm pack --dry-run

# Publish to npm
npm publish
```

## Native Module Notes

- The native module (`libroxify_native.node`) is compiled from Rust sources in `native/`
- It provides 10-50x performance improvement over pure JavaScript
- If the native module is not available, Roxify falls back to pure TypeScript
- Platform-specific builds may be needed for cross-platform distribution

## Platform Support

Currently, the native module is built for:

- Linux x86_64 (tested on Debian)

For other platforms, users will get the pure TypeScript implementation (still fast, just not native-fast).

## Testing

```bash
# Run integration tests
npm test

# Benchmark native module
node test/benchmark-native.js

# Quick native module test
node test-native.cjs
```
