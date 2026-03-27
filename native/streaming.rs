use std::io::{Write, BufWriter};
use std::fs::File;
use std::path::Path;

const PNG_HEADER: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];
const PIXEL_MAGIC: &[u8] = b"PXL1";
const MARKER_START: [(u8, u8, u8); 3] = [(255, 0, 0), (0, 255, 0), (0, 0, 255)];
const MARKER_END: [(u8, u8, u8); 3] = [(0, 0, 255), (0, 255, 0), (255, 0, 0)];
const MARKER_ZSTD: (u8, u8, u8) = (0, 255, 0);
const MAGIC: &[u8] = b"ROX1";

pub fn encode_to_png_file(
    data: &[u8],
    output_path: &Path,
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    name: Option<&str>,
    file_list: Option<&str>,
    dict: Option<&[u8]>,
) -> anyhow::Result<()> {
    let compressed = crate::core::zstd_compress_with_prefix(data, compression_level, dict, MAGIC)
        .map_err(|e| anyhow::anyhow!("Compression failed: {}", e))?;

    let encrypted = if let Some(pass) = passphrase {
        match encrypt_type.unwrap_or("aes") {
            "xor" => crate::crypto::encrypt_xor(&compressed, pass),
            "aes" => crate::crypto::encrypt_aes(&compressed, pass)?,
            _ => crate::crypto::encrypt_aes(&compressed, pass)?,
        }
    } else {
        crate::crypto::no_encryption(&compressed)
    };
    drop(compressed);

    let meta_pixel = build_meta_pixel(&encrypted, name, file_list)?;
    drop(encrypted);

    let raw_payload_len = PIXEL_MAGIC.len() + meta_pixel.len();
    let padding_needed = (3 - (raw_payload_len % 3)) % 3;
    let padded_len = raw_payload_len + padding_needed;

    let marker_start_len = 12;
    let data_with_markers_len = marker_start_len + padded_len;
    let data_pixels = (data_with_markers_len + 2) / 3;
    let end_marker_pixels = 3;
    let total_pixels = data_pixels + end_marker_pixels;

    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let side = side.max(end_marker_pixels);
    let width = side;
    let height = side;
    let row_bytes = width * 3;
    let total_data_bytes = width * height * 3;
    let marker_end_pos = (height - 1) * width * 3 + (width - end_marker_pixels) * 3;

    let flat = build_flat_buffer(&meta_pixel, padding_needed, marker_end_pos, total_data_bytes);
    drop(meta_pixel);

    let stride = row_bytes + 1;
    let scanlines_total = height * stride;

    let mut scanlines = vec![0u8; scanlines_total];
    for row in 0..height {
        let flat_start = row * row_bytes;
        let flat_end = (flat_start + row_bytes).min(flat.len());
        let copy_len = flat_end.saturating_sub(flat_start);
        if copy_len > 0 {
            let dst = row * stride + 1;
            scanlines[dst..dst + copy_len].copy_from_slice(&flat[flat_start..flat_end]);
        }
    }
    drop(flat);

    let adler = crate::core::adler32_bytes(&scanlines);

    const MAX_BLOCK: usize = 65535;
    let num_blocks = (scanlines_total + MAX_BLOCK - 1) / MAX_BLOCK;
    let idat_len = 2 + num_blocks * 5 + scanlines_total + 4;

    let f = File::create(output_path)?;
    let mut w = BufWriter::with_capacity(16 * 1024 * 1024, f);

    w.write_all(PNG_HEADER)?;

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 2;
    write_chunk_small(&mut w, b"IHDR", &ihdr)?;

    write_idat_direct(&mut w, &scanlines, idat_len, adler)?;
    drop(scanlines);

    if let Some(fl) = file_list {
        write_chunk_small(&mut w, b"rXFL", fl.as_bytes())?;
    }
    write_chunk_small(&mut w, b"IEND", &[])?;
    w.flush()?;

    Ok(())
}

