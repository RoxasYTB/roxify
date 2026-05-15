use cipher::{KeyIvInit, StreamCipher};
use flate2::read::ZlibDecoder;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

const PIXEL_MAGIC: &[u8] = b"PXL1";
const HEADER_VERSION_V1: u8 = 1;
const HEADER_VERSION_V2: u8 = 2;

type Aes256Ctr = ctr::Ctr64BE<aes::Aes256>;

/// RAM budget set by main.rs at CLI startup (MiB). Fallback 2 GiB.
fn effective_budget_mb() -> u64 {
    std::env::var("ROX_RAM_BUDGET_MB_EFFECTIVE")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(2048)
}

/// Per-output-file BufWriter capacity, sized for the RAM budget.
/// Bumped from budget/32 to budget/24 in 1.16.5 — bigger buffers reduce
/// syscall count on huge files and give the OS more freedom to coalesce
/// I/O. Floored at 16 MiB so small budgets still get a useful buffer.
fn decode_writer_capacity() -> usize {
    let mb = (effective_budget_mb() / 24).max(16);
    (mb * 1024 * 1024) as usize
}

/// Intermediate decompression read buffer. The zstd decoder is fed
/// in chunks of this size — bigger = fewer iterations + better SIMD
/// utilization at the cost of RAM. Bumped budget/128 → budget/96 in
/// 1.16.5 (≈ +33% buffer on a given budget).
fn decode_read_buffer_size() -> usize {
    let mb = (effective_budget_mb() / 32).max(16);
    (mb * 1024 * 1024) as usize
}

pub type DecodeProgressCallback = Box<dyn Fn(u64, u64, &str) + Send>;

pub fn streaming_decode_to_dir(png_path: &Path, out_dir: &Path) -> Result<Vec<String>, String> {
    streaming_decode_selected_to_dir_encrypted_with_progress(png_path, out_dir, None, None, None)
}

pub fn streaming_decode_to_dir_encrypted(
    png_path: &Path,
    out_dir: &Path,
    passphrase: Option<&str>,
) -> Result<Vec<String>, String> {
    streaming_decode_selected_to_dir_encrypted_with_progress(
        png_path, out_dir, None, passphrase, None,
    )
}

pub fn streaming_decode_to_dir_encrypted_with_progress(
    png_path: &Path,
    out_dir: &Path,
    passphrase: Option<&str>,
    progress: Option<DecodeProgressCallback>,
) -> Result<Vec<String>, String> {
    streaming_decode_selected_to_dir_encrypted_with_progress(
        png_path, out_dir, None, passphrase, progress,
    )
}

