# Release 1.4.1 - Performance and Integrity Improvements

**Roxify 1.4.1** focuses on performance tuning and ensuring full data integrity for multi-file archives, while keeping a balanced default compression level for speed.

Highlights

- **Default compression level adjusted to 12** for a balanced trade-off between speed and size (fast, good compression).
- **No implicit filtering**: all files are included by default (users requested full integrity).
- **PNG reconversion kept but disabled for aggressive format changes** to avoid slow external conversions during normal workflows.
- **Improved multi-file packer behavior** and file-list metadata inclusion fixes (reliably emits `rXFL`).
- **Performance**: large directory pack/encode significantly faster with multi-threaded I/O and careful defaults.

Upgrade

```bash
npm install -g roxify@1.4.1
```

Notes

- If you need maximum compression regardless of speed, you can still use higher zstd levels via `--level`.
- If you need to force TypeScript encoder (for legacy behavior or specific encryption), use `--force-ts`.