fn write_idat_direct<W: Write>(
    w: &mut W,
    scanlines: &[u8],
    idat_len: usize,
    adler: u32,
) -> anyhow::Result<()> {
    const MAX_BLOCK: usize = 65535;

    w.write_all(&(idat_len as u32).to_be_bytes())?;
    w.write_all(b"IDAT")?;

    let mut crc = crc32fast::Hasher::new();
    crc.update(b"IDAT");

    let zlib = [0x78u8, 0x01];
    w.write_all(&zlib)?;
    crc.update(&zlib);

    let mut offset = 0;
    while offset < scanlines.len() {
        let chunk_size = (scanlines.len() - offset).min(MAX_BLOCK);
        let is_last = offset + chunk_size >= scanlines.len();
        let header = [
            if is_last { 0x01 } else { 0x00 },
            chunk_size as u8,
            (chunk_size >> 8) as u8,
            !chunk_size as u8,
            (!(chunk_size >> 8)) as u8,
        ];
        w.write_all(&header)?;
        crc.update(&header);
        let slice = &scanlines[offset..offset + chunk_size];
        w.write_all(slice)?;
        crc.update(slice);
        offset += chunk_size;
    }

    let adler_bytes = adler.to_be_bytes();
    w.write_all(&adler_bytes)?;
    crc.update(&adler_bytes);

    w.write_all(&crc.finalize().to_be_bytes())?;
    Ok(())
}

fn build_flat_buffer(
    meta_pixel: &[u8],
    _padding_needed: usize,
    marker_end_pos: usize,
    total_data_bytes: usize,
) -> Vec<u8> {
    let mut flat = vec![0u8; total_data_bytes];

    let mut pos = 0;
    for m in &MARKER_START {
        flat[pos] = m.0; flat[pos + 1] = m.1; flat[pos + 2] = m.2;
        pos += 3;
    }
    flat[pos] = MARKER_ZSTD.0; flat[pos + 1] = MARKER_ZSTD.1; flat[pos + 2] = MARKER_ZSTD.2;
    pos += 3;
    flat[pos..pos + PIXEL_MAGIC.len()].copy_from_slice(PIXEL_MAGIC);
    pos += PIXEL_MAGIC.len();
    flat[pos..pos + meta_pixel.len()].copy_from_slice(meta_pixel);

    if marker_end_pos + 9 <= total_data_bytes {
        for (i, m) in MARKER_END.iter().enumerate() {
            let off = marker_end_pos + i * 3;
            flat[off] = m.0; flat[off + 1] = m.1; flat[off + 2] = m.2;
        }
    }

    flat
}

fn build_meta_pixel(payload: &[u8], name: Option<&str>, file_list: Option<&str>) -> anyhow::Result<Vec<u8>> {
    let version = 1u8;
    let name_bytes = name.map(|n| n.as_bytes()).unwrap_or(&[]);
    let name_len = name_bytes.len().min(255) as u8;
    let payload_len_bytes = (payload.len() as u32).to_be_bytes();

    let mut result = Vec::with_capacity(1 + 1 + name_len as usize + 4 + payload.len() + 256);
    result.push(version);
    result.push(name_len);
    if name_len > 0 {
        result.extend_from_slice(&name_bytes[..name_len as usize]);
    }
    result.extend_from_slice(&payload_len_bytes);
    result.extend_from_slice(payload);

    if let Some(fl) = file_list {
        result.extend_from_slice(b"rXFL");
        let json_bytes = fl.as_bytes();
        result.extend_from_slice(&(json_bytes.len() as u32).to_be_bytes());
        result.extend_from_slice(json_bytes);
    }

    Ok(result)
}

fn write_chunk_small<W: Write>(w: &mut W, chunk_type: &[u8; 4], data: &[u8]) -> anyhow::Result<()> {
    w.write_all(&(data.len() as u32).to_be_bytes())?;
    w.write_all(chunk_type)?;
    w.write_all(data)?;

    let mut h = crc32fast::Hasher::new();
    h.update(chunk_type);
    h.update(data);
    w.write_all(&h.finalize().to_be_bytes())?;
    Ok(())
}
