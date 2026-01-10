use rayon::prelude::*;
use std::sync::Arc;

pub struct PlainScanResult {
    pub marker_positions: Vec<u32>,
    pub magic_positions: Vec<u32>,
}

pub fn scan_pixels_bytes(buf: &[u8], channels: usize, marker_bytes: Option<&[u8]>) -> PlainScanResult {
    let magic = b"ROX1";

    let magic_positions: Vec<u32> = if buf.len() >= 4 {
        (0..(buf.len() - 3))
            .into_par_iter()
            .filter_map(|i| if &buf[i..i + 4] == magic { Some(i as u32) } else { None })
            .collect()
    } else {
        Vec::new()
    };

    let markers: Vec<[u8; 3]> = match marker_bytes {
        Some(bytes) if !bytes.is_empty() => {
            if bytes.len() % 3 != 0 {
                return PlainScanResult { marker_positions: Vec::new(), magic_positions };
            }
            bytes.chunks(3).map(|c| [c[0], c[1], c[2]]).collect()
        }
        _ => Vec::new(),
    };

    let marker_positions = if markers.is_empty() {
        Vec::new()
    } else {
        let markers = Arc::new(markers);
        let ch = channels as usize;
        if ch < 3 || buf.len() < 3 {
            Vec::new()
        } else {
            let pixel_count = buf.len() / ch;
            (0..pixel_count)
                .into_par_iter()
                .filter_map(|i| {
                    let base = i * ch;
                    if base + 3 > buf.len() {
                        return None;
                    }
                    for m in markers.iter() {
                        if buf[base] == m[0] && buf[base + 1] == m[1] && buf[base + 2] == m[2] {
                            return Some(i as u32);
                        }
                    }
                    None
                })
                .collect()
        }
    };

    PlainScanResult { marker_positions, magic_positions }
}

pub fn crc32_bytes(buf: &[u8]) -> u32 {
    crc32fast::hash(buf)
}

pub fn adler32_bytes(buf: &[u8]) -> u32 {
    const MOD: u32 = 65521;
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &v in buf {
        a = (a + v as u32) % MOD;
        b = (b + a) % MOD;
    }
    (b << 16) | a
}

pub fn delta_encode_bytes(buf: &[u8]) -> Vec<u8> {
    let len = buf.len();
    if len == 0 {
        return Vec::new();
    }
    (0..len)
        .into_par_iter()
        .map(|i| {
            if i == 0 {
                buf[0]
            } else {
                buf[i].wrapping_sub(buf[i - 1])
            }
        })
        .collect()
}

pub fn delta_decode_bytes(buf: &[u8]) -> Vec<u8> {
    let len = buf.len();
    if len == 0 {
        return Vec::new();
    }
    let mut out = vec![0u8; len];
    out[0] = buf[0];
    for i in 1..len {
        out[i] = out[i - 1].wrapping_add(buf[i]);
    }
    out
}

pub fn zstd_compress_bytes(buf: &[u8], level: i32) -> std::result::Result<Vec<u8>, String> {
    use std::io::Write;
    let mut encoder = zstd::stream::Encoder::new(Vec::new(), level)
        .map_err(|e| format!("zstd encoder init error: {}", e))?;
    
    encoder.window_log(32).map_err(|e| format!("zstd window_log error: {}", e))?;
    
    let threads = num_cpus::get() as u32;
    if threads > 1 {
        let _ = encoder.multithread(threads);
    }
    encoder.write_all(buf).map_err(|e| format!("zstd write error: {}", e))?;
    encoder.finish().map_err(|e| format!("zstd finish error: {}", e))
}

pub fn zstd_decompress_bytes(buf: &[u8]) -> std::result::Result<Vec<u8>, String> {
    zstd::stream::decode_all(buf).map_err(|e| format!("zstd decompress error: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_magic() {
        let data = b"xxxxROX1yyyyROX1".to_vec();
        let res = scan_pixels_bytes(&data, 3, None);
        assert_eq!(res.magic_positions.len(), 2);
    }

    #[test]
    fn test_markers() {
        let pixels = vec![1u8,2,3, 4,5,6, 1,2,3];
        let markers_vec = vec![1u8,2,3];
        let res = scan_pixels_bytes(&pixels, 3, Some(&markers_vec));
        assert_eq!(res.marker_positions, vec![0,2]);
    }

    #[test]
    fn test_delta_roundtrip() {
        let data = vec![10u8, 20, 30, 40, 250];
        let enc = delta_encode_bytes(&data);
        let dec = delta_decode_bytes(&enc);
        assert_eq!(dec, data);
    }

    #[test]
    fn test_crc_adler() {
        let data = b"hello".to_vec();
        assert_eq!(crc32_bytes(&data), crc32fast::hash(&data));
        assert_eq!(adler32_bytes(&data), adler32_bytes(&data));
    }
}