pub fn streaming_decode_selected_to_dir_encrypted_with_progress(
    png_path: &Path,
    out_dir: &Path,
    files_opt: Option<&[String]>,
    passphrase: Option<&str>,
    progress: Option<DecodeProgressCallback>,
) -> Result<Vec<String>, String> {
    let mut meta_file = File::open(png_path).map_err(|e| format!("open: {}", e))?;
    let (width, height, idat_ranges, total_expected) = parse_png_metadata(&mut meta_file)?;

    if let Some(ref cb) = progress {
        cb(2, 100, "parsing_png");
    }

    if let Some(ref cb) = progress {
        cb(5, 100, "reading_header");
    }

    let data_file = File::open(png_path).map_err(|e| format!("open data: {}", e))?;
    let idat_reader = IdatRangeReader::new(data_file, idat_ranges)
        .map_err(|e| format!("init IDAT reader: {}", e))?;
    let zlib_decoder = ZlibDecoder::new(idat_reader);
    let mut reader = ScanlinePixelReader::new(zlib_decoder, width, height);

    // Rétrocompatibilité: deux layouts existent en pratique.
    //   - Format propre (v1.15.0+, et v1.14.x single-file path):
    //       offsets 0..11 = MARKER_START (9) + MARKER_ZSTD (3)
    //       offsets 12..15 = "PXL1"
    //       offsets 16.. = meta_header
    //   - Format legacy v1.14.x directory-encode (encodeur buggé): un préfixe
    //     "PXL1" + payload_len(4) avait été ajouté AVANT les markers, ce qui
    //     décale tout de 8 octets:
    //       offsets 0..3 = "PXL1" (parasite)
    //       offsets 4..7 = payload_len u32 BE (parasite)
    //       offsets 8..19 = markers
    //       offsets 20..23 = "PXL1" (le vrai)
    //       offsets 24.. = meta_header
    // On vérifie EXACTEMENT ces deux positions connues pour éviter un faux
    // positif si un nom de fichier contenait "PXL1" en tête.
    let mut head_buf = [0u8; 24];
    reader
        .read_exact(&mut head_buf)
        .map_err(|e| format!("read head: {}", e))?;

    let pxl1_end = if &head_buf[12..16] == PIXEL_MAGIC {
        16 // clean layout
    } else if &head_buf[20..24] == PIXEL_MAGIC && &head_buf[0..4] == PIXEL_MAGIC {
        24 // legacy v1.14.x directory-encode bug
    } else {
        return Err(format!(
            "Expected PXL1 at pixel offset 12 (clean) or 20 (legacy), got head {:?}",
            &head_buf[..16]
        ));
    };

    let leftover_prefix = head_buf[pxl1_end..].to_vec();
    let mut reader = std::io::Cursor::new(leftover_prefix).chain(reader);

    let mut hdr = [0u8; 2];
    reader
        .read_exact(&mut hdr)
        .map_err(|e| format!("read hdr: {}", e))?;
    let _version = hdr[0];
    let name_len = hdr[1] as usize;

    let payload_name: Option<String> = if name_len > 0 {
        let mut name_buf = vec![0u8; name_len];
        reader
            .read_exact(&mut name_buf)
            .map_err(|e| format!("read name: {}", e))?;
        Some(String::from_utf8_lossy(&name_buf).to_string())
    } else {
        None
    };

    let payload_len = read_payload_len(&mut reader, hdr[0])?;

    if let Some(ref cb) = progress {
        cb(8, 100, "decrypting");
    }

    let mut enc_byte = [0u8; 1];
    reader
        .read_exact(&mut enc_byte)
        .map_err(|e| format!("read first byte: {}", e))?;
    let remaining_payload_len = payload_len.saturating_sub(1);

    match enc_byte[0] {
        0x00 => {
            if let Some(ref cb) = progress {
                cb(10, 100, "decompressing");
            }
            let mut decoder =
                zstd::stream::Decoder::new(reader).map_err(|e| format!("zstd decoder: {}", e))?;
            // Forcer 31 pour éviter l'erreur "Frame requires too much memory"
            let _ = decoder.window_log_max(31);
            read_rox1_and_unpack_with_progress(
                decoder,
                out_dir,
                files_opt,
                progress,
                total_expected,
                payload_name.as_deref(),
            )
        }
        0x03 => {
            let pass = passphrase.ok_or("Passphrase required for AES-CTR decryption")?;
            let mut salt = [0u8; 16];
            let mut iv = [0u8; 16];
            let mut r = reader.take(remaining_payload_len);
            r.read_exact(&mut salt)
                .map_err(|e| format!("read salt: {}", e))?;
            r.read_exact(&mut iv)
                .map_err(|e| format!("read iv: {}", e))?;

            let key = crate::crypto::derive_aes_ctr_key(pass, &salt);
            let cipher = Aes256Ctr::new_from_slices(&key, &iv)
                .map_err(|e| format!("AES-CTR init: {}", e))?;

            let hmac_size = 32u64;
            let encrypted_data_len = remaining_payload_len - 16 - 16 - hmac_size;
            let ctr_reader = CtrDecryptReader::new(r.take(encrypted_data_len), cipher);

            if let Some(ref cb) = progress {
                cb(10, 100, "decompressing");
            }
            let mut decoder = zstd::stream::Decoder::new(ctr_reader)
                .map_err(|e| format!("zstd decoder: {}", e))?;
            // Forcer 31 pour éviter l'erreur "Frame requires too much memory"
            let _ = decoder.window_log_max(31);
            read_rox1_and_unpack_with_progress(
                decoder,
                out_dir,
                files_opt,
                progress,
                total_expected,
                payload_name.as_deref(),
            )
        }
        _ => Err(format!(
            "Unsupported encryption (enc=0x{:02x}) in streaming decode",
            enc_byte[0]
        )),
    }
}

