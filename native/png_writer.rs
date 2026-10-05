//! PNG output without full-size pixel, scanline and IDAT staging buffers.
//! Zstd/encrypted bytes use stored DEFLATE blocks. Only metadata and padding
//! are candidates for compression; the reconstructed pixels remain unchanged.
use std::io::{self, Write};
use flate2::{Compress, Compression, FlushCompress};
use crate::png_chunk_writer::{write_png_chunk, ChunkedIdatWriter};

pub(crate) const STORED_DEFLATE_BLOCK_MAX: usize = 65535;
const ZEROES: [u8; 65536] = [0; 65536];

pub(crate) struct StoredDeflateWriter<W: Write> {
    inner: W,
    pending: Vec<u8>,
    adler: simd_adler32::Adler32,
    header_written: bool,
    compressible: bool,
    compressor: Option<Compress>,
    compressed: Vec<u8>,
}

impl<W: Write> StoredDeflateWriter<W> {
    pub(crate) fn new(inner: W) -> Self {
        Self {
            inner, pending: Vec::with_capacity(STORED_DEFLATE_BLOCK_MAX),
            adler: simd_adler32::Adler32::new(), header_written: false,
            compressible: false, compressor: None, compressed: Vec::new(),
        }
    }

    fn ensure_header(&mut self) -> io::Result<()> {
        if !self.header_written {
            self.inner.write_all(&[0x78, 0x01])?;
            self.header_written = true;
        }
        Ok(())
    }

    pub(crate) fn set_compressible(&mut self, value: bool) -> io::Result<()> {
        if value != self.compressible {
            self.ensure_header()?;
            if !self.pending.is_empty() { self.flush_pending(false)?; }
            self.compressible = value;
        }
        Ok(())
    }

    fn emit_stored(&mut self, data: &[u8], final_block: bool) -> io::Result<()> {
        let len = data.len() as u16;
        let nlen = !len;
        self.inner.write_all(&[u8::from(final_block), len as u8,
            (len >> 8) as u8, nlen as u8, (nlen >> 8) as u8])?;
        self.inner.write_all(data)
    }

    fn flush_pending(&mut self, final_block: bool) -> io::Result<()> {
        let mut data = std::mem::take(&mut self.pending);
        let mut encoded = false;
        if self.compressible && data.len() >= 1024 {
            let compressor = self.compressor.get_or_insert_with(|| Compress::new(Compression::fast(), false));
            // Independent blocks never refer to bytes from a previous candidate
            // that may have been emitted stored instead. Sync ends byte-aligned
            // with BFINAL=0, so the next stored or compressed block can follow.
            compressor.reset();
            self.compressed.clear();
            self.compressed.reserve(2 * STORED_DEFLATE_BLOCK_MAX + 64);
            compressor.compress_vec(&data, &mut self.compressed, FlushCompress::Sync)
                .map_err(io::Error::other)?;
            if compressor.total_in() != data.len() as u64
                || !self.compressed.ends_with(&[0, 0, 255, 255]) {
                return Err(io::Error::other("Incomplete DEFLATE sync block"));
            }
            // Include the final empty stored block in the comparison.
            let extra = if final_block { 5 } else { 0 };
            if self.compressed.len() + extra < data.len() + 5 {
                self.inner.write_all(&self.compressed)?;
                if final_block { self.emit_stored(&[], true)?; }
                encoded = true;
            }
        }
        if !encoded { self.emit_stored(&data, final_block)?; }
        data.clear();
        self.pending = data;
        Ok(())
    }

    pub(crate) fn finish(mut self) -> io::Result<W> {
        self.ensure_header()?;
        self.flush_pending(true)?;
        self.inner.write_all(&self.adler.finish().to_be_bytes())?;
        Ok(self.inner)
    }
}

impl<W: Write> Write for StoredDeflateWriter<W> {
    fn write(&mut self, mut buf: &[u8]) -> io::Result<usize> {
        let total = buf.len();
        if buf.is_empty() { return Ok(0); }
        self.ensure_header()?;
        self.adler.write(buf);
        while !buf.is_empty() {
            if self.pending.len() == STORED_DEFLATE_BLOCK_MAX { self.flush_pending(false)?; }
            // Large payload writes bypass the pending copy entirely.
            if !self.compressible && self.pending.is_empty() && buf.len() > STORED_DEFLATE_BLOCK_MAX {
                self.emit_stored(&buf[..STORED_DEFLATE_BLOCK_MAX], false)?;
                buf = &buf[STORED_DEFLATE_BLOCK_MAX..];
                continue;
            }
            let take = (STORED_DEFLATE_BLOCK_MAX - self.pending.len()).min(buf.len());
            self.pending.extend_from_slice(&buf[..take]);
            buf = &buf[take..];
        }
        Ok(total)
    }

    fn flush(&mut self) -> io::Result<()> { self.inner.flush() }
}

pub(crate) struct ScanlineFilterWriter<W: Write> {
    inner: W,
    row_bytes: usize,
    col_in_row: usize,
}

impl<W: Write> ScanlineFilterWriter<W> {
    pub(crate) fn new(inner: W, row_bytes: usize) -> Self {
        assert!(row_bytes > 0);
        Self { inner, row_bytes, col_in_row: 0 }
    }
    pub(crate) fn get_mut(&mut self) -> &mut W { &mut self.inner }
    pub(crate) fn into_inner(self) -> W { self.inner }
}

