use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;

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
    encode_to_png_file_with_profile(
        data, output_path, compression_level, passphrase, encrypt_type, name, file_list, dict, false,
    )
}

pub fn encode_to_png_file_with_profile(
    data: &[u8],
    output_path: &Path,
    compression_level: i32,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    name: Option<&str>,
    file_list: Option<&str>,
    dict: Option<&[u8]>,
    max_compression: bool,
) -> anyhow::Result<()> {
    let compressed = crate::core::zstd_compress_parts_with_prefix_profile(
        &[data], compression_level, dict, MAGIC, max_compression,
    )
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

    let f = File::create(output_path)?;
    let mut w = BufWriter::with_capacity(1024 * 1024, f);
    crate::png_writer::write_png(&mut w, &encrypted, name, file_list)?;
    w.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_output_preserves_the_selected_compression_profile() {
        let path = std::env::temp_dir().join(format!("rox-profile-{}.png", rand::random::<u64>()));
        let data = b"repeated profile fixture".repeat(4000);
        for max_compression in [false, true] {
            encode_to_png_file_with_profile(
                &data, &path, 9, None, None, Some("fixture.bin"), None, None, max_compression,
            ).unwrap();
            let png = std::fs::read(&path).unwrap();
            let expected = crate::encoder::encode_parts_to_png_with_profile(
                &[&data], 9, None, None, Some("fixture.bin"), None, None, max_compression,
            ).unwrap();
            assert_eq!(png, expected);
        }
        std::fs::remove_file(path).unwrap();
    }
}
