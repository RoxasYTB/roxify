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

    let f = File::create(output_path)?;
    let mut w = BufWriter::with_capacity(1024 * 1024, f);
    crate::png_writer::write_png(&mut w, &encrypted, name, file_list)?;
    w.flush()?;
    Ok(())
}
