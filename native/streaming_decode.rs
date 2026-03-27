use std::io::Read;
use std::path::Path;
use cipher::{KeyIvInit, StreamCipher};

const PIXEL_MAGIC: &[u8] = b"PXL1";
const MARKER_BYTES: usize = 12;

type Aes256Ctr = ctr::Ctr64BE<aes::Aes256>;

pub fn streaming_decode_to_dir(png_path: &Path, out_dir: &Path) -> Result<Vec<String>, String> {
    streaming_decode_to_dir_encrypted(png_path, out_dir, None)
}

pub fn streaming_decode_to_dir_encrypted(
    png_path: &Path,
    out_dir: &Path,
    passphrase: Option<&str>,
) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(png_path).map_err(|e| format!("open: {}", e))?;
    let mmap = unsafe { memmap2::Mmap::map(&file).map_err(|e| format!("mmap: {}", e))? };
    let data = &mmap[..];

    if data.len() < 8 || &data[0..8] != &[137, 80, 78, 71, 13, 10, 26, 10] {
        return Err("Not a PNG file".into());
    }

    let (width, height, idat_data_start, idat_data_end) = parse_png_header(data)?;

    let mut reader = DeflatePixelReader::new(data, width, height, idat_data_start, idat_data_end);

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

    let payload_reader = reader.take(payload_len);

    let first_byte_reader = FirstByteReader::new(payload_reader);
    let (enc_byte, remaining_reader) = first_byte_reader.into_parts()?;

    match enc_byte {
        0x00 => {
            let mut decoder = zstd::stream::Decoder::new(remaining_reader)
                .map_err(|e| format!("zstd decoder: {}", e))?;
            decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max: {}", e))?;
            read_rox1_and_untar(decoder, out_dir)
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

            let mut decoder = zstd::stream::Decoder::new(ctr_reader)
                .map_err(|e| format!("zstd decoder: {}", e))?;
            decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max: {}", e))?;
            read_rox1_and_untar(decoder, out_dir)
        }
        _ => Err(format!("Unsupported encryption (enc=0x{:02x}) in streaming decode", enc_byte)),
    }
}

fn read_rox1_and_untar<R: Read>(mut decoder: R, out_dir: &Path) -> Result<Vec<String>, String> {
    let mut magic = [0u8; 4];
    decoder.read_exact(&mut magic).map_err(|e| format!("read ROX1: {}", e))?;
    if &magic != b"ROX1" {
        return Err(format!("Expected ROX1, got {:?}", magic));
    }
    std::fs::create_dir_all(out_dir).map_err(|e| format!("mkdir: {}", e))?;
    tar_unpack_from_reader(decoder, out_dir)
}

fn parse_png_header(data: &[u8]) -> Result<(usize, usize, usize, usize), String> {
    let mut pos = 8;

    let mut width = 0usize;
    let mut height = 0usize;
    let mut idat_start = 0usize;
    let mut idat_end = 0usize;

    while pos + 12 <= data.len() {
        let chunk_len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]) as usize;
        let chunk_type = &data[pos + 4..pos + 8];
        let chunk_data_start = pos + 8;

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
            idat_start = chunk_data_start;
            idat_end = chunk_data_start + chunk_len;
        } else if chunk_type == b"IEND" {
            break;
        }

        pos = chunk_data_start + chunk_len + 4;
    }

    if width == 0 || height == 0 {
        return Err("IHDR not found".into());
    }
    if idat_start == 0 {
        return Err("IDAT not found".into());
    }

    Ok((width, height, idat_start, idat_end))
}

struct DeflatePixelReader<'a> {
    data: &'a [u8],
    height: usize,
    offset: usize,
    idat_end: usize,
    block_remaining: usize,
    current_row: usize,
    col_in_row: usize,
    scanline_filter_pending: bool,
    row_bytes: usize,
}

impl<'a> DeflatePixelReader<'a> {
    fn new(data: &'a [u8], width: usize, height: usize, idat_data_start: usize, idat_data_end: usize) -> Self {
        let row_bytes = width * 3;
        Self {
            data,
            height,
            offset: idat_data_start + 2,
            idat_end: idat_data_end,
            block_remaining: 0,
            current_row: 0,
            col_in_row: 0,
            scanline_filter_pending: true,
            row_bytes,
        }
    }

    fn ensure_block(&mut self) -> Result<(), std::io::Error> {
        if self.block_remaining > 0 {
            return Ok(());
        }

        if self.offset + 5 > self.idat_end {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "No more deflate blocks"));
        }

        let len_lo = self.data[self.offset + 1] as usize;
        let len_hi = self.data[self.offset + 2] as usize;
        self.offset += 5;

        self.block_remaining = len_lo | (len_hi << 8);
        Ok(())
    }

    fn copy_raw_bytes(&mut self, buf: &mut [u8], count: usize) -> Result<usize, std::io::Error> {
        let mut written = 0;
        while written < count {
            self.ensure_block()?;
            let avail = self.block_remaining.min(count - written).min(self.idat_end - self.offset);
            if avail == 0 {
                break;
            }
            buf[written..written + avail].copy_from_slice(&self.data[self.offset..self.offset + avail]);
            self.offset += avail;
            self.block_remaining -= avail;
            written += avail;
        }
        Ok(written)
    }

    fn skip_raw_bytes(&mut self, count: usize) -> Result<(), std::io::Error> {
        let mut remaining = count;
        while remaining > 0 {
            self.ensure_block()?;
            let skip = self.block_remaining.min(remaining).min(self.idat_end - self.offset);
            if skip == 0 {
                break;
            }
            self.offset += skip;
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

fn tar_unpack_from_reader<R: Read>(reader: R, output_dir: &Path) -> Result<Vec<String>, String> {
    let buf_reader = std::io::BufReader::with_capacity(8 * 1024 * 1024, reader);
    let mut archive = tar::Archive::new(buf_reader);
    let mut written = Vec::new();
    let mut created_dirs = std::collections::HashSet::new();

    let entries = archive.entries().map_err(|e| format!("tar entries: {}", e))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar entry: {}", e))?;
        let path = entry.path().map_err(|e| format!("tar path: {}", e))?.to_path_buf();

        let mut safe = std::path::PathBuf::new();
        for comp in path.components() {
            if let std::path::Component::Normal(osstr) = comp {
                safe.push(osstr);
            }
        }
        if safe.as_os_str().is_empty() {
            continue;
        }

        let dest = output_dir.join(&safe);
        if let Some(parent) = dest.parent() {
            if created_dirs.insert(parent.to_path_buf()) {
                std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {:?}: {}", parent, e))?;
            }
        }

        let mut f = std::io::BufWriter::with_capacity(
            (entry.size() as usize).min(4 * 1024 * 1024).max(8192),
            std::fs::File::create(&dest).map_err(|e| format!("create {:?}: {}", dest, e))?,
        );
        std::io::copy(&mut entry, &mut f).map_err(|e| format!("write {:?}: {}", dest, e))?;
        written.push(safe.to_string_lossy().to_string());
    }

    Ok(written)
}
