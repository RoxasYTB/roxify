use std::io::Read;
use std::path::Path;
use cipher::{KeyIvInit, StreamCipher};

const PIXEL_MAGIC: &[u8] = b"PXL1";
const MARKER_BYTES: usize = 12;
const PACK_MAGIC: [u8; 4] = 0x524f5850u32.to_be_bytes();

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
    let file = std::fs::File::open(png_path).map_err(|e| format!("open: {}", e))?;
    let mmap = unsafe { memmap2::Mmap::map(&file).map_err(|e| format!("mmap: {}", e))? };
    let data = &mmap[..];

    if data.len() < 8 || &data[0..8] != &[137, 80, 78, 71, 13, 10, 26, 10] {
        return Err("Not a PNG file".into());
    }

    if let Some(ref cb) = progress {
        cb(2, 100, "parsing_png");
    }

    let (width, height, idat_ranges) = parse_png_header(data)?;
    let total_expected = parse_rxfl_total_bytes(data).unwrap_or(0);

    if let Some(ref cb) = progress {
        cb(5, 100, "reading_header");
    }

    let mut reader = DeflatePixelReader::new(data, width, height, idat_ranges)
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

    let mut plen_buf = [0u8; 4];
    reader.read_exact(&mut plen_buf).map_err(|e| format!("read payload_len: {}", e))?;
    let payload_len = u32::from_be_bytes(plen_buf) as u64;

    if let Some(ref cb) = progress {
        cb(8, 100, "decrypting");
    }

    let payload_reader = reader.take(payload_len);

    let first_byte_reader = FirstByteReader::new(payload_reader);
    let (enc_byte, remaining_reader) = first_byte_reader.into_parts()?;

    match enc_byte {
        0x00 => {
            if let Some(ref cb) = progress {
                cb(10, 100, "decompressing");
            }
            let mut decoder = zstd::stream::Decoder::new(remaining_reader)
                .map_err(|e| format!("zstd decoder: {}", e))?;
            decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max: {}", e))?;
            read_rox1_and_unpack_with_progress(decoder, out_dir, files_opt, progress, total_expected)
        }
        0x03 => {
            let pass = passphrase.ok_or("Passphrase required for AES-CTR decryption")?;
            let mut salt = [0u8; 16];
            let mut iv = [0u8; 16];
            let mut r = remaining_reader;
            r.read_exact(&mut salt).map_err(|e| format!("read salt: {}", e))?;
            r.read_exact(&mut iv).map_err(|e| format!("read iv: {}", e))?;

            let key = crate::crypto::derive_aes_ctr_key(pass, &salt);
            let cipher = Aes256Ctr::new_from_slices(&key, &iv)
                .map_err(|e| format!("AES-CTR init: {}", e))?;

            let hmac_size = 32u64;
            let encrypted_data_len = payload_len - 1 - 16 - 16 - hmac_size;
            let ctr_reader = CtrDecryptReader::new(r.take(encrypted_data_len), cipher);

            if let Some(ref cb) = progress {
                cb(10, 100, "decompressing");
            }
            let mut decoder = zstd::stream::Decoder::new(ctr_reader)
                .map_err(|e| format!("zstd decoder: {}", e))?;
            decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max: {}", e))?;
            read_rox1_and_unpack_with_progress(decoder, out_dir, files_opt, progress, total_expected)
        }
        _ => Err(format!("Unsupported encryption (enc=0x{:02x}) in streaming decode", enc_byte)),
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

fn parse_png_header(data: &[u8]) -> Result<(usize, usize, Vec<(usize, usize)>), String> {
    let mut pos = 8;

    let mut width = 0usize;
    let mut height = 0usize;
    let mut idat_ranges = Vec::new();

    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        let chunk_type = &data[pos + 4..pos + 8];
        let chunk_data_start = pos + 8;
        let chunk_data_end = chunk_data_start
            .checked_add(chunk_len)
            .ok_or_else(|| "PNG chunk length overflow".to_string())?;
        let chunk_end = chunk_data_end
            .checked_add(4)
            .ok_or_else(|| "PNG chunk CRC overflow".to_string())?;

        if chunk_end > data.len() {
            return Err(format!("Invalid PNG chunk length for {:?}", chunk_type));
        }

        if chunk_type == b"IHDR" {
            if chunk_len < 13 {
                return Err("Invalid IHDR".into());
            }
            width = u32::from_be_bytes([
                data[chunk_data_start],
                data[chunk_data_start + 1],
                data[chunk_data_start + 2],
                data[chunk_data_start + 3],
            ]) as usize;
            height = u32::from_be_bytes([
                data[chunk_data_start + 4],
                data[chunk_data_start + 5],
                data[chunk_data_start + 6],
                data[chunk_data_start + 7],
            ]) as usize;
        } else if chunk_type == b"IDAT" {
            idat_ranges.push((chunk_data_start, chunk_data_end));
        } else if chunk_type == b"IEND" {
            break;
        }

        pos = chunk_end;
    }

    if width == 0 || height == 0 {
        return Err("IHDR not found".into());
    }
    if idat_ranges.is_empty() {
        return Err("IDAT not found".into());
    }

    Ok((width, height, idat_ranges))
}