fn read_payload_len<R: Read>(reader: &mut R, version: u8) -> Result<u64, String> {
    match version {
        HEADER_VERSION_V1 => {
            let mut plen_buf = [0u8; 4];
            reader
                .read_exact(&mut plen_buf)
                .map_err(|e| format!("read payload_len: {}", e))?;
            Ok(u32::from_be_bytes(plen_buf) as u64)
        }
        HEADER_VERSION_V2 => {
            let mut plen_buf = [0u8; 8];
            reader
                .read_exact(&mut plen_buf)
                .map_err(|e| format!("read payload_len64: {}", e))?;
            Ok(u64::from_be_bytes(plen_buf))
        }
        other => Err(format!("Unsupported header version {}", other)),
    }
}

fn read_rox1_and_unpack_with_progress<R: Read>(
    mut decoder: R,
    out_dir: &Path,
    files_opt: Option<&[String]>,
    progress: Option<DecodeProgressCallback>,
    total_expected: u64,
    payload_name: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut magic = [0u8; 4];
    decoder
        .read_exact(&mut magic)
        .map_err(|e| format!("read ROX1: {}", e))?;
    if &magic != b"ROX1" {
        return Err(format!("Expected ROX1, got {:?}", magic));
    }
    std::fs::create_dir_all(out_dir).map_err(|e| format!("mkdir: {}", e))?;

    let mut peek = [0u8; 4];
    let mut read_so_far = 0usize;
    while read_so_far < peek.len() {
        let n = decoder
            .read(&mut peek[read_so_far..])
            .map_err(|e| format!("peek magic: {}", e))?;
        if n == 0 {
            break;
        }
        read_so_far += n;
    }

    let peek_magic = if read_so_far == 4 {
        u32::from_be_bytes(peek)
    } else {
        0
    };

    let is_pack_magic = matches!(peek_magic, 0x524f5850 | 0x524f5856 | 0x524f5849);

    if is_pack_magic {
        let mut chained = std::io::Cursor::new(peek[..read_so_far].to_vec()).chain(decoder);
        return crate::packer::unpack_stream_to_dir(
            &mut chained,
            out_dir,
            files_opt,
            progress.as_deref(),
            total_expected,
        )
        .map_err(|e| format!("pack unpack: {}", e));
    }

    let name = payload_name.unwrap_or("file");
    let safe_name = sanitize_legacy_name(name);
    let should_write = match files_opt {
        Some(filter) => filter.iter().any(|f| f == &safe_name || f == name),
        None => true,
    };

    if !should_write {
        std::io::copy(&mut decoder, &mut std::io::sink())
            .map_err(|e| format!("drain legacy payload: {}", e))?;
        if let Some(cb) = progress {
            cb(100, 100, "done");
        }
        return Ok(Vec::new());
    }

    let dest = out_dir.join(&safe_name);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir parent: {}", e))?;
    }

    let file = std::fs::File::create(&dest).map_err(|e| format!("create {:?}: {}", dest, e))?;
    let mut writer = std::io::BufWriter::with_capacity(decode_writer_capacity(), file);

    writer
        .write_all(&peek[..read_so_far])
        .map_err(|e| format!("write legacy prefix: {}", e))?;

    let mut buf = vec![0u8; decode_read_buffer_size()];
    let mut written_bytes: u64 = read_so_far as u64;
    let mut last_pct: u64 = 10;
    loop {
        let n = decoder
            .read(&mut buf)
            .map_err(|e| format!("read legacy payload: {}", e))?;
        if n == 0 {
            break;
        }
        writer
            .write_all(&buf[..n])
            .map_err(|e| format!("write legacy payload: {}", e))?;
        written_bytes += n as u64;

        if let Some(ref cb) = progress {
            let pct = if total_expected > 0 {
                10 + (written_bytes.saturating_mul(85) / total_expected).min(85)
            } else {
                90
            };
            if pct > last_pct {
                last_pct = pct;
                cb(pct, 100, "writing");
            }
        }
    }

    writer
        .flush()
        .map_err(|e| format!("flush legacy payload: {}", e))?;
    drop(writer);

    if let Some(cb) = progress {
        cb(100, 100, "done");
    }

    Ok(vec![safe_name])
}

fn sanitize_legacy_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return "file".to_string();
    }
    let mut out = String::with_capacity(trimmed.len());
    for ch in trimmed.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => out.push('_'),
            _ => out.push(ch),
        }
    }
    if out.is_empty() {
        "file".to_string()
    } else {
        out
    }
}