impl<W: Write> Write for ScanlineFilterWriter<W> {
    fn write(&mut self, mut buf: &[u8]) -> io::Result<usize> {
        let total = buf.len();
        while !buf.is_empty() {
            if self.col_in_row == 0 { self.inner.write_all(&[0])?; }
            let take = (self.row_bytes - self.col_in_row).min(buf.len());
            self.inner.write_all(&buf[..take])?;
            self.col_in_row = (self.col_in_row + take) % self.row_bytes;
            buf = &buf[take..];
        }
        Ok(total)
    }
    fn flush(&mut self) -> io::Result<()> { self.inner.flush() }
}

pub(crate) fn write_png<W: Write>(
    out: &mut W, payload: &[u8], name: Option<&str>, file_list: Option<&str>,
) -> anyhow::Result<()> {
    let name = name.unwrap_or("").as_bytes();
    let name = &name[..name.len().min(255)];
    let list = file_list.map(str::as_bytes);
    let mut header = Vec::with_capacity(26 + name.len());
    header.extend_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 0]);
    header.extend_from_slice(b"PXL1");
    header.extend_from_slice(&[2, name.len() as u8]);
    header.extend_from_slice(name);
    header.extend_from_slice(&(payload.len() as u64).to_be_bytes());
    let used = header.len() + payload.len() + list.map_or(0, |l| l.len() + 8);
    let side = ((used.div_ceil(3) + 3) as f64).sqrt().ceil() as usize;
    let side = side.max(3);
    let padding = side * side * 3 - used - 9;

    out.write_all(&[137, 80, 78, 71, 13, 10, 26, 10])?;
    let mut ihdr = [0; 13];
    ihdr[..4].copy_from_slice(&(side as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(side as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 2;
    write_png_chunk(out, b"IHDR", &ihdr)?;
    let idat = ChunkedIdatWriter::new(out);
    let mut rows = ScanlineFilterWriter::new(StoredDeflateWriter::new(idat), side * 3);
    rows.write_all(&header)?;
    rows.write_all(payload)?;
    // Small tails would only add another stored-block header.
    if list.map_or(0, |l| l.len() + 8) + padding + 9 >= 1024 {
        rows.get_mut().set_compressible(true)?;
    }
    if let Some(list) = list {
        rows.write_all(b"rXFL")?;
        rows.write_all(&u32::try_from(list.len())?.to_be_bytes())?;
        rows.write_all(list)?;
    }
    let mut left = padding;
    while left > 0 {
        let n = left.min(ZEROES.len());
        rows.write_all(&ZEROES[..n])?;
        left -= n;
    }
    rows.write_all(&[0, 0, 255, 0, 255, 0, 255, 0, 0])?;
    rows.into_inner().finish()?.finish()?;
    if let Some(list) = list { write_png_chunk(out, b"rXFL", list)?; }
    write_png_chunk(out, b"IEND", &[])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn compressible_mode_handles_empty_small_and_incompressible_tails() {
        let mut state = 0x12345678u32;
        let random: Vec<u8> = (0..131071).map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state as u8
        }).collect();
        for size in [0, 17, 1023, 1024, 65535, 65536, 131071] {
            let mut writer = StoredDeflateWriter::new(Vec::new());
            writer.write_all(b"prefix").unwrap();
            writer.set_compressible(true).unwrap();
            writer.write_all(&random[..size]).unwrap();
            let encoded = writer.finish().unwrap();
            let mut decoded = Vec::new();
            flate2::read::ZlibDecoder::new(encoded.as_slice()).read_to_end(&mut decoded).unwrap();
            assert_eq!(decoded, [b"prefix".as_slice(), &random[..size]].concat());
        }
    }

    #[test]
    fn mixed_blocks_preserve_bytes_and_checksums() {
        let opaque: Vec<u8> = (0..160_000).map(|i| ((i * 73 + i / 251) & 255) as u8).collect();
        let text = b"{\"name\":\"assets/example.json\",\"size\":1024},".repeat(7000);
        for chunk_size in [1, 7919, 65535, 1000000] {
            let mut stream = StoredDeflateWriter::new(Vec::new());
            for chunk in opaque.chunks(chunk_size) { stream.write_all(chunk).unwrap(); }
            stream.set_compressible(true).unwrap();
            for chunk in text.chunks(chunk_size) { stream.write_all(chunk).unwrap(); }
            stream.set_compressible(false).unwrap();
            stream.write_all(&opaque).unwrap();
            let encoded = stream.finish().unwrap();
            let mut decoded = Vec::new();
            flate2::read::ZlibDecoder::new(encoded.as_slice()).read_to_end(&mut decoded).unwrap();
            assert_eq!(decoded, [&opaque[..], &text[..], &opaque[..]].concat());
            assert!(encoded.len() < opaque.len() * 2 + text.len() / 10);
            let mut damaged = encoded;
            let last = damaged.len() - 1;
            damaged[last] ^= 1;
            assert!(flate2::read::ZlibDecoder::new(damaged.as_slice()).read_to_end(&mut Vec::new()).is_err());
        }
    }
}
