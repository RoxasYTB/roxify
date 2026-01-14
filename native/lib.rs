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
mod encoder;
mod packer;
mod crypto;
mod png_utils;
mod image_utils;
mod progress;
mod reconstitution;

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

#[cfg(not(test))]
#[napi]
pub fn native_encode_png(buffer: Buffer, compression_level: i32) -> Result<Vec<u8>> {
    encoder::encode_to_png(&buffer, compression_level)
        .map_err(|e| Error::from_reason(e.to_string()))
}

#[cfg(not(test))]
#[napi]
pub fn native_encode_png_raw(buffer: Buffer, compression_level: i32) -> Result<Vec<u8>> {
    encoder::encode_to_png_raw(&buffer, compression_level)
        .map_err(|e| Error::from_reason(e.to_string()))
}

#[cfg(not(test))]
#[napi]
pub fn native_encode_png_with_name_and_filelist(
    buffer: Buffer,
    compression_level: i32,
    name: Option<String>,
    file_list_json: Option<String>,
) -> Result<Vec<u8>> {
    encoder::encode_to_png_with_name_and_filelist(
        &buffer,
        compression_level,
        name.as_deref(),
        file_list_json.as_deref(),
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}

#[cfg(not(test))]
#[napi]
pub fn native_encode_png_with_encryption_name_and_filelist(
    buffer: Buffer,
    compression_level: i32,
    passphrase: Option<String>,
    encrypt_type: Option<String>,
    name: Option<String>,
    file_list_json: Option<String>,
) -> Result<Vec<u8>> {
    encoder::encode_to_png_with_encryption_name_and_filelist(
        &buffer,
        compression_level,
        passphrase.as_deref(),
        encrypt_type.as_deref(),
        name.as_deref(),
        file_list_json.as_deref(),
    )
    .map_err(|e| Error::from_reason(e.to_string()))
}

#[napi(object)]
pub struct PngChunkData {
    pub name: String,
    pub data: Vec<u8>,
}

#[cfg(not(test))]
#[napi]
pub fn extract_png_chunks(png_buffer: Buffer) -> Result<Vec<PngChunkData>> {
    let chunks = png_utils::extract_png_chunks(&png_buffer)
        .map_err(|e| Error::from_reason(e))?;

    Ok(chunks.into_iter().map(|c| PngChunkData {
        name: c.name,
        data: c.data,
    }).collect())
}

#[cfg(not(test))]
#[napi]
pub fn encode_png_chunks(chunks: Vec<PngChunkData>) -> Result<Vec<u8>> {
    let native_chunks: Vec<png_utils::PngChunk> = chunks.into_iter()
        .map(|c| png_utils::PngChunk {
            name: c.name,
            data: c.data,
        })
        .collect();

    png_utils::encode_png_chunks(&native_chunks)
        .map_err(|e| Error::from_reason(e))
}

#[napi(object)]
pub struct PngMetadata {
    pub width: u32,
    pub height: u32,
    pub bit_depth: u32,
    pub color_type: u32,
}

#[cfg(not(test))]
#[napi]
pub fn get_png_metadata(png_buffer: Buffer) -> Result<PngMetadata> {
    let (width, height, bit_depth, color_type) = png_utils::get_png_metadata(&png_buffer)
        .map_err(|e| Error::from_reason(e))?;

    Ok(PngMetadata {
        width,
        height,
        bit_depth: bit_depth as u32,
        color_type: color_type as u32,
    })
}

#[napi(object)]
pub struct SharpMetadata {
    pub width: u32,
    pub height: u32,
    pub format: String,
}

#[cfg(not(test))]
#[napi]
pub fn sharp_resize_image(
    input_buffer: Buffer,
    width: u32,
    height: u32,
    kernel: String,
) -> Result<Vec<u8>> {
    image_utils::sharp_resize(&input_buffer, width, height, &kernel)
        .map_err(|e| Error::from_reason(e))
}

#[cfg(not(test))]
#[napi]
pub fn sharp_raw_pixels(input_buffer: Buffer) -> Result<Vec<u8>> {
    let (pixels, _w, _h) = image_utils::sharp_raw_pixels(&input_buffer)
        .map_err(|e| Error::from_reason(e))?;
    Ok(pixels)
}

#[napi(object)]
pub struct RawPixelsWithDimensions {
    pub pixels: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

#[cfg(not(test))]
#[napi]
pub fn sharp_to_raw(input_buffer: Buffer) -> Result<RawPixelsWithDimensions> {
    let (pixels, width, height) = image_utils::sharp_raw_pixels(&input_buffer)
        .map_err(|e| Error::from_reason(e))?;
    Ok(RawPixelsWithDimensions { pixels, width, height })
}

#[cfg(not(test))]
#[napi]
pub fn sharp_metadata(input_buffer: Buffer) -> Result<SharpMetadata> {
    let (width, height, format) = image_utils::sharp_metadata(&input_buffer)
        .map_err(|e| Error::from_reason(e))?;
    Ok(SharpMetadata { width, height, format })
}

#[cfg(not(test))]
#[napi]
pub fn rgb_to_png(rgb_buffer: Buffer, width: u32, height: u32) -> Result<Vec<u8>> {
    image_utils::rgb_to_png(&rgb_buffer, width, height)
        .map_err(|e| Error::from_reason(e))
}

#[cfg(not(test))]
#[napi]
pub fn png_to_rgb(png_buffer: Buffer) -> Result<RawPixelsWithDimensions> {
    let (pixels, width, height) = image_utils::png_to_rgb(&png_buffer)
        .map_err(|e| Error::from_reason(e))?;
    Ok(RawPixelsWithDimensions { pixels, width, height })
}

#[cfg(not(test))]
#[napi]
pub fn crop_and_reconstitute(png_buffer: Buffer) -> Result<Vec<u8>> {
    reconstitution::crop_and_reconstitute(&png_buffer)
        .map_err(|e| Error::from_reason(e))
}