fn parse_rxfl_total_bytes(data: &[u8]) -> Option<u64> {
    let mut pos = 8;
    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        let chunk_type = &data[pos + 4..pos + 8];
        let chunk_data_start = pos + 8;

        if chunk_type == b"rXFL" && chunk_data_start + chunk_len <= data.len() {
            let json_bytes = &data[chunk_data_start..chunk_data_start + chunk_len];
            if let Ok(entries) = serde_json::from_slice::<Vec<serde_json::Value>>(json_bytes) {
                let total: u64 = entries.iter()
                    .filter_map(|e| e.get("size").and_then(|s| s.as_u64()))
                    .sum();
                return Some(total);
            }
        } else if chunk_type == b"IEND" {
            break;
        }

        pos = chunk_data_start + chunk_len + 4;
    }
    None
}

struct DeflatePixelReader<'a> {
    data: &'a [u8],
    height: usize,
    idat_ranges: Vec<(usize, usize)>,
    range_index: usize,
    offset: usize,
    range_end: usize,
    block_remaining: usize,
    current_row: usize,
    col_in_row: usize,
    scanline_filter_pending: bool,
    row_bytes: usize,
}

impl<'a> DeflatePixelReader<'a> {
    fn new(data: &'a [u8], width: usize, height: usize, idat_ranges: Vec<(usize, usize)>) -> Result<Self, String> {
        let Some(&(offset, range_end)) = idat_ranges.first() else {
            return Err("IDAT not found".to_string());
        };
        let row_bytes = width * 3;
        let mut reader = Self {
            data,
            height,
            idat_ranges,
            range_index: 0,
            offset,
            range_end,
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

    fn advance_range(&mut self) -> bool {
        while self.offset >= self.range_end {
            self.range_index += 1;
            let Some(&(offset, end)) = self.idat_ranges.get(self.range_index) else {
                return false;
            };
            self.offset = offset;
            self.range_end = end;
        }
        true
    }

    fn read_stream_bytes(&mut self, buf: &mut [u8]) -> Result<usize, std::io::Error> {
        let mut written = 0;
        while written < buf.len() {
            if !self.advance_range() {
                break;
            }
            let available = self.range_end - self.offset;
            if available == 0 {
                continue;
            }
            let take = available.min(buf.len() - written);
            buf[written..written + take].copy_from_slice(&self.data[self.offset..self.offset + take]);
            self.offset += take;
            written += take;
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
            if !self.advance_range() {
                return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "failed to fill whole buffer"));
            }
            let available = self.range_end - self.offset;
            if available == 0 {
                continue;
            }
            let take = available.min(remaining);
            self.offset += take;
            remaining -= take;
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

impl<'a> Read for DeflatePixelReader<'a> {
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

struct FirstByteReader<R: Read> {
    inner: R,
}

impl<R: Read> FirstByteReader<R> {
    fn new(inner: R) -> Self {
        Self { inner }
    }

    fn into_parts(mut self) -> Result<(u8, impl Read), String> {
        let mut byte = [0u8; 1];
        self.inner.read_exact(&mut byte).map_err(|e| format!("read first byte: {}", e))?;
        Ok((byte[0], self.inner))
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

        let mut f = std::io::BufWriter::with_capacity(
            (entry_size as usize).min(4 * 1024 * 1024).max(8192),
            std::fs::File::create(&dest).map_err(|e| format!("create {:?}: {}", dest, e))?,
        );
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("write {:?}: {}", dest, e))?;
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

        let (_, _, ranges) = parse_png_header(&png).unwrap();

        assert_eq!(ranges.len(), 2);
        assert_eq!(&png[ranges[0].0..ranges[0].1], &[1, 2, 3]);
        assert_eq!(&png[ranges[1].0..ranges[1].1], &[4, 5]);
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

        let ranges = vec![(0, 4), (7, 15), (17, 23)];
        let mut reader = DeflatePixelReader::new(&data, 2, 1, ranges).unwrap();
        let mut out = Vec::new();
        reader.read_to_end(&mut out).unwrap();

        assert_eq!(out, vec![10, 11, 12, 13, 14, 15]);
    }
}