fn parse_png_metadata(file: &mut File) -> Result<(usize, usize, Vec<(u64, u64)>, u64), String> {
    let mut sig = [0u8; 8];
    file.read_exact(&mut sig)
        .map_err(|e| format!("read sig: {}", e))?;
    if sig != [137, 80, 78, 71, 13, 10, 26, 10] {
        return Err("Not a PNG file".into());
    }

    let mut width = 0usize;
    let mut height = 0usize;
    let mut idat_ranges = Vec::new();
    let mut total_expected = 0u64;

    loop {
        let mut header = [0u8; 8];
        match file.read_exact(&mut header) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(err) => return Err(format!("read chunk header: {}", err)),
        }

        let chunk_len = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
        let chunk_type = &header[4..8];
        let chunk_data_start = file
            .stream_position()
            .map_err(|e| format!("stream position: {}", e))?;
        let chunk_data_end = chunk_data_start
            .checked_add(chunk_len)
            .ok_or_else(|| "PNG chunk length overflow".to_string())?;

        if chunk_type == b"IHDR" {
            if chunk_len < 13 {
                return Err("Invalid IHDR".into());
            }
            let mut ihdr = [0u8; 13];
            file.read_exact(&mut ihdr)
                .map_err(|e| format!("read IHDR: {}", e))?;
            width = u32::from_be_bytes([ihdr[0], ihdr[1], ihdr[2], ihdr[3]]) as usize;
            height = u32::from_be_bytes([ihdr[4], ihdr[5], ihdr[6], ihdr[7]]) as usize;
            if chunk_len > 13 {
                file.seek(SeekFrom::Current((chunk_len - 13) as i64))
                    .map_err(|e| format!("seek IHDR: {}", e))?;
            }
        } else if chunk_type == b"IDAT" {
            idat_ranges.push((chunk_data_start, chunk_data_end));
            file.seek(SeekFrom::Current(chunk_len as i64))
                .map_err(|e| format!("seek IDAT: {}", e))?;
        } else if chunk_type == b"rXFL" {
            let json_len = usize::try_from(chunk_len).map_err(|_| "rXFL too large".to_string())?;
            let mut json = vec![0u8; json_len];
            file.read_exact(&mut json)
                .map_err(|e| format!("read rXFL: {}", e))?;
            total_expected = parse_rxfl_total_bytes(&json).unwrap_or(total_expected);
        } else if chunk_type == b"IEND" {
            break;
        } else {
            file.seek(SeekFrom::Current(chunk_len as i64))
                .map_err(|e| format!("seek chunk: {}", e))?;
        }

        file.seek(SeekFrom::Current(4))
            .map_err(|e| format!("seek crc: {}", e))?;
    }

    if width == 0 || height == 0 {
        return Err("IHDR not found".into());
    }
    if idat_ranges.is_empty() {
        return Err("IDAT not found".into());
    }

    Ok((width, height, idat_ranges, total_expected))
}

fn parse_rxfl_total_bytes(json_bytes: &[u8]) -> Option<u64> {
    if let Ok(entries) = serde_json::from_slice::<Vec<serde_json::Value>>(json_bytes) {
        return Some(
            entries
                .iter()
                .filter_map(|e| e.get("size").and_then(|s| s.as_u64()))
                .sum(),
        );
    }
    None
}

fn extract_window_log_from_png(png_path: &Path, width: usize, height: usize, idat_ranges: &[(u64, u64)]) -> Option<u32> {
    let file = File::open(png_path).ok()?;
    let idat_reader = IdatRangeReader::new(file, idat_ranges.to_vec()).ok()?;
    let zlib_decoder = ZlibDecoder::new(idat_reader);
    let mut reader = ScanlinePixelReader::new(zlib_decoder, width, height);

    let total_bytes = width * height * 3;
    let tail_size = 12usize;
    let skip_size = total_bytes.saturating_sub(tail_size);

    let mut skip_buf = vec![0u8; 65536];
    let mut remaining = skip_size;
    while remaining > 0 {
        let to_read = remaining.min(skip_buf.len());
        if reader.read(&mut skip_buf[..to_read]).ok()? == 0 { break; }
        remaining -= to_read;
    }

    let mut tail = vec![0u8; tail_size];
    reader.read_exact(&mut tail).ok()?;

    let marker_end = [0u8, 0, 255, 0, 255, 0, 255, 0, 0];

    // Chercher le marker_end dans différentes positions possibles
    if tail.len() >= 12 {
        // Cas normal: window_log dans les 3 premiers bytes
        if tail[3..12] == marker_end {
            let window_log = tail[0] as u32;
            // Valider que window_log est dans une plage raisonnable (10-31)
            if window_log >= 10 && window_log <= 31 {
                return Some(window_log);
            }
        }

        // Cas alternatif: chercher le pattern marker_end n'importe où dans le tail
        for i in 0..=(tail.len() - 9) {
            if i + 9 <= tail.len() && tail[i..i+9] == marker_end {
                // Le window_log devrait être juste avant ce pattern
                if i >= 3 {
                    let window_log = tail[i-3] as u32;
                    if window_log >= 10 && window_log <= 31 {
                        return Some(window_log);
                    }
                }
            }
        }
    }

    // Utiliser 31 par défaut pour éviter les faux fallbacks
    // Notre correction window_log garantit que 31 fonctionne toujours
    Some(31)
}

