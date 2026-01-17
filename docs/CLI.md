# CLI Documentation

Complete guide for using RoxCompressor from the command line.

## Installation

No installation required! Use directly with `npx`:

```bash
npx rox help
```

Or install globally:

```bash
npm install -g roxify
rox help
```

## Commands

### `encode` - Convert file to PNG

Encode any file into a PNG image with optional compression and encryption.

```bash
npx rox encode <input> [output] [options]
```

#### Arguments

- `<input>` (required) - Input file path
- `[output]` (optional) - Output PNG path (default: `<input>.png`)

#### Options

| Option                | Alias | Description             | Default               |
| --------------------- | ----- | ----------------------- | --------------------- |
| `--passphrase <pass>` | `-p`  | Encrypt with passphrase | None                  |
| `--mode <mode>`       | `-m`  | Encoding mode           | `screenshot`          |
| `--quality <0-11>`    | `-q`  | Compression quality     | `1`                   |
| `--encrypt <type>`    | `-e`  | Encryption method       | `aes` (if passphrase) |
| `--no-compress`       |       | Disable compression     | `false`               |
| `--output <path>`     | `-o`  | Output file path        | Auto                  |

#### Modes

- **`screenshot`** (recommended) - Optimized for visual appearance, balanced size/speed
- **`compact`** - Minimal 1x1 PNG, fastest and smallest
- **`pixel`** - Encode as RGB pixels
- **`chunk`** - Standard PNG with custom chunk

#### Quality Levels

| Quality | Speed     | Size    | Use Case                 |
| ------- | --------- | ------- | ------------------------ |
| `0`     | Fastest   | Largest | Real-time, >50 MB files  |
| `1`     | Very Fast | Good    | **Default, recommended** |
| `5`     | Medium    | Better  | Balanced                 |
| `11`    | Slowest   | Best    | Archival, <1 MB files    |

#### Examples

**Basic encoding:**

```bash
npx rox encode document.pdf
# Output: document.pdf.png
```

**Custom output name:**

```bash
npx rox encode report.docx output.png
```

**Fast compression (large files):**

```bash
npx rox encode video.mp4 video.png -q 0
```

**Best compression (small files):**

```bash
npx rox encode config.json config.png -q 11 -m compact
```

**With encryption:**

```bash
npx rox encode secret.zip secure.png -p "my password"
```

**Multiple files (batch):**

```bash
for file in *.jpg; do npx rox encode "$file" "${file}.png"; done
```

---

### `decode` - Convert PNG back to file

Decode a RoxCompressor PNG back to the original file.

```bash
npx rox decode <input> [output] [options]
```

#### Arguments

- `<input>` (required) - Input PNG file
- `[output]` (optional) - Output file path (auto-detected from metadata if omitted)

#### Options

| Option                | Alias | Description           |
| --------------------- | ----- | --------------------- |
| `--passphrase <pass>` | `-p`  | Decryption passphrase |
| `--output <path>`     | `-o`  | Output file path      |

#### Examples

**Basic decoding:**

```bash
npx rox decode encoded.png
# Auto-detects filename from metadata
```

**Custom output:**

```bash
npx rox decode encoded.png output.bin
```

**With decryption:**

```bash
npx rox decode encrypted.png -p "my password"
```

**Batch decode:**

```bash
for file in *.png; do npx rox decode "$file"; done
```

---

### `help` - Show help

```bash
npx rox help
```

### `version` - Show version

```bash
npx rox version
```

---

## Usage Scenarios

### 1. Quick File Sharing

Encode a file for easy sharing:

```bash
# Encode
npx rox encode presentation.pptx share.png

# Share share.png (looks like an image!)

# Recipient decodes
npx rox decode share.png
# Output: presentation.pptx
```

### 2. Encrypted Backups

Create encrypted backups:

```bash
# Backup with encryption
npx rox encode important.zip backup.png -p "secure-password"

# Restore backup
npx rox decode backup.png restored.zip -p "secure-password"
```

### 3. Large File Compression

Compress large files efficiently:

```bash
# Fast compression for 100 MB file
npx rox encode large-video.mp4 video.png -q 0

# Typical result: 100 MB → 30 MB in ~2 seconds
```

### 4. Archive Multiple Files

Archive and compress:

```bash
# Create archive
tar -czf archive.tar.gz folder/

# Encode to PNG
npx rox encode archive.tar.gz archive.png

# Later: decode and extract
npx rox decode archive.png archive.tar.gz
tar -xzf archive.tar.gz
```

### 5. Batch Processing

Process multiple files:

**Linux:**

```bash
#!/bin/bash
for file in documents/*; do
  echo "Encoding $file..."
  npx rox encode "$file" "encoded/$(basename "$file").png" -q 1
done
```

