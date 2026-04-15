use anyhow::Result;

use crate::png_chunk_writer::{write_chunked_idat_bytes, write_png_chunk};

const MAGIC: &[u8] = b"ROX1";
const PIXEL_MAGIC: &[u8] = b"PXL1";
const PNG_HEADER: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

const MARKER_START: [(u8, u8, u8); 3] = [(255, 0, 0), (0, 255, 0), (0, 0, 255)];
const MARKER_END: [(u8, u8, u8); 3] = [(0, 0, 255), (0, 255, 0), (255, 0, 0)];
const MARKER_ZSTD: (u8, u8, u8) = (0, 255, 0);

#[derive(Debug, Clone, Copy)]
pub enum ImageFormat {
    Png,
}

pub fn encode_to_png(data: &[u8], compression_level: i32) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, None, None, None, None, None)
}


pub fn encode_to_png_with_name(data: &[u8], compression_level: i32, name: Option<&str>) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, None, None, name, None, None)
}

pub fn encode_to_png_with_name_and_filelist(data: &[u8], compression_level: i32, name: Option<&str>, file_list: Option<&str>) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, None, None, name, file_list, None)
}

pub fn encode_to_png_raw(data: &[u8], compression_level: i32) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, None, None, None, None, None)
}

pub fn encode_to_png_with_encryption_and_name(
    data: &[u8],
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    name: Option<&str>,
) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, passphrase, encrypt_type, name, None, None)
}

pub fn encode_to_png_with_encryption_name_and_filelist(
    data: &[u8],
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    name: Option<&str>,
    file_list: Option<&str>,
) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, passphrase, encrypt_type, name, file_list, None)
}

// ─── WAV container encoding ─────────────────────────────────────────────────

/// Encode data into WAV container (8-bit PCM).
/// Same compression/encryption pipeline as PNG, but wrapped in a WAV file
/// instead of pixel grid. Overhead: 44 bytes (constant) vs PNG's variable overhead.
pub fn encode_to_wav(data: &[u8], compression_level: i32) -> Result<Vec<u8>> {
    encode_to_wav_with_encryption_name_and_filelist(data, compression_level, None, None, None, None)
}

pub fn encode_to_wav_with_name_and_filelist(
    data: &[u8],
    compression_level: i32,
    name: Option<&str>,
    file_list: Option<&str>,
) -> Result<Vec<u8>> {
    encode_to_wav_with_encryption_name_and_filelist(data, compression_level, None, None, name, file_list)
}

pub fn encode_to_wav_with_encryption_name_and_filelist(
    data: &[u8],
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    name: Option<&str>,
    file_list: Option<&str>,
) -> Result<Vec<u8>> {
    // Same compression + encryption pipeline as PNG
    let compressed = crate::core::zstd_compress_with_prefix(data, compression_level, None, MAGIC)
        .map_err(|e| anyhow::anyhow!("Compression failed: {}", e))?;

    let encrypted = if let Some(pass) = passphrase {
        match encrypt_type.unwrap_or("aes") {
            "xor" => crate::crypto::encrypt_xor(&compressed, pass),
            "aes" => crate::crypto::encrypt_aes(&compressed, pass)?,
            _ => crate::crypto::encrypt_aes(&compressed, pass)?,
        }
    } else {
        crate::crypto::no_encryption_in_place(compressed)
    };

    let meta_pixel = build_meta_pixel_with_name_and_filelist(&encrypted, name, file_list)?;

    let wav_payload = [PIXEL_MAGIC, &meta_pixel].concat();

    Ok(crate::audio::bytes_to_wav(&wav_payload))
}

/// Extract payload from a WAV file and return the raw meta_pixel bytes.
pub fn decode_wav_payload(wav_data: &[u8]) -> Result<Vec<u8>> {
    crate::audio::wav_to_bytes(wav_data)
        .map_err(|e| anyhow::anyhow!("WAV decode failed: {}", e))
}

pub fn encode_to_png_with_encryption_name_and_format_and_filelist(
    data: &[u8],
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    _format: ImageFormat,
    name: Option<&str>,
    file_list: Option<&str>,
    dict: Option<&[u8]>,
) -> Result<Vec<u8>> {
    encode_to_png_with_encryption_name_and_filelist_internal(data, compression_level, passphrase, encrypt_type, name, file_list, dict)
}

