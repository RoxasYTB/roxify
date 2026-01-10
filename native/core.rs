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

fn compress_with_chunk_size(buf: &[u8], level: i32, chunk_size: usize) -> std::result::Result<Vec<u8>, String> {
    use std::io::Write;

    let actual_level = if level >= 19 { 22 } else { level };
    let mut encoder = zstd::stream::Encoder::new(Vec::new(), actual_level)
        .map_err(|e| format!("zstd encoder init error: {}", e))?;

    let threads = num_cpus::get() as u32;
    if threads > 1 {
        let _ = encoder.multithread(threads);
    }

    if buf.len() > 10 * 1024 * 1024 {
        let _ = encoder.long_distance_matching(true);
    }

    let _ = encoder.set_pledged_src_size(Some(buf.len() as u64));

    for chunk in buf.chunks(chunk_size) {
        encoder.write_all(chunk).map_err(|e| format!("zstd write error: {}", e))?;
    }

    encoder.finish().map_err(|e| format!("zstd finish error: {}", e))
}

pub fn zstd_compress_bytes(buf: &[u8], level: i32) -> std::result::Result<Vec<u8>, String> {
    if buf.len() < 50 * 1024 * 1024 {
        return compress_with_chunk_size(buf, level, buf.len());
    }

    let test_sizes = [
        4 * 1024 * 1024,
        8 * 1024 * 1024,
        16 * 1024 * 1024,
        32 * 1024 * 1024,
    ];

    let sample_size = (buf.len() / 5).min(100 * 1024 * 1024);
    let sample = &buf[..sample_size];

    let mut best_ratio = f64::MAX;
    let mut best_chunk_size = buf.len();

    for &chunk_size in &test_sizes {
        if chunk_size >= sample.len() / 3 {
            continue;
        }

        if let Ok(compressed) = compress_with_chunk_size(sample, level, chunk_size) {
            let ratio = compressed.len() as f64 / sample.len() as f64;
            if ratio < best_ratio && ratio < 0.99 {
                best_ratio = ratio;
                best_chunk_size = chunk_size;
            }
        }
    }

    compress_with_chunk_size(buf, level, best_chunk_size)
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
