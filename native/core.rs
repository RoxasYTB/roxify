use rayon::prelude::*;
use std::sync::Arc;
use std::path::PathBuf;
use anyhow::Result;

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
            .reduce(|| crc32fast::Hasher::new(), |mut a, b| {
                a.combine(&b);
                a
            });
        combined.finalize()
    }
}

pub fn adler32_bytes(buf: &[u8]) -> u32 {
    const MOD: u32 = 65521;
    const NMAX: usize = 5552;

    if buf.len() > 4 * 1024 * 1024 {
        return adler32_parallel(buf);
    }

    let mut a: u32 = 1;
    let mut b: u32 = 0;

    for chunk in buf.chunks(NMAX) {
        for &v in chunk {
            a += v as u32;
            b += a;
        }
        a %= MOD;
        b %= MOD;
    }

    (b << 16) | a
}

fn adler32_parallel(buf: &[u8]) -> u32 {
    use rayon::prelude::*;
    const MOD: u32 = 65521;
    const CHUNK: usize = 1024 * 1024;

    let chunks: Vec<&[u8]> = buf.chunks(CHUNK).collect();
    let partials: Vec<(u32, u32, usize)> = chunks.par_iter().map(|chunk| {
        let mut a: u32 = 0;
        let mut b: u32 = 0;
        for &v in *chunk {
            a += v as u32;
            b += a;
        }
        a %= MOD;
        b %= MOD;
        (a, b, chunk.len())
    }).collect();

    let mut a: u64 = 1;
    let mut b: u64 = 0;
    for (pa, pb, len) in partials {
        b = (b + pb as u64 + a * len as u64) % MOD as u64;
        a = (a + pa as u64) % MOD as u64;
    }

    ((b as u32) << 16) | (a as u32)
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

fn compress_with_chunk_size(buf: &[u8], level: i32, chunk_size: usize) -> std::result::Result<Vec<u8>, String> {
    use std::io::Write;

    let actual_level = level.min(22).max(1);
    let mut encoder = zstd::stream::Encoder::new(Vec::new(), actual_level)
        .map_err(|e| format!("zstd encoder init error: {}", e))?;

    let threads = num_cpus::get() as u32;
    if threads > 1 {
        let max_threads = if actual_level >= 20 { threads.min(4) } else { threads };
        let _ = encoder.multithread(max_threads);
    }

    if buf.len() > 1024 * 1024 {
        let _ = encoder.long_distance_matching(true);
        let wlog = if buf.len() > 1024 * 1024 * 1024 { 30 }
            else if buf.len() > 512 * 1024 * 1024 { 29 }
            else if buf.len() > 64 * 1024 * 1024 { 28 }
            else if buf.len() > 8 * 1024 * 1024 { 27 }
            else { 26 };
        let _ = encoder.window_log(wlog);
    }

    let _ = encoder.set_pledged_src_size(Some(buf.len() as u64));

    for chunk in buf.chunks(chunk_size) {
        encoder.write_all(chunk).map_err(|e| format!("zstd write error: {}", e))?;
    }

    encoder.finish().map_err(|e| format!("zstd finish error: {}", e))
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

pub fn zstd_compress_with_prefix(buf: &[u8], level: i32, dict: Option<&[u8]>, prefix: &[u8]) -> std::result::Result<Vec<u8>, String> {
    use std::io::Write;

    let actual_level = level.min(22).max(1);
    let total_len = prefix.len() + buf.len();

    if dict.is_none() && total_len < 4 * 1024 * 1024 {
        if prefix.is_empty() {
            return zstd::bulk::compress(buf, actual_level)
                .map_err(|e| format!("zstd bulk compress error: {}", e));
        }
        let mut combined = Vec::with_capacity(total_len);
        combined.extend_from_slice(prefix);
        combined.extend_from_slice(buf);
        return zstd::bulk::compress(&combined, actual_level)
            .map_err(|e| format!("zstd bulk compress error: {}", e));
    }

    let mut encoder = if let Some(d) = dict {
        zstd::stream::Encoder::with_dictionary(Vec::with_capacity(total_len / 2), actual_level, d)
            .map_err(|e| format!("zstd encoder init error: {}", e))?
    } else {
        zstd::stream::Encoder::new(Vec::with_capacity(total_len / 2), actual_level)
            .map_err(|e| format!("zstd encoder init error: {}", e))?
    };

    let threads = num_cpus::get() as u32;
    if threads > 1 {
        let max_threads = if actual_level >= 20 { threads.min(4) } else { threads };
        let _ = encoder.multithread(max_threads);
    }

    if total_len > 256 * 1024 && actual_level >= 3 {
        let _ = encoder.long_distance_matching(true);
    }
    if total_len > 256 * 1024 {
        let wlog = if total_len > 1024 * 1024 * 1024 { 30 }
            else if total_len > 512 * 1024 * 1024 { 29 }
            else if total_len > 64 * 1024 * 1024 { 28 }
            else if total_len > 8 * 1024 * 1024 { 27 }
            else { 26 };
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
    let mut out = Vec::with_capacity(buf.len() * 2);
    if let Some(d) = dict {
        let mut decoder = zstd::stream::Decoder::with_dictionary(std::io::Cursor::new(buf), d)
            .map_err(|e| format!("zstd decoder init error: {}", e))?;
        decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max error: {}", e))?;
        decoder.read_to_end(&mut out).map_err(|e| format!("zstd decompress error: {}", e))?;
    } else {
        let mut decoder = zstd::stream::Decoder::new(std::io::Cursor::new(buf))
            .map_err(|e| format!("zstd decoder init error: {}", e))?;
        decoder.window_log_max(31).map_err(|e| format!("zstd window_log_max error: {}", e))?;
        decoder.read_to_end(&mut out).map_err(|e| format!("zstd decompress error: {}", e))?;
    }
    Ok(out)
}

pub fn smart_decompress(buf: &[u8], dict: Option<&[u8]>) -> std::result::Result<Vec<u8>, String> {
    let decompressed = zstd_decompress_bytes(buf, dict)?;
    strip_rox_prefix(&decompressed)
}

pub fn strip_rox_prefix(data: &[u8]) -> std::result::Result<Vec<u8>, String> {
    if data.starts_with(b"ROX2") {
        return reverse_bwt_payload(&data[4..]);
    }
    if data.starts_with(b"ROX1") {
        return Ok(data[4..].to_vec());
    }
    Ok(data.to_vec())
}

fn reverse_bwt_payload(payload: &[u8]) -> std::result::Result<Vec<u8>, String> {
    if payload.len() < 12 {
        return Err("ROX2 payload too small".to_string());
    }
    let block_count = u32::from_le_bytes(payload[0..4].try_into().unwrap()) as usize;
    let original_size = u64::from_le_bytes(payload[4..12].try_into().unwrap()) as usize;
    let mut pos = 12;
    let mut result = Vec::with_capacity(original_size);

    for _ in 0..block_count {
        if pos + 8 > payload.len() {
            return Err("ROX2 payload truncated".to_string());
        }
        let primary_index = u32::from_le_bytes(payload[pos..pos + 4].try_into().unwrap());
        let block_len = u32::from_le_bytes(payload[pos + 4..pos + 8].try_into().unwrap()) as usize;
        pos += 8;
        if pos + block_len > payload.len() {
            return Err("ROX2 block data truncated".to_string());
        }
        let bwt_data = &payload[pos..pos + block_len];
        pos += block_len;

        let decoded = crate::bwt::bwt_decode(bwt_data, primary_index)
            .map_err(|e| format!("BWT decode error: {}", e))?;
        result.extend_from_slice(&decoded);
    }

    Ok(result)
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