struct IdatRangeReader {
    file: File,
    idat_ranges: Vec<(u64, u64)>,
    range_index: usize,
    offset: u64,
    range_end: u64,
    dropped_until: u64,
}

impl IdatRangeReader {
    fn new(mut file: File, idat_ranges: Vec<(u64, u64)>) -> Result<Self, String> {
        let Some(&(offset, range_end)) = idat_ranges.first() else {
            return Err("IDAT not found".to_string());
        };
        crate::io_advice::advise_file_sequential(&file);
        file.seek(SeekFrom::Start(offset))
            .map_err(|e| format!("seek first IDAT: {}", e))?;
        Ok(Self {
            file,
            idat_ranges,
            range_index: 0,
            offset,
            range_end,
            dropped_until: offset,
        })
    }

    fn advance_range(&mut self) -> Result<bool, std::io::Error> {
        while self.offset >= self.range_end {
            crate::io_advice::advise_drop(
                &self.file,
                self.dropped_until,
                self.range_end.saturating_sub(self.dropped_until),
            );
            self.dropped_until = self.range_end;
            self.range_index += 1;
            let Some(&(offset, end)) = self.idat_ranges.get(self.range_index) else {
                return Ok(false);
            };
            self.file.seek(SeekFrom::Start(offset))?;
            self.offset = offset;
            self.range_end = end;
            self.dropped_until = offset;
        }
        Ok(true)
    }

    fn maybe_drop_consumed(&mut self) {
        let consumed = self.offset.saturating_sub(self.dropped_until);
        if consumed >= crate::io_advice::INPUT_DROP_GRANULARITY {
            crate::io_advice::advise_drop(&self.file, self.dropped_until, consumed);
            self.dropped_until = self.offset;
        }
    }

    fn read_stream_bytes(&mut self, buf: &mut [u8]) -> Result<usize, std::io::Error> {
        let mut written = 0;
        while written < buf.len() {
            if !self.advance_range()? {
                break;
            }
            let available =
                usize::try_from(self.range_end - self.offset).unwrap_or(buf.len() - written);
            if available == 0 {
                continue;
            }
            let take = available.min(buf.len() - written);
            let read = self.file.read(&mut buf[written..written + take])?;
            if read == 0 {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::UnexpectedEof,
                    "failed to fill whole buffer",
                ));
            }
            self.offset += read as u64;
            written += read;
            self.maybe_drop_consumed();
        }
        Ok(written)
    }

    fn read_stream_exact(&mut self, buf: &mut [u8]) -> Result<(), std::io::Error> {
        let got = self.read_stream_bytes(buf)?;
        if got == buf.len() {
            return Ok(());
        }
        Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "failed to fill whole buffer",
        ))
    }
}

impl Read for IdatRangeReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.read_stream_bytes(buf)
    }
}

struct ScanlinePixelReader<R: Read> {
    reader: R,
    height: usize,
    row_bytes: usize,
    current_row: usize,
    col_in_row: usize,
    scanline_filter_pending: bool,
}

impl<R: Read> ScanlinePixelReader<R> {
    fn new(reader: R, width: usize, height: usize) -> Self {
        Self {
            reader,
            height,
            row_bytes: width * 3,
            current_row: 0,
            col_in_row: 0,
            scanline_filter_pending: true,
        }
    }
}

