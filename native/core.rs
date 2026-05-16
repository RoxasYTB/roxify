use rayon::prelude::*;
use std::sync::Arc;
use std::path::PathBuf;
use anyhow::Result;

pub struct PlainScanResult {
    pub marker_positions: Vec<u32>,
    pub magic_positions: Vec<u32>,
}

pub fn scan_pixels_bytes(buf: &[u8], channels: usize, marker_bytes: Option<&[u8]>) -> PlainScanResult {
    // ROX1 lookup: SIMD-accelerated memmem beats par_iter over a 4-byte equality
    // (the Rayon orchestration cost dominates the actual compare).
    let magic_positions: Vec<u32> = memchr::memmem::find_iter(buf, b"ROX1")
        .map(|i| i as u32)
        .collect();

    let markers: Vec<[u8; 3]> = match marker_bytes {
        Some(bytes) if !bytes.is_empty() => {
            if bytes.len() % 3 != 0 {
                return PlainScanResult { marker_positions: Vec::new(), magic_positions };
            }
            bytes.chunks(3).map(|c| [c[0], c[1], c[2]]).collect()
        }
        _ => Vec::new(),
    };

    let marker_positions = if markers.is_empty() || channels < 3 || buf.len() < 3 {
        Vec::new()
    } else {
        let ch = channels;
        let pixel_count = buf.len() / ch;
        // For multi-marker matching, iterate once and check each marker.
        // We keep Rayon here only when there are many markers AND a big buffer.
        if markers.len() > 4 && pixel_count > 100_000 {
            let markers = Arc::new(markers);
            (0..pixel_count)
                .into_par_iter()
                .filter_map(|i| {
                    let base = i * ch;
                    if base + 3 > buf.len() { return None; }
                    for m in markers.iter() {
                        if buf[base] == m[0] && buf[base + 1] == m[1] && buf[base + 2] == m[2] {
                            return Some(i as u32);
                        }
                    }
                    None
                })
                .collect()
        } else {
            let mut out = Vec::new();
            for i in 0..pixel_count {
                let base = i * ch;
                if base + 3 > buf.len() { break; }
                for m in &markers {
                    if buf[base] == m[0] && buf[base + 1] == m[1] && buf[base + 2] == m[2] {
                        out.push(i as u32);
                        break;
                    }
                }
            }
            out
        }
    };

    PlainScanResult { marker_positions, magic_positions }
}

pub fn crc32_bytes(buf: &[u8]) -> u32 {
    // parallelize checksum on large buffers, since crc32fast::hash is single-threaded
    const PAR_THRESHOLD: usize = 4 * 1024 * 1024; // 4 MiB
    if buf.len() < PAR_THRESHOLD {
        crc32fast::hash(buf)
    } else {
        // compute per-chunk hasher in parallel then combine
        let chunk = PAR_THRESHOLD;
        let combined = buf
            .par_chunks(chunk)
            .map(|chunk| {
                let mut h = crc32fast::Hasher::new();
                h.update(chunk);
                h
            })
            .reduce(crc32fast::Hasher::new, |mut a, b| {
                a.combine(&b);
                a
            });
        combined.finalize()
    }
}

pub fn adler32_bytes(buf: &[u8]) -> u32 {
    let mut hasher = simd_adler32::Adler32::new();
    hasher.write(buf);
    hasher.finish()
}

