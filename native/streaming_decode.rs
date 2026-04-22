use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use cipher::{KeyIvInit, StreamCipher};

const PIXEL_MAGIC: &[u8] = b"PXL1";
const MARKER_BYTES: usize = 12;
const PACK_MAGIC: [u8; 4] = 0x524f5850u32.to_be_bytes();
const HEADER_VERSION_V1: u8 = 1;
const HEADER_VERSION_V2: u8 = 2;

type Aes256Ctr = ctr::Ctr64BE<aes::Aes256>;

pub type DecodeProgressCallback = Box<dyn Fn(u64, u64, &str) + Send>;

pub fn streaming_decode_to_dir(png_path: &Path, out_dir: &Path) -> Result<Vec<String>, String> {
    streaming_decode_selected_to_dir_encrypted_with_progress(png_path, out_dir, None, None, None)
}

pub fn streaming_decode_to_dir_encrypted(
    png_path: &Path,
    out_dir: &Path,
    passphrase: Option<&str>,
) -> Result<Vec<String>, String> {
    streaming_decode_selected_to_dir_encrypted_with_progress(png_path, out_dir, None, passphrase, None)
}

pub fn streaming_decode_to_dir_encrypted_with_progress(
    png_path: &Path,
    out_dir: &Path,
    passphrase: Option<&str>,
    progress: Option<DecodeProgressCallback>,
) -> Result<Vec<String>, String> {
    streaming_decode_selected_to_dir_encrypted_with_progress(png_path, out_dir, None, passphrase, progress)
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
    let mut reader = DeflatePixelReader::new(data_file, width, height, idat_ranges)
        .map_err(|e| format!("init deflate reader: {}", e))?;

    let mut marker_buf = [0u8; MARKER_BYTES];
    reader.read_exact(&mut marker_buf).map_err(|e| format!("read markers: {}", e))?;

    let mut pxl1 = [0u8; 4];
    reader.read_exact(&mut pxl1).map_err(|e| format!("read PXL1: {}", e))?;
    if &pxl1 != PIXEL_MAGIC {
        return Err(format!("Expected PXL1, got {:?}", pxl1));
    }

    let mut hdr = [0u8; 2];
    reader.read_exact(&mut hdr).map_err(|e| format!("read hdr: {}", e))?;
    let _version = hdr[0];
    let name_len = hdr[1] as usize;

    if name_len > 0 {
        let mut name_buf = vec![0u8; name_len];
        reader.read_exact(&mut name_buf).map_err(|e| format!("read name: {}", e))?;
    }

    let payload_len = read_payload_len(&mut reader, hdr[0])?;

    if let Some(ref cb) = progress {
        cb(8, 100, "decrypting");
    }

    let mut enc_byte = [0u8; 1];
    reader.read_exact(&mut enc_byte).map_err(|e| format!("read first byte: {}", e))?;
    let remaining_payload_len = payload_len.saturating_sub(1);

    match enc_byte[0] {
        0x00 => {
            if let Some(ref cb) = progress {
                cb(10, 100, "decompressing");
            }
            let mut decoder = zstd::stream::Decoder::new(reader)
                .map_err(|e| format!("zstd decoder: {}", e))?;
            decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max: {}", e))?;
            read_rox1_and_unpack_with_progress(decoder, out_dir, files_opt, progress, total_expected)
        }
        0x03 => {
            let pass = passphrase.ok_or("Passphrase required for AES-CTR decryption")?;
            let mut salt = [0u8; 16];
            let mut iv = [0u8; 16];
            let mut r = reader.take(remaining_payload_len);
            r.read_exact(&mut salt).map_err(|e| format!("read salt: {}", e))?;
            r.read_exact(&mut iv).map_err(|e| format!("read iv: {}", e))?;

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
            decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max: {}", e))?;
            read_rox1_and_unpack_with_progress(decoder, out_dir, files_opt, progress, total_expected)
        }
        _ => Err(format!("Unsupported encryption (enc=0x{:02x}) in streaming decode", enc_byte[0])),
    }
}

