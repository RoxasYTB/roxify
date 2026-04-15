use std::io::{self, Write};

pub const MAX_PNG_CHUNK_DATA_LEN: usize = 64 * 1024 * 1024;

pub fn write_png_chunk<W: Write>(writer: &mut W, chunk_type: &[u8; 4], data: &[u8]) -> anyhow::Result<()> {
    let len = u32::try_from(data.len())
        .map_err(|_| anyhow::anyhow!("chunk too large: {}", data.len()))?;
    writer.write_all(&len.to_be_bytes())?;
    writer.write_all(chunk_type)?;
    writer.write_all(data)?;

    let mut hasher = crc32fast::Hasher::new();
    hasher.update(chunk_type);
    hasher.update(data);
    writer.write_all(&hasher.finalize().to_be_bytes())?;
    Ok(())
}

pub fn write_chunked_idat_bytes<W: Write>(writer: &mut W, data: &[u8]) -> anyhow::Result<()> {
    write_chunked_idat_bytes_with_limit(writer, data, MAX_PNG_CHUNK_DATA_LEN)
}

fn write_chunked_idat_bytes_with_limit<W: Write>(writer: &mut W, data: &[u8], max_chunk_len: usize) -> anyhow::Result<()> {
    anyhow::ensure!(max_chunk_len > 0, "max_chunk_len must be > 0");
    for chunk in data.chunks(max_chunk_len) {
        write_png_chunk(writer, b"IDAT", chunk)?;
    }
    Ok(())
}

pub struct ChunkedIdatWriter<'a, W: Write> {
    writer: &'a mut W,
    buffer: Vec<u8>,
    max_chunk_len: usize,
}

impl<'a, W: Write> ChunkedIdatWriter<'a, W> {
    pub fn new(writer: &'a mut W) -> Self {
        Self::with_max_chunk_len(writer, MAX_PNG_CHUNK_DATA_LEN)
    }

    fn with_max_chunk_len(writer: &'a mut W, max_chunk_len: usize) -> Self {
        Self {
            writer,
            buffer: Vec::with_capacity(max_chunk_len.max(1).min(MAX_PNG_CHUNK_DATA_LEN)),
            max_chunk_len: max_chunk_len.max(1),
        }
    }

    fn flush_chunk(&mut self) -> anyhow::Result<()> {
        if self.buffer.is_empty() {
            return Ok(());
        }
        write_png_chunk(self.writer, b"IDAT", &self.buffer)?;
        self.buffer.clear();
        Ok(())
    }

    pub fn finish(mut self) -> anyhow::Result<()> {
        self.flush_chunk()
    }
}

impl<W: Write> Write for ChunkedIdatWriter<'_, W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut offset = 0;
        while offset < buf.len() {
            if self.buffer.len() == self.max_chunk_len {
                self.flush_chunk().map_err(io_error)?;
            }
            let space = self.max_chunk_len - self.buffer.len();
            let take = space.min(buf.len() - offset);
            self.buffer.extend_from_slice(&buf[offset..offset + take]);
            offset += take;
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.flush_chunk().map_err(io_error)?;
        self.writer.flush()
    }
}

fn io_error(err: anyhow::Error) -> io::Error {
    io::Error::other(err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_large_idat_stream_into_multiple_chunks() {
        let mut png = Vec::new();
        png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

        let mut ihdr = [0u8; 13];
        ihdr[0..4].copy_from_slice(&1u32.to_be_bytes());
        ihdr[4..8].copy_from_slice(&1u32.to_be_bytes());
        ihdr[8] = 8;
        ihdr[9] = 2;

        write_png_chunk(&mut png, b"IHDR", &ihdr).unwrap();
        write_chunked_idat_bytes_with_limit(&mut png, &[1, 2, 3, 4, 5, 6, 7, 8, 9], 4).unwrap();
        write_png_chunk(&mut png, b"IEND", &[]).unwrap();

        let chunks = crate::png_utils::extract_png_chunks(&png).unwrap();
        let idat_sizes: Vec<usize> = chunks.into_iter()
            .filter(|chunk| chunk.name == "IDAT")
            .map(|chunk| chunk.data.len())
            .collect();

        assert_eq!(idat_sizes, vec![4, 4, 1]);
    }

    #[test]
    fn chunked_idat_writer_flushes_multiple_chunks() {
        let mut png = Vec::new();
        png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

        let mut ihdr = [0u8; 13];
        ihdr[0..4].copy_from_slice(&1u32.to_be_bytes());
        ihdr[4..8].copy_from_slice(&1u32.to_be_bytes());
        ihdr[8] = 8;
        ihdr[9] = 2;

        write_png_chunk(&mut png, b"IHDR", &ihdr).unwrap();
        {
            let mut writer = ChunkedIdatWriter::with_max_chunk_len(&mut png, 3);
            writer.write_all(&[1, 2]).unwrap();
            writer.write_all(&[3, 4, 5]).unwrap();
            writer.write_all(&[6, 7]).unwrap();
            writer.finish().unwrap();
        }
        write_png_chunk(&mut png, b"IEND", &[]).unwrap();

        let chunks = crate::png_utils::extract_png_chunks(&png).unwrap();
        let idat_sizes: Vec<usize> = chunks.into_iter()
            .filter(|chunk| chunk.name == "IDAT")
            .map(|chunk| chunk.data.len())
            .collect();

        assert_eq!(idat_sizes, vec![3, 3, 1]);
    }
}