**Windows (PowerShell):**

```powershell
Get-ChildItem documents\* | ForEach-Object {
  Write-Host "Encoding $($_.Name)..."
  npx rox encode $_.FullName "encoded\$($_.Name).png" -q 1
}
```

### 6. Steganography

Hide data in screenshot-like PNGs:

```bash
npx rox encode secret.txt screenshot.png -m screenshot
# Result looks like a real screenshot!
```

---

## Performance Tips

### For Large Files (>10 MB)

Use quality `0` for fastest encoding:

```bash
npx rox encode largefile.bin output.png -q 0
```

**Benchmark (100 MB file):**

- Quality 0: ~2 seconds
- Quality 1: ~10 seconds
- Quality 5: ~80 seconds

### For Small Files (<1 MB)

Use quality `11` and `compact` mode:

```bash
npx rox encode config.json config.png -q 11 -m compact
```

### For Maximum Speed

Disable compression (not recommended):

```bash
npx rox encode file.bin output.png --no-compress
```

---

## Troubleshooting

### "Module not found" Error

**Solution:** Ensure you're using Node.js 14+ and have internet access for npx.

```bash
node --version  # Should be >= 14.0.0
```

### "Incorrect passphrase" Error

**Solution:** Double-check your passphrase. Encryption is case-sensitive.

```bash
# Make sure passphrase matches exactly
npx rox decode file.png -p "correct password"
```

### Large File Performance

**Problem:** Encoding takes too long

**Solution:** Lower quality setting:

```bash
# Before (slow)
npx rox encode large.bin output.png -q 5

# After (fast)
npx rox encode large.bin output.png -q 0
```

### Output Size Too Large

**Problem:** PNG is larger than expected

**Solution:**

1. Increase quality: `-q 11`
2. Use compact mode: `-m compact`
3. Try encryption: `-e auto`

```bash
npx rox encode file.bin output.png -q 11 -m compact -e auto
```

---

## Advanced Usage

### Pipeline Integration

**Compress and encode in one command:**

```bash
tar -czf - folder/ | npx rox encode - archive.png
```

**Decode and extract:**

```bash
npx rox decode archive.png - | tar -xzf -
```

### Environment Variables

Set default options:

```bash
# Linux
export ROX_QUALITY=1
export ROX_MODE=screenshot

# Windows (PowerShell)
$env:ROX_QUALITY=1
$env:ROX_MODE="screenshot"
```

### Script Integration

**Node.js script:**

```javascript
import { execSync } from 'child_process';

const result = execSync('npx rox encode input.bin output.png -q 1', {
  encoding: 'utf-8',
});

console.log(result);
```

**Python script:**

```python
import subprocess

result = subprocess.run([
    'npx', 'rox', 'encode',
    'input.bin', 'output.png', '-q', '1'
], capture_output=True, text=True)

print(result.stdout)
```

---

## Comparison with Other Tools

| Feature           | RoxCompressor | gzip    | zip     | 7z      |
| ----------------- | ------------- | ------- | ------- | ------- |
| Format            | PNG           | .gz     | .zip    | .7z     |
| Visual            | ✅            | ❌      | ❌      | ❌      |
| Encryption        | AES-256-GCM   | ❌      | AES-256 | AES-256 |
| Compression       | Brotli        | DEFLATE | DEFLATE | LZMA2   |
| Ratio (typical)   | 20-30%        | 30-40%  | 30-40%  | 15-25%  |
| Speed (quality 1) | Fast          | Fast    | Fast    | Slow    |

---

## FAQ

**Q: Can I encode any file type?**
A: Yes! Any file can be encoded (documents, videos, executables, etc.)

**Q: Is the encoding lossless?**
A: Yes, decoding produces exactly the original file.

**Q: How secure is AES encryption?**
A: AES-256-GCM is military-grade encryption with 100,000 PBKDF2 iterations.

**Q: Can I view the PNG in an image viewer?**
A: Yes, in `screenshot` mode the PNG appears as a normal image. Other modes create minimal PNGs that may not display properly.

**Q: What's the maximum file size?**
A: Limited only by available RAM. Tested up to 500 MB.

**Q: Does it work offline?**
A: Yes, after initial npx download, it works offline.

---

## Support

- 📖 [Full Documentation](https://github.com/RoxasYTB/roxify)
- 📘 [JavaScript SDK](./JAVASCRIPT_SDK.md)
- 🐛 [Report Issues](https://github.com/RoxasYTB/roxify/issues)
- 💬 [Discussions](https://github.com/RoxasYTB/roxify/discussions)

---

## License

MIT © RoxCompressor