fn read_payload_len<R: Read>(reader: &mut R, version: u8) -> Result<u64, String> {
    match version {
        HEADER_VERSION_V1 => {
            let mut plen_buf = [0u8; 4];
            reader.read_exact(&mut plen_buf).map_err(|e| format!("read payload_len: {}", e))?;
            Ok(u32::from_be_bytes(plen_buf) as u64)
        }
        HEADER_VERSION_V2 => {
            let mut plen_buf = [0u8; 8];
            reader.read_exact(&mut plen_buf).map_err(|e| format!("read payload_len64: {}", e))?;
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
) -> Result<Vec<String>, String> {
    let mut magic = [0u8; 4];
    decoder.read_exact(&mut magic).map_err(|e| format!("read ROX1: {}", e))?;
    if &magic != b"ROX1" {
        return Err(format!("Expected ROX1, got {:?}", magic));
    }
    std::fs::create_dir_all(out_dir).map_err(|e| format!("mkdir: {}", e))?;

    let mut prefix = [0u8; 4];
    decoder.read_exact(&mut prefix).map_err(|e| format!("read payload magic: {}", e))?;
    let mut chained = std::io::Cursor::new(prefix).chain(decoder);

    if prefix == PACK_MAGIC {
        crate::packer::unpack_stream_to_dir(&mut chained, out_dir, files_opt, progress.as_deref(), total_expected)
            .map_err(|e| format!("pack unpack: {}", e))
    } else {
        tar_unpack_from_reader_with_progress(chained, out_dir, files_opt, progress, total_expected)
    }
}

fn parse_png_metadata(file: &mut File) -> Result<(usize, usize, Vec<(u64, u64)>, u64), String> {
    let mut sig = [0u8; 8];
    file.read_exact(&mut sig).map_err(|e| format!("read sig: {}", e))?;
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
        let chunk_data_start = file.stream_position().map_err(|e| format!("stream position: {}", e))?;
        let chunk_data_end = chunk_data_start
            .checked_add(chunk_len)
            .ok_or_else(|| "PNG chunk length overflow".to_string())?;

        if chunk_type == b"IHDR" {
            if chunk_len < 13 {
                return Err("Invalid IHDR".into());
            }
            let mut ihdr = [0u8; 13];
            file.read_exact(&mut ihdr).map_err(|e| format!("read IHDR: {}", e))?;
            width = u32::from_be_bytes([ihdr[0], ihdr[1], ihdr[2], ihdr[3]]) as usize;
            height = u32::from_be_bytes([ihdr[4], ihdr[5], ihdr[6], ihdr[7]]) as usize;
            if chunk_len > 13 {
                file.seek(SeekFrom::Current((chunk_len - 13) as i64)).map_err(|e| format!("seek IHDR: {}", e))?;
            }
        } else if chunk_type == b"IDAT" {
            idat_ranges.push((chunk_data_start, chunk_data_end));
            file.seek(SeekFrom::Current(chunk_len as i64)).map_err(|e| format!("seek IDAT: {}", e))?;
        } else if chunk_type == b"rXFL" {
            let json_len = usize::try_from(chunk_len).map_err(|_| "rXFL too large".to_string())?;
            let mut json = vec![0u8; json_len];
            file.read_exact(&mut json).map_err(|e| format!("read rXFL: {}", e))?;
            total_expected = parse_rxfl_total_bytes(&json).unwrap_or(total_expected);
        } else if chunk_type == b"IEND" {
            break;
        } else {
            file.seek(SeekFrom::Current(chunk_len as i64)).map_err(|e| format!("seek chunk: {}", e))?;
        }

        file.seek(SeekFrom::Current(4)).map_err(|e| format!("seek crc: {}", e))?;
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
        return Some(entries.iter()
            .filter_map(|e| e.get("size").and_then(|s| s.as_u64()))
            .sum());
    }
    None
}

struct DeflatePixelReader {
    file: File,
    height: usize,
    idat_ranges: Vec<(u64, u64)>,
    range_index: usize,
    offset: u64,
    range_end: u64,
    dropped_until: u64,
    block_remaining: usize,
    current_row: usize,
    col_in_row: usize,
    scanline_filter_pending: bool,
    row_bytes: usize,
}

impl DeflatePixelReader {
    fn new(mut file: File, width: usize, height: usize, idat_ranges: Vec<(u64, u64)>) -> Result<Self, String> {
        let Some(&(offset, range_end)) = idat_ranges.first() else {
            return Err("IDAT not found".to_string());
        };
        crate::io_advice::advise_file_sequential(&file);
        file.seek(SeekFrom::Start(offset)).map_err(|e| format!("seek first IDAT: {}", e))?;
        let row_bytes = width * 3;
        let mut reader = Self {
            file,
            height,
            idat_ranges,
            range_index: 0,
            offset,
            range_end,
            dropped_until: offset,
            block_remaining: 0,
            current_row: 0,
            col_in_row: 0,
            scanline_filter_pending: true,
            row_bytes,
        };
        reader.skip_stream_bytes(2)
            .map_err(|e| format!("read zlib header: {}", e))?;
        Ok(reader)
    }

    fn advance_range(&mut self) -> Result<bool, std::io::Error> {
        while self.offset >= self.range_end {
            crate::io_advice::advise_drop(&self.file, self.dropped_until, self.range_end.saturating_sub(self.dropped_until));
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
            let available = usize::try_from(self.range_end - self.offset).unwrap_or(buf.len() - written);
            if available == 0 {
                continue;
            }
            let take = available.min(buf.len() - written);
            let read = self.file.read(&mut buf[written..written + take])?;
            if read == 0 {
                return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "failed to fill whole buffer"));
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
        Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "failed to fill whole buffer"))
    }

    fn skip_stream_bytes(&mut self, count: usize) -> Result<(), std::io::Error> {
        let mut remaining = count;
        while remaining > 0 {
            if !self.advance_range()? {
                return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "failed to fill whole buffer"));
            }
            let available = usize::try_from(self.range_end - self.offset).unwrap_or(remaining);
            if available == 0 {
                continue;
            }
            let take = available.min(remaining);
            self.file.seek(SeekFrom::Current(take as i64))?;
            self.offset += take as u64;
            remaining -= take;
            self.maybe_drop_consumed();
        }
        Ok(())
    }

    fn ensure_block(&mut self) -> Result<(), std::io::Error> {
        if self.block_remaining > 0 {
            return Ok(());
        }

        let mut header = [0u8; 5];
        self.read_stream_exact(&mut header)?;

        let len_lo = header[1] as usize;
        let len_hi = header[2] as usize;

        self.block_remaining = len_lo | (len_hi << 8);
        Ok(())
    }

    fn copy_raw_bytes(&mut self, buf: &mut [u8], count: usize) -> Result<usize, std::io::Error> {
        let mut written = 0;
        while written < count {
            self.ensure_block()?;
            let avail = self.block_remaining.min(count - written);
            if avail == 0 {
                break;
            }
            let got = self.read_stream_bytes(&mut buf[written..written + avail])?;
            if got == 0 {
                break;
            }
            self.block_remaining -= got;
            written += got;
        }
        Ok(written)
    }

    fn skip_raw_bytes(&mut self, count: usize) -> Result<(), std::io::Error> {
        let mut remaining = count;
        while remaining > 0 {
            self.ensure_block()?;
            let skip = self.block_remaining.min(remaining);
            if skip == 0 {
                break;
            }
            self.skip_stream_bytes(skip)?;
            self.block_remaining -= skip;
            remaining -= skip;
        }
        Ok(())
    }
}