fn encode_to_png_with_encryption_name_and_filelist_internal(
    data: &[u8],
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    name: Option<&str>,
    file_list: Option<&str>,
    dict: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let compressed = crate::core::zstd_compress_with_prefix(data, compression_level, dict, MAGIC)
        .map_err(|e| anyhow::anyhow!("Compression failed: {}", e))?;

    let encrypted = if let Some(pass) = passphrase {
        match encrypt_type.unwrap_or("aes") {
            "xor" => crate::crypto::encrypt_xor(&compressed, pass),
            "aes" => crate::crypto::encrypt_aes(&compressed, pass)?,
            _ => crate::crypto::encrypt_aes(&compressed, pass)?,
        }
    } else {
        crate::crypto::no_encryption_in_place(compressed)
    };

    let meta_pixel = build_meta_pixel_with_name_and_filelist(&encrypted, name, file_list)?;
    drop(encrypted);

    let raw_payload_len = PIXEL_MAGIC.len() + meta_pixel.len();
    let padding_needed = (3 - (raw_payload_len % 3)) % 3;
    let padded_len = raw_payload_len + padding_needed;

    let marker_start_len = 12;
    let marker_end_bytes = 9;

    let data_with_markers_len = marker_start_len + padded_len;
    let data_pixels = (data_with_markers_len + 2) / 3;
    let end_marker_pixels = 3;
    let total_pixels = data_pixels + end_marker_pixels;

    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let side = side.max(end_marker_pixels);
    let width = side;
    let height = side;

    let total_data_bytes = width * height * 3;
    let marker_end_pos = total_data_bytes - marker_end_bytes;

    let flat = build_flat_pixel_buffer(&meta_pixel, marker_end_pos, total_data_bytes);
    drop(meta_pixel);

    let row_bytes = width * 3;
    let idat_data = create_raw_deflate_from_rows(&flat, row_bytes, height);
    drop(flat);

    build_png(width, height, &idat_data, file_list)
}

fn build_flat_pixel_buffer(
    meta_pixel: &[u8],
    marker_end_pos: usize,
    total_data_bytes: usize,
) -> Vec<u8> {
    let mut flat = Vec::with_capacity(total_data_bytes);

    for m in &MARKER_START {
        flat.push(m.0); flat.push(m.1); flat.push(m.2);
    }
    flat.push(MARKER_ZSTD.0); flat.push(MARKER_ZSTD.1); flat.push(MARKER_ZSTD.2);

    flat.extend_from_slice(PIXEL_MAGIC);
    flat.extend_from_slice(meta_pixel);

    let payload_end = flat.len();
    if payload_end < marker_end_pos {
        flat.resize(marker_end_pos, 0);
    }

    for m in &MARKER_END {
        flat.push(m.0); flat.push(m.1); flat.push(m.2);
    }

    if flat.len() < total_data_bytes {
        flat.resize(total_data_bytes, 0);
    }

    flat
}

fn build_meta_pixel_with_name_and_filelist(payload: &[u8], name: Option<&str>, file_list: Option<&str>) -> Result<Vec<u8>> {
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

    if let Some(file_list_json) = file_list {
        result.extend_from_slice(b"rXFL");
        let json_bytes = file_list_json.as_bytes();
        let json_len = json_bytes.len() as u32;
        result.extend_from_slice(&json_len.to_be_bytes());
        result.extend_from_slice(json_bytes);
    }

    Ok(result)
}

