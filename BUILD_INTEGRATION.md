# Roxify - Build Process for Pyxelze Integration

## Complete Build Process

### 1. Build Rust CLI Binary for Windows

```bash
cd /home/yohan/roxify
cargo build --release --bin roxify_native --target x86_64-pc-windows-gnu
```

### 2. Compile TypeScript and Copy Binary

```bash
npm run build
node scripts/copy-cli-binary.js
```

This will:

- Compile TypeScript sources to `dist/`
- Copy `target/x86_64-pc-windows-gnu/release/roxify_native.exe` to `dist/roxify_native.exe`

### 3. Build pkg Executable (Optional - only needed for standalone rox.exe)

```bash
npm run build:pkg
```

This creates `dist/rox.exe` which is a standalone executable that includes:

- Node.js runtime
- All TypeScript compiled code (dist/\*_/_.js)
- The Rust CLI binary (dist/roxify_native.exe) as an asset

### 4. Update Pyxelze Tools

Copy updated files to Pyxelze:

```bash
cp -r /home/yohan/roxify/dist/* /home/yohan/partage_vm/Pyxelze-Light/Pyxelze/tools/roxify/dist/
```

### 5. Rebuild Pyxelze Release

```bash
cd /home/yohan/partage_vm/Pyxelze-Light/Pyxelze
wine cmd /c make_release.cmd
```

This copies `tools/roxify/dist/*` to `release/roxify/`.

### 6. Build Pyxelze Installer

```bash
cd /home/yohan/partage_vm/Pyxelze-Light/Pyxelze
wine cmd /c build_production.cmd
```

## Binary Detection Logic

The `findRustBinary()` function searches for the Rust CLI binary in this order:

1. **pkg/snapshot environment**:

   - `C:\snapshot\roxify\..\..\target\release\roxify_native.exe`
   - `C:\snapshot\roxify\..\target\release\roxify_native.exe`
   - `C:\snapshot\roxify\target\release\roxify_native.exe`

2. **Standard locations** (when dist/utils is moduleDir):

   - `dist/utils/roxify_native.exe`
   - `dist/roxify_native.exe` ← **PRIMARY LOCATION**
   - `roxify_native.exe` (parent of dist)
   - `../../../../roxify_native.exe` (for node_modules structure)

3. **Development**:
   - `../../target/release/roxify_native.exe`

## File Structure After Build

```
roxify/
  dist/
    cli.js                    # TypeScript CLI entry point
    rox.exe                   # pkg bundled standalone (optional)
    roxify_native.exe         # Rust CLI binary ← REQUIRED
    libroxify_native.node     # Node.js native module
    utils/
      rust-cli-wrapper.js     # Wrapper that calls roxify_native.exe
      ...
  target/
    x86_64-pc-windows-gnu/
      release/
        roxify_native.exe     # Original Rust binary
```

## Quick Rebuild Script

For rapid iteration during development:

```bash
cd /home/yohan/roxify
cargo build --release --bin roxify_native --target x86_64-pc-windows-gnu && \
  npm run build && \
  node scripts/copy-cli-binary.js && \
  cp -r dist/* /home/yohan/partage_vm/Pyxelze-Light/Pyxelze/tools/roxify/dist/ && \
  cd /home/yohan/partage_vm/Pyxelze-Light/Pyxelze && \
  wine cmd /c make_release.cmd
```