impl<R: Read> Read for ScanlinePixelReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut filled = 0;

        while filled < buf.len() {
            if self.current_row >= self.height {
                break;
            }

            if self.scanline_filter_pending {
                let mut filter = [0u8; 1];
                self.reader.read_exact(&mut filter)?;
                self.scanline_filter_pending = false;
                self.col_in_row = 0;
            }

            if self.col_in_row >= self.row_bytes {
                self.current_row += 1;
                self.scanline_filter_pending = true;
                continue;
            }

            let remaining_in_row = self.row_bytes - self.col_in_row;
            let remaining_in_buf = buf.len() - filled;
            let to_read = remaining_in_row.min(remaining_in_buf);

            let got = self.reader.read(&mut buf[filled..filled + to_read])?;
            if got == 0 {
                break;
            }
            filled += got;
            self.col_in_row += got;
        }

        Ok(filled)
    }
}

struct CtrDecryptReader<R: Read> {
    inner: R,
    cipher: Aes256Ctr,
}

impl<R: Read> CtrDecryptReader<R> {
    fn new(inner: R, cipher: Aes256Ctr) -> Self {
        Self { inner, cipher }
    }
}

impl<R: Read> Read for CtrDecryptReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        if n > 0 {
            self.cipher.apply_keystream(&mut buf[..n]);
        }
        Ok(n)
    }
}

