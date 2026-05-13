## v1.15.1 — Major encode speedup + RAM/MT fixes + backward-compat decode

### Performance: stored deflate IDAT (biggest win)

The IDAT path no longer runs `image::DynamicImage::write_to(... ImageFormat::Png)`
under the hood, which was a single-threaded zlib level 6 pass over ~all
the zstd-compressed payload (incompressible data — every cycle spent
matching was wasted). `StoredDeflateWriter` now emits raw deflate stored
blocks (BTYPE=00) with an incremental simd-adler32 checksum.

Measured baseline on this machine (v1.14.8, 180 MB incompressible
encode): **29.6 MB/s steady-state, ~0.78 cores out of 12 used.** The
new path should be I/O-bound (3-10× faster) and let the MT pool of
zstd actually saturate the CPU.

### RAM budget rewrite (was capped at 1 GB silently)

`parse_total_ram_mb` on Windows was hardcoded to `Some(8192)` —
ignored real system RAM. Now reads it via `GlobalMemoryStatusEx`.

`auto_ram_budget_mb` was running the Linux-only
`parse_linux_mem_available_mb` on Windows (which returns None there),
falling back to `total/2`, then applying a tier multiplier, then
flooring at 1 GB. End result: on machines with > 8 GB RAM, the budget
was sometimes pinned to 1 GB.

New rule: budget = `total_ram - 4 GB` (reserve 4 GB for the OS,
matches the user's "garder 3–4 GB pour le PC" requirement). On 16 GB →
12 GB budget. On 32 GB → 28 GB. On 8 GB → 4 GB. Floored at MIN (1 GB).

### Multi-threading: backwards condition fixed

`select_zstd_threads` had:
`} else if total_bytes <= 256 * MB || ram_mb >= 8192 {`
which **capped zstd workers at 4 as soon as RAM ≥ 8 GB**, regardless of
input size — exactly backwards from what you want on a big machine.

Replaced with a simple input-size ramp: 16 MB → 1 thread,
64 MB → 2, 256 MB → 4, 1 GB → 8, 1 GB+ → up to 16. Same shape on
Linux and Windows (the cross-platform split was useless).

Also: `encoder.multithread(N)` failures used to be silently swallowed.
They now print a warning on stderr — so if `zstdmt` ever isn't
compiled in, you see it instead of mysteriously falling back.

### Compression unlock

The directory encode path was hard-capping the zstd level at 3
regardless of the CLI `--level` flag. Now respects the user's value
(clamped to the valid zstd range 1..=22), so `rox encode dir
--level 19` actually produces a higher-ratio file. Default remains 3.

`set_pledged_src_size` is now passed to the zstd encoder so it can
plan its strategy (LDM decisions, tables) up-front.

Files in the directory are sorted by extension + name before being
streamed into the zstd frame. Same-type files (`.js`, `.png`,
`.json`) end up adjacent so zstd's long-distance matcher finds
cross-file redundancy. Free ratio improvement.

`estimate_zst_capacity` bumped from `total/3` to `total/2` — fewer
`Vec` re-allocations on incompressible data.

### Backward-compat decode (strict)

The decoder accepts both wire layouts:

- **Clean layout** (v1.15.0+, single-file path of v1.14.x):
  `MARKER_START(9) | MARKER_ZSTD(3) | PXL1(4) | meta_header | ...`
- **Legacy v1.14.x directory-encode buggy layout** (the one your
  existing `Projets.png` has):
  `PXL1(4) | payload_len(4) | MARKER_START(9) | MARKER_ZSTD(3) | PXL1(4) | meta_header | ...`

`PXL1` is checked at exactly offset 12 (clean) or offset 20 with a
matching prefix at offset 0 (legacy). No open-ended scan — a filename
starting with `PXL1` cannot trigger a false positive.

`core::zstd_decompress_bytes` (fallback path) now always sets
`window_log_max(31)` — fixes "Frame requires too much memory for
decoding" on > 1 GB payloads.

### CI

Added `cargo test -p roxify_native --release` to `ci.yml`. The 11
unit tests (6 new ones for `StoredDeflateWriter`, 2 for
`ScanlineFilterWriter`, 1 for `file_extension`, plus the existing 2
PNG ones) now run on every push.

### Files

- `native/streaming_encode.rs` — `StoredDeflateWriter`, MT fix,
  capacity tweak, level unlock, extension sort, pledged size
- `native/streaming_decode.rs` — strict 2-position PXL1 check
- `native/main.rs` — Windows total-RAM via `GlobalMemoryStatusEx`,
  new `auto_ram_budget_mb` formula (`total - 4 GB`)
- `native/core.rs` — `window_log_max(31)` (carried from 1.15.0)
- `.github/workflows/ci.yml` — cargo test step