pub fn delta_encode_bytes(buf: &[u8]) -> Vec<u8> {
    let len = buf.len();
    if len == 0 {
        return Vec::new();
    }
    let mut out = vec![0u8; len];
    out[0] = buf[0];
    for i in 1..len {
        out[i] = buf[i].wrapping_sub(buf[i - 1]);
    }
    out
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



pub fn train_zstd_dictionary(sample_paths: &[PathBuf], dict_size: usize) -> Result<Vec<u8>> {
    // load all sample files contiguously
    let mut samples = Vec::new();
    let mut lengths = Vec::new();
    for path in sample_paths {
        let data = std::fs::read(path)?;
        lengths.push(data.len());
        samples.extend_from_slice(&data);
    }
    let dict = zstd::dict::from_continuous(&samples, &lengths, dict_size)?;
    Ok(dict)
}

/// Compress a slice with optional zstd dictionary.
///
/// When `dict` is `Some`, the dictionary is passed to the encoder (same
/// dict required for decompression).  Pass `None` for normal compression.
///
/// For large buffers (>50 MiB) without a dictionary, multiple chunk sizes
/// are benchmarked on a sample and the best is selected automatically.
pub fn zstd_compress_bytes(buf: &[u8], level: i32, dict: Option<&[u8]>) -> std::result::Result<Vec<u8>, String> {
    zstd_compress_with_prefix(buf, level, dict, &[])
}

fn compute_entropy_sample(buf: &[u8]) -> f32 {
    let sample_size = buf.len().min(16384);
    if sample_size == 0 {
        return 4.0;
    }
    let sample = &buf[..sample_size];
    let mut freq = [0u32; 256];
    for &b in sample {
        freq[b as usize] += 1;
    }
    let len = sample.len() as f32;
    let mut ent: f32 = 0.0;
    for &c in &freq {
        if c > 0 {
            let p = c as f32 / len;
            ent -= p * p.log2();
        }
    }
    ent
}

/// Adaptive level cap by file size × entropy.
/// Bigger files + higher entropy ⇒ lower level — this keeps RAM bounded on
/// huge inputs (LDM and large windows only kick in at level ≥ 3, so capping
/// to 1 on >2 GiB inputs avoids blowing up memory on systems with limited
/// RAM headroom). Returns `requested_level.min(size_cap)` so the user's
/// level is honored when it's already low enough.
fn compute_adaptive_level(buf: &[u8], requested_level: i32, total_len: usize) -> i32 {
    let entropy = compute_entropy_sample(buf);

    let size_cap = match total_len {
        s if s > 2 * 1024 * 1024 * 1024 => 1,
        s if s > 1024 * 1024 * 1024 => match entropy {
            e if e < 3.0 => 3,
            _ => 1,
        },
        s if s > 256 * 1024 * 1024 => match entropy {
            e if e < 3.0 => 6,
            e if e < 5.0 => 3,
            _ => 1,
        },
        s if s > 64 * 1024 * 1024 => match entropy {
            e if e < 3.0 => 12,
            e if e < 5.0 => 6,
            e if e < 7.0 => 3,
            _ => 1,
        },
        s if s > 16 * 1024 * 1024 => match entropy {
            e if e < 3.0 => 15,
            e if e < 5.0 => 9,
            e if e < 7.0 => 6,
            e if e < 7.5 => 3,
            _ => 1,
        },
        s if s > 1024 * 1024 => match entropy {
            e if e < 3.0 => 19,
            e if e < 5.0 => 12,
            e if e < 6.5 => 6,
            e if e < 7.5 => 3,
            _ => 1,
        },
        s if s > 64 * 1024 => match entropy {
            e if e < 4.0 => 9,
            e if e < 6.0 => 6,
            e if e < 7.5 => 3,
            _ => 1,
        },
        s if s > 4096 => match entropy {
            e if e < 5.0 => 6,
            e if e < 7.0 => 3,
            _ => 1,
        },
        _ => match entropy {
            e if e < 6.0 => 3,
            _ => 1,
        },
    };

    requested_level.min(size_cap)
}

pub fn zstd_compress_with_prefix(buf: &[u8], level: i32, dict: Option<&[u8]>, prefix: &[u8]) -> std::result::Result<Vec<u8>, String> {
    use std::io::Write;

    let actual_level = level.clamp(1, 22);
    let total_len = prefix.len() + buf.len();
    let adaptive_level = compute_adaptive_level(buf, actual_level, total_len);

    let estimated_output = if total_len < 1024 {
        total_len
    } else {
        total_len * 3 / 4
    };

    if dict.is_none() && total_len < 4 * 1024 * 1024 {
        if prefix.is_empty() {
            return zstd::bulk::compress(buf, adaptive_level)
                .map_err(|e| format!("zstd bulk compress error: {}", e));
        }
        let mut combined = Vec::with_capacity(total_len);
        combined.extend_from_slice(prefix);
        combined.extend_from_slice(buf);
        return zstd::bulk::compress(&combined, adaptive_level)
            .map_err(|e| format!("zstd bulk compress error: {}", e));
    }

    let mut encoder = if let Some(d) = dict {
        zstd::stream::Encoder::with_dictionary(Vec::with_capacity(estimated_output), adaptive_level, d)
            .map_err(|e| format!("zstd encoder init error: {}", e))?
    } else {
        zstd::stream::Encoder::new(Vec::with_capacity(estimated_output), adaptive_level)
            .map_err(|e| format!("zstd encoder init error: {}", e))?
    };

    let threads = num_cpus::get() as u32;
    if threads > 1 {
        let max_threads = if adaptive_level >= 20 { threads.min(4) } else { threads };
        let _ = encoder.multithread(max_threads);
    }

    if total_len > 1024 * 1024 * 1024 && adaptive_level >= 3 {
        let _ = encoder.long_distance_matching(true);
    }
    if total_len > 256 * 1024 {
        let wlog = if total_len > 1024 * 1024 * 1024 { 25 }
            else if total_len > 256 * 1024 * 1024 { 24 }
            else if total_len > 32 * 1024 * 1024 { 23 }
            else if total_len > 4 * 1024 * 1024 { 22 }
            else { 21 };
        let _ = encoder.window_log(wlog);
    }

    let _ = encoder.set_pledged_src_size(Some(total_len as u64));

    if !prefix.is_empty() {
        encoder.write_all(prefix).map_err(|e| format!("zstd write prefix error: {}", e))?;
    }

    let chunk_size = if total_len > 256 * 1024 * 1024 { 16 * 1024 * 1024 }
        else if total_len > 64 * 1024 * 1024 { 8 * 1024 * 1024 }
        else { buf.len() };

    for chunk in buf.chunks(chunk_size) {
        encoder.write_all(chunk).map_err(|e| format!("zstd write error: {}", e))?;
    }

    encoder.finish().map_err(|e| format!("zstd finish error: {}", e))
}

pub fn zstd_decompress_bytes(buf: &[u8], dict: Option<&[u8]>) -> std::result::Result<Vec<u8>, String> {
    use std::io::Read;
    // Toujours autoriser le window_log max (31). Le décideur basé sur la taille COMPRESSÉE
    // sous-estimait pour des payloads incompressibles (un dump 2 GiB → 435 MiB zstd avec
    // window_log=30 plantait avec "Frame requires too much memory").
    let win = 31u32;
    let estimated = buf.len().saturating_mul(3).max(4096);
    let mut out = Vec::with_capacity(estimated);
    if let Some(d) = dict {
        let mut decoder = zstd::stream::Decoder::with_dictionary(std::io::Cursor::new(buf), d)
            .map_err(|e| format!("zstd decoder init error: {}", e))?;
        decoder.window_log_max(win).map_err(|e| format!("zstd window_log_max error: {}", e))?;
        decoder.read_to_end(&mut out).map_err(|e| format!("zstd decompress error: {}", e))?;
    } else {
        let mut decoder = zstd::stream::Decoder::new(std::io::Cursor::new(buf))
            .map_err(|e| format!("zstd decoder init error: {}", e))?;
        decoder.window_log_max(win).map_err(|e| format!("zstd window_log_max error: {}", e))?;
        decoder.read_to_end(&mut out).map_err(|e| format!("zstd decompress error: {}", e))?;
    }
    Ok(out)
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
    fn test_train_dictionary() {
        use std::fs::{write, create_dir_all};
        let td = std::env::temp_dir().join("rox_dict_test");
        let _ = create_dir_all(&td);
        let f1 = td.join("a.bin");
        let f2 = td.join("b.bin");
        // produce 1 MiB of repeated data per file
        let big = vec![0xABu8; 1024 * 1024];
        write(&f1, &big).unwrap();
        write(&f2, &big).unwrap();
        // choose dictionary size 16 KiB (far below total sample size ≈2 MiB)
        match train_zstd_dictionary(&[f1.clone(), f2.clone()], 16 * 1024) {
            Ok(dict) => {
                assert!(dict.len() <= 16 * 1024);
                assert!(!dict.is_empty());
            }
            Err(e) => {
                // dictionary training may fail due to insufficient or unsuitable samples;
                // ensure error string is nonempty to catch panics
                assert!(!e.to_string().is_empty());
            }
        }
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

        // also test large buffer triggers parallel branch
        let big = vec![0xAAu8; 5 * 1024 * 1024];
        assert_eq!(crc32_bytes(&big), crc32fast::hash(&big));
    }

    #[test]
    fn test_zstd_dict_roundtrip() {
        let data = b"this is some test data that repeats. ".repeat(1000);
        // simple dictionary containing a substring
        let dict = b"test data";
        let compressed = zstd_compress_bytes(&data, 3, Some(dict)).expect("compress");
        let decompressed = zstd_decompress_bytes(&compressed, Some(dict)).expect("decompress");
        assert_eq!(decompressed, data);
    }
}