fn tar_unpack_from_reader_with_progress<R: Read>(
    reader: R,
    output_dir: &Path,
    files_opt: Option<&[String]>,
    progress: Option<DecodeProgressCallback>,
    total_expected: u64,
) -> Result<Vec<String>, String> {
    let buf_reader = std::io::BufReader::with_capacity(decode_read_buffer_size().max(8 * 1024 * 1024), reader);
    let mut archive = tar::Archive::new(buf_reader);
    let mut written = Vec::new();
    let mut created_dirs = std::collections::HashSet::new();
    let mut bytes_extracted: u64 = 0;
    let mut last_pct: u64 = 10;
    let files_filter: Option<std::collections::HashSet<&str>> =
        files_opt.map(|files| files.iter().map(|file| file.as_str()).collect());
    let mut remaining = files_filter
        .as_ref()
        .map(|files| files.len())
        .unwrap_or(usize::MAX);

    let entries = archive
        .entries()
        .map_err(|e| format!("tar entries: {}", e))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar entry: {}", e))?;
        let entry_size = entry.size();
        let path = entry
            .path()
            .map_err(|e| format!("tar path: {}", e))?
            .to_path_buf();
        let logical_path = path.to_string_lossy().replace('\\', "/");
        let should_write = files_filter
            .as_ref()
            .map(|files| files.contains(logical_path.as_str()))
            .unwrap_or(true);

        let mut safe = std::path::PathBuf::new();
        for comp in path.components() {
            if let std::path::Component::Normal(osstr) = comp {
                safe.push(osstr);
            }
        }
        if safe.as_os_str().is_empty() {
            continue;
        }

        if !should_write {
            std::io::copy(&mut entry, &mut std::io::sink())
                .map_err(|e| format!("skip {:?}: {}", safe, e))?;
            bytes_extracted += entry_size;
            if let Some(ref cb) = progress {
                let pct = if total_expected > 0 {
                    10 + (bytes_extracted * 89 / total_expected).min(89)
                } else {
                    (10 + (bytes_extracted / (1024 * 1024))).min(99)
                };
                if pct > last_pct {
                    last_pct = pct;
                    cb(pct, 100, "extracting");
                }
            }
            continue;
        }

        let dest = output_dir.join(&safe);
        if let Some(parent) = dest.parent() {
            if created_dirs.insert(parent.to_path_buf()) {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("mkdir {:?}: {}", parent, e))?;
            }
        }

        // Optimisation des buffers pour éviter les fichiers vides
        if cfg!(target_os = "windows") && entry_size > 1024 * 1024 {
            // Windows: gros fichiers - copie par blocs de 8MB SANS BufWriter
            let mut temp_buffer = vec![0u8; 8 * 1024 * 1024];
            let mut file = std::fs::File::create(&dest).map_err(|e| format!("create {:?}: {}", dest, e))?;
            let mut copied = 0u64;
            while copied < entry_size {
                let to_read = (entry_size - copied).min(temp_buffer.len() as u64) as usize;
                let read_bytes = entry.read(&mut temp_buffer[..to_read])
                    .map_err(|e| format!("read {:?}: {}", dest, e))?;
                if read_bytes == 0 { break; }
                file.write_all(&temp_buffer[..read_bytes])
                    .map_err(|e| format!("write {:?}: {}", dest, e))?;
                copied += read_bytes as u64;
            }
            crate::io_advice::sync_and_drop(&file, entry_size);
        } else {
            // Petits fichiers ou Linux: copie standard avec BufWriter.
            // Buffer plafonné par le budget RAM (decode_writer_capacity)
            // au lieu du 16 MiB fixe, pour bénéficier de gros budgets.
            let max_buf = decode_writer_capacity();
            let buffer_size = (entry_size as usize).min(max_buf).max(256 * 1024);

            let mut f = std::io::BufWriter::with_capacity(
                buffer_size,
                std::fs::File::create(&dest).map_err(|e| format!("create {:?}: {}", dest, e))?,
            );

            std::io::copy(&mut entry, &mut f).map_err(|e| format!("write {:?}: {}", dest, e))?;
            let file = f.into_inner().map_err(|e| format!("flush {:?}: {}", dest, e.error()))?;
            crate::io_advice::sync_and_drop(&file, entry_size);
        }
        written.push(safe.to_string_lossy().to_string());
        if files_filter.is_some() {
            remaining = remaining.saturating_sub(1);
        }

        bytes_extracted += entry_size;
        if let Some(ref cb) = progress {
            let pct = if total_expected > 0 {
                10 + (bytes_extracted * 89 / total_expected).min(89)
            } else {
                (10 + (bytes_extracted / (1024 * 1024))).min(99)
            };
            if pct > last_pct {
                last_pct = pct;
                cb(pct, 100, "extracting");
            }
        }
        if remaining == 0 {
            break;
        }
    }

    if let Some(ref cb) = progress {
        cb(99, 100, "finishing");
    }

    Ok(written)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn parse_png_header_collects_all_idat_ranges() {
        let mut png = Vec::new();
        png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

        let mut ihdr = [0u8; 13];
        ihdr[0..4].copy_from_slice(&1u32.to_be_bytes());
        ihdr[4..8].copy_from_slice(&1u32.to_be_bytes());
        ihdr[8] = 8;
        ihdr[9] = 2;

        crate::png_chunk_writer::write_png_chunk(&mut png, b"IHDR", &ihdr).unwrap();
        crate::png_chunk_writer::write_png_chunk(&mut png, b"IDAT", &[1, 2, 3]).unwrap();
        crate::png_chunk_writer::write_png_chunk(&mut png, b"IDAT", &[4, 5]).unwrap();
        crate::png_chunk_writer::write_png_chunk(&mut png, b"IEND", &[]).unwrap();

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let path = std::env::temp_dir().join(format!("rox_png_header_test_{}.png", ms));
        std::fs::write(&path, &png).unwrap();

        let mut file = File::open(&path).unwrap();
        let (_, _, ranges, _) = parse_png_metadata(&mut file).unwrap();

        assert_eq!(ranges.len(), 2);
        assert_eq!(&png[ranges[0].0 as usize..ranges[0].1 as usize], &[1, 2, 3]);
        assert_eq!(&png[ranges[1].0 as usize..ranges[1].1 as usize], &[4, 5]);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn deflate_reader_reads_across_idat_boundaries() {
        let scanline = [0u8, 10, 11, 12, 13, 14, 15];
        let mut deflate = vec![0x78, 0x01, 0x01, 0x07, 0x00, 0xF8, 0xFF];
        deflate.extend_from_slice(&scanline);
        deflate.extend_from_slice(&crate::core::adler32_bytes(&scanline).to_be_bytes());

        let mut data = Vec::new();
        data.extend_from_slice(&deflate[0..4]);
        data.extend_from_slice(&[200, 201, 202]);
        data.extend_from_slice(&deflate[4..12]);
        data.extend_from_slice(&[203, 204]);
        data.extend_from_slice(&deflate[12..]);

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let path = std::env::temp_dir().join(format!("rox_deflate_reader_test_{}.bin", ms));
        std::fs::write(&path, &data).unwrap();

        let ranges = vec![(0, 4), (7, 15), (17, 23)];
        let file = File::open(&path).unwrap();
        let idat_reader = IdatRangeReader::new(file, ranges).unwrap();
        let zlib_decoder = ZlibDecoder::new(idat_reader);
        let mut reader = ScanlinePixelReader::new(zlib_decoder, 2, 1);
        let mut out = Vec::new();
        reader.read_to_end(&mut out).unwrap();

        assert_eq!(out, vec![10, 11, 12, 13, 14, 15]);

        let _ = std::fs::remove_file(path);
    }
}
