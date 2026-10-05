use anyhow::Result;


const MAGIC: &[u8] = b"ROX1";
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

    let mut png = Vec::with_capacity(encrypted.len() + 1024);
    crate::png_writer::write_png(&mut png, &encrypted, name, file_list)?;
    Ok(png)
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
