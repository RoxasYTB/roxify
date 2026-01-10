use napi::bindgen_prelude::*;
use napi_derive::napi;

mod core;
mod common;
mod gpu;
mod rans;
mod bwt;
mod context_mixing;
mod pool;
mod hybrid;

pub use core::*;
pub use gpu::*;
pub use rans::*;
pub use bwt::*;
pub use context_mixing::*;
pub use pool::*;
pub use hybrid::*;

#[napi(object)]
pub struct ScanResult {
    pub marker_positions: Vec<u32>,
    pub magic_positions: Vec<u32>,
}

#[napi(object)]
pub struct CompressionReport {
    pub original_size: f64,
    pub compressed_size: f64,
    pub ratio: f64,
    pub entropy_bits: f64,
    pub blocks_count: u32,
}

#[napi(object)]
pub struct GpuStatus {
    pub available: bool,
    pub adapter_info: Option<String>,
}

#[cfg(not(test))]
#[napi]
pub fn scan_pixels(buffer: Buffer, channels: u32, marker_bytes: Option<Buffer>) -> Result<ScanResult> {
    let slice: &[u8] = &buffer;
    let markers_slice: Option<&[u8]> = marker_bytes.as_ref().map(|b| &**b);
    let res = common::scan_pixels_bytes(slice, channels as usize, markers_slice);
    Ok(ScanResult { marker_positions: res.marker_positions, magic_positions: res.magic_positions })
}

#[cfg(not(test))]
#[napi]
pub fn native_crc32(buffer: Buffer) -> u32 {
    common::crc32_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_adler32(buffer: Buffer) -> u32 {
    common::adler32_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_delta_encode(buffer: Buffer) -> Vec<u8> {
    common::delta_encode_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_delta_decode(buffer: Buffer) -> Vec<u8> {
    common::delta_decode_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_zstd_compress(buffer: Buffer, level: i32) -> Result<Vec<u8>> {
    common::zstd_compress_bytes(&buffer, level).map_err(|e| Error::from_reason(e))
}

#[cfg(not(test))]
#[napi]
pub fn native_zstd_decompress(buffer: Buffer) -> Result<Vec<u8>> {
    common::zstd_decompress_bytes(&buffer).map_err(|e| Error::from_reason(e))
}

#[cfg(not(test))]
#[napi]
pub fn check_gpu_status() -> GpuStatus {
    GpuStatus {
        available: gpu::gpu_available(),
        adapter_info: None,
    }
}

#[cfg(not(test))]
#[napi]
pub fn bwt_transform(buffer: Buffer) -> Result<Vec<u8>> {
    let data = buffer.to_vec();
    match bwt::bwt_encode(&data) {
        Ok(result) => {
            let mut output = Vec::with_capacity(4 + result.transformed.len());
            output.extend_from_slice(&result.primary_index.to_le_bytes());
            output.extend_from_slice(&result.transformed);
            Ok(output)
        }
        Err(e) => Err(Error::from_reason(e.to_string())),
    }
}

#[cfg(not(test))]
#[napi]
pub fn entropy_estimate(buffer: Buffer) -> f32 {
    context_mixing::analyze_entropy(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn hybrid_compress(buffer: Buffer) -> Result<Vec<u8>> {
    match hybrid::compress_high_performance(&buffer) {
        Ok((compressed, _stats)) => Ok(compressed),
        Err(e) => Err(Error::from_reason(e.to_string())),
    }
}

#[cfg(not(test))]
#[napi]
pub fn hybrid_decompress(buffer: Buffer) -> Result<Vec<u8>> {
    hybrid::decompress_high_performance(&buffer)
        .map_err(|e| Error::from_reason(e.to_string()))
}

#[cfg(not(test))]
#[napi]
pub fn get_compression_stats(buffer: Buffer) -> CompressionReport {
    match hybrid::compress_high_performance(&buffer) {
        Ok((_compressed, stats)) => CompressionReport {
            original_size: stats.original_size as f64,
            compressed_size: stats.compressed_size as f64,
            ratio: stats.ratio,
            entropy_bits: stats.entropy_bits as f64,
            blocks_count: stats.blocks_count as u32,
        },
        Err(_) => CompressionReport {
            original_size: buffer.len() as f64,
            compressed_size: 0.0,
            ratio: 0.0,
            entropy_bits: 0.0,
            blocks_count: 0,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scan_magic() {
        let data = b"xxxxROX1yyyyROX1".to_vec();
        let res = common::scan_pixels_bytes(&data, 3, None);
        assert_eq!(res.magic_positions.len(), 2);
    }

    #[test]
    fn test_bwt() {
        let data = b"banana".to_vec();
        let enc = bwt::bwt_encode(&data).unwrap();
        assert!(!enc.transformed.is_empty());
    }

    #[test]
    fn test_entropy() {
        let data = b"aaaaabbbcc";
        let entropy = context_mixing::analyze_entropy(data);
        assert!(entropy > 0.0 && entropy < 8.0);
    }
}