fn build_png(width: usize, height: usize, idat_data: &[u8], file_list: Option<&str>) -> Result<Vec<u8>> {
    let mut png = Vec::with_capacity(8 + 25 + 12 + idat_data.len() + 12 + 256);

    png.extend_from_slice(PNG_HEADER);

    let mut ihdr_data = [0u8; 13];
    ihdr_data[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr_data[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr_data[8] = 8;
    ihdr_data[9] = 2;
    ihdr_data[10] = 0;
    ihdr_data[11] = 0;
    ihdr_data[12] = 0;

    write_png_chunk(&mut png, b"IHDR", &ihdr_data)?;
    write_chunked_idat_bytes(&mut png, idat_data)?;

    if let Some(file_list_json) = file_list {
        write_png_chunk(&mut png, b"rXFL", file_list_json.as_bytes())?;
    }

    write_png_chunk(&mut png, b"IEND", &[])?;

    Ok(png)
}

fn create_raw_deflate_from_rows(flat: &[u8], row_bytes: usize, height: usize) -> Vec<u8> {
    let stride = row_bytes + 1;
    let scanlines_total = height * stride;

    let mut scanlines = vec![0u8; scanlines_total];
    for row in 0..height {
        let flat_start = row * row_bytes;
        let flat_end = (flat_start + row_bytes).min(flat.len());
        let copy_len = flat_end.saturating_sub(flat_start);
        if copy_len > 0 {
            let dst_start = row * stride + 1;
            scanlines[dst_start..dst_start + copy_len].copy_from_slice(&flat[flat_start..flat_end]);
        }
    }

    const MAX_BLOCK: usize = 65535;
    let num_blocks = (scanlines_total + MAX_BLOCK - 1) / MAX_BLOCK;
    let total_size = 2 + num_blocks * 5 + scanlines_total + 4;
    let mut result = Vec::with_capacity(total_size);

    result.push(0x78);
    result.push(0x01);

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
        result.extend_from_slice(&header);
        result.extend_from_slice(&scanlines[offset..offset + chunk_size]);
        offset += chunk_size;
    }

    let adler = crate::core::adler32_bytes(&scanlines);
    result.extend_from_slice(&adler.to_be_bytes());

    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::png_utils;

    #[test]
    fn test_rxfl_chunk_present_when_file_list_provided() {
        let sample_data = b"hello world".to_vec();
        let file_list_json = Some("[{\"name\": \"a.txt\", \"size\": 11}]" as &str);
        let png = encode_to_png_with_encryption_name_and_filelist_internal(&sample_data, 3, None, None, None, file_list_json, None)
            .expect("encode should succeed");

        let chunks = png_utils::extract_png_chunks(&png).expect("extract chunks");
        let found = chunks.iter().any(|c| c.name == "rXFL");
        assert!(found, "rXFL chunk must be present when file_list is provided");

        let rxfl_chunk = chunks.into_iter().find(|c| c.name == "rXFL").expect("rXFL present");
        let s = String::from_utf8_lossy(&rxfl_chunk.data);
        assert!(s.contains("a.txt"), "rXFL chunk should contain the file name");
    }

    #[test]
    fn test_extract_payload_and_partial_unpack() {
        use std::fs;
        let base = std::env::temp_dir().join(format!("rox_test_{}", rand::random::<u32>()));
        let dir = base.join("data");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.txt"), b"hello").unwrap();
        fs::write(dir.join("sub").join("b.txt"), b"world").unwrap();

        let pack_result = crate::packer::pack_path_with_metadata(&dir).expect("pack path");
        let png = encode_to_png_with_encryption_name_and_filelist_internal(&pack_result.data, 3, None, None, None, pack_result.file_list_json.as_deref(), None)
            .expect("encode should succeed");

        let payload = crate::png_utils::extract_payload_from_png(&png).expect("extract payload");
        assert!(payload.len() > 1);
        assert_eq!(payload[0], 0x00u8);

        let compressed = payload[1..].to_vec();
        let mut decompressed = crate::core::zstd_decompress_bytes(&compressed, None).expect("decompress");
        if decompressed.starts_with(b"ROX1") {
            decompressed = decompressed[4..].to_vec();
        }

        let out_dir = base.join("out");
        fs::create_dir_all(&out_dir).unwrap();

        let written = crate::packer::unpack_buffer_to_dir(&decompressed, &out_dir, Some(&["sub/b.txt".to_string()])).expect("unpack");
        assert_eq!(written.len(), 1);
        let got = fs::read_to_string(out_dir.join("sub").join("b.txt")).unwrap();
        assert_eq!(got, "world");
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let data = b"hello world".to_vec();
                let png = encode_to_png_with_encryption_name_and_filelist(&data, 3, Some("password"), Some("aes"), None, None)
            .expect("encode should succeed");
                let payload = crate::png_utils::extract_payload_from_png(&png).expect("extract");
                let decrypted = crate::crypto::try_decrypt(&payload, Some("password")).expect("decrypt");
                let mut decompressed = crate::core::zstd_decompress_bytes(&decrypted, None).expect("decompress");
        if decompressed.starts_with(b"ROX1") { decompressed = decompressed[4..].to_vec(); }
                assert_eq!(decompressed, data);
    }

    #[test]
    fn test_marker_end_in_last_3_pixels() {
        use image::ImageReader;
        use std::io::Cursor;

        for size in &[11, 100, 1000, 5000, 50000] {
            let data: Vec<u8> = (0..*size).map(|i| (i % 256) as u8).collect();

            let png_raw = encode_to_png_raw(&data, 3).expect("encode raw");
            let png_auto = encode_to_png(&data, 3).expect("encode auto");

            for (label, png) in &[("raw", &png_raw), ("auto", &png_auto)] {
                let reader = ImageReader::new(Cursor::new(*png))
                    .with_guessed_format().unwrap();
                let img = reader.decode().unwrap();
                let rgb = img.to_rgb8();
                let w = rgb.width();
                let h = rgb.height();

                let p1 = rgb.get_pixel(w - 3, h - 1);
                let p2 = rgb.get_pixel(w - 2, h - 1);
                let p3 = rgb.get_pixel(w - 1, h - 1);

                assert_eq!([p1[0], p1[1], p1[2]], [0, 0, 255],
                    "MARKER_END pixel 0 (blue) wrong for {}@size={}, got {:?}", label, size, p1);
                assert_eq!([p2[0], p2[1], p2[2]], [0, 255, 0],
                    "MARKER_END pixel 1 (green) wrong for {}@size={}, got {:?}", label, size, p2);
                assert_eq!([p3[0], p3[1], p3[2]], [255, 0, 0],
                    "MARKER_END pixel 2 (red) wrong for {}@size={}, got {:?}", label, size, p3);
            }
        }
    }
}