impl Read for DeflatePixelReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let mut filled = 0;

        while filled < buf.len() {
            if self.current_row >= self.height {
                break;
            }

            if self.scanline_filter_pending {
                self.skip_raw_bytes(1)?;
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

            let got = self.copy_raw_bytes(&mut buf[filled..filled + to_read], to_read)?;
            filled += got;
            self.col_in_row += got;
            if got == 0 {
                break;
            }
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
    let buf_reader = std::io::BufReader::with_capacity(8 * 1024 * 1024, reader);
    let mut archive = tar::Archive::new(buf_reader);
    let mut written = Vec::new();
    let mut created_dirs = std::collections::HashSet::new();
    let mut bytes_extracted: u64 = 0;
    let mut last_pct: u64 = 10;
    let files_filter: Option<std::collections::HashSet<&str>> = files_opt.map(|files| files.iter().map(|file| file.as_str()).collect());
    let mut remaining = files_filter.as_ref().map(|files| files.len()).unwrap_or(usize::MAX);

    let entries = archive.entries().map_err(|e| format!("tar entries: {}", e))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar entry: {}", e))?;
        let entry_size = entry.size();
        let path = entry.path().map_err(|e| format!("tar path: {}", e))?.to_path_buf();
        let logical_path = path.to_string_lossy().replace('\\', "/");
        let should_write = files_filter.as_ref().map(|files| files.contains(logical_path.as_str())).unwrap_or(true);

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
            std::io::copy(&mut entry, &mut std::io::sink()).map_err(|e| format!("skip {:?}: {}", safe, e))?;
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
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {:?}: {}", parent, e))?;
            }
        }

        // NTFS optimization: larger buffer reduces syscalls (16MB max, 256KB min)
        let buffer_size = (entry_size as usize)
            .min(16 * 1024 * 1024)  // 16MB max buffer
            .max(256 * 1024);       // 256KB min buffer for NTFS
        let mut f = std::io::BufWriter::with_capacity(
            buffer_size,
            std::fs::File::create(&dest).map_err(|e| format!("create {:?}: {}", dest, e))?,
        );
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("write {:?}: {}", dest, e))?;
        let file = f.into_inner().map_err(|e| format!("flush {:?}: {}", dest, e.error()))?;
        crate::io_advice::sync_and_drop(&file, entry_size);
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

        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
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

        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        let path = std::env::temp_dir().join(format!("rox_deflate_reader_test_{}.bin", ms));
        std::fs::write(&path, &data).unwrap();

        let ranges = vec![(0, 4), (7, 15), (17, 23)];
        let file = File::open(&path).unwrap();
        let mut reader = DeflatePixelReader::new(file, 2, 1, ranges).unwrap();
        let mut out = Vec::new();
        reader.read_to_end(&mut out).unwrap();

        assert_eq!(out, vec![10, 11, 12, 13, 14, 15]);

        let _ = std::fs::remove_file(path);
    }
}
