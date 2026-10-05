pub struct DecodedPayload {
    pub payload: Vec<u8>,
    pub name: Option<String>,
    pub decoded: bool,
}

/// Keep PNG extraction and decompression in Rust so the compressed payload
/// doesn't need its own allocation or a roundtrip through JavaScript.
pub fn decode_png(png: &[u8], passphrase: Option<&str>) -> Result<DecodedPayload, String> {
    crate::png_utils::with_payload_and_name(png, |payload, name| {
        let decrypted;
        let compressed = match payload.first() {
            Some(0) => &payload[1..],
            Some(2) if passphrase.is_some_and(|pass| !pass.is_empty()) => {
                decrypted = crate::crypto::decrypt_xor(&payload[1..], passphrase.unwrap())
                    .map_err(|e| e.to_string())?;
                &decrypted
            }
            // AES uses Node's existing OpenSSL implementation. Leave error
            // handling for missing passwords and unsupported flags there too.
            _ => return Ok(DecodedPayload { payload: payload.to_vec(), name, decoded: false }),
        };
        // Older archives may contain an uncompressed ROX1 payload.
        let payload = crate::core::zstd_decompress_bytes(compressed, None)
            .unwrap_or_else(|_| compressed.to_vec());
        Ok(DecodedPayload { payload, name, decoded: true })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_plain_and_xor_decode() {
        for data in [&b""[..], &b"hello\0world"[..]] {
            for passphrase in [None, Some("clé-文")] {
                for name in [None, Some("fichier.bin")] {
                    let png = crate::encoder::encode_to_png_with_encryption_and_name(
                        data, 3, passphrase, Some("xor"), name,
                    ).unwrap();
                    let result = decode_png(&png, passphrase).unwrap();
                    assert!(result.decoded);
                    assert_eq!(result.name.as_deref(), name);
                    assert_eq!(&result.payload[..4], b"ROX1");
                    assert_eq!(&result.payload[4..], data);
                    if passphrase.is_some() {
                        assert!(!decode_png(&png, None).unwrap().decoded);
                    }
                }
            }
        }
    }

    #[test]
    fn test_raw_and_encrypted_payloads() {
        for payload in [b"\0ROX1raw data".to_vec(), vec![1; 46], vec![3; 65]] {
            let mut png = Vec::new();
            crate::png_writer::write_png(&mut png, &payload, Some("raw.bin"), None).unwrap();
            let result = decode_png(&png, Some("password")).unwrap();
            assert_eq!(result.decoded, payload[0] == 0);
            assert_eq!(result.name.as_deref(), Some("raw.bin"));
            assert_eq!(result.payload, if result.decoded { &payload[1..] } else { &payload[..] });
        }
    }

    #[test]
    fn test_reject_invalid_png() {
        assert!(decode_png(b"invalid", None).is_err());
    }
}
