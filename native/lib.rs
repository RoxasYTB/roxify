use napi::bindgen_prelude::*;
use napi_derive::napi;

mod core;
pub use core::*;

#[napi(object)]
pub struct ScanResult {
    pub marker_positions: Vec<u32>,
    pub magic_positions: Vec<u32>,
}

#[cfg(not(test))]
#[napi]
pub fn scan_pixels(buffer: Buffer, channels: u32, marker_bytes: Option<Buffer>) -> Result<ScanResult> {
    let slice: &[u8] = &buffer;
    let markers_slice: Option<&[u8]> = marker_bytes.as_ref().map(|b| &**b);
    let res = core::scan_pixels_bytes(slice, channels as usize, markers_slice);
    Ok(ScanResult { marker_positions: res.marker_positions, magic_positions: res.magic_positions })
}

#[cfg(not(test))]
#[napi]
pub fn native_crc32(buffer: Buffer) -> u32 {
    core::crc32_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_adler32(buffer: Buffer) -> u32 {
    core::adler32_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_delta_encode(buffer: Buffer) -> Vec<u8> {
    core::delta_encode_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_delta_decode(buffer: Buffer) -> Vec<u8> {
    core::delta_decode_bytes(&buffer)
}

#[cfg(not(test))]
#[napi]
pub fn native_zstd_compress(buffer: Buffer, level: i32) -> Result<Vec<u8>> {
    core::zstd_compress_bytes(&buffer, level).map_err(|e| Error::from_reason(e))
}

#[cfg(not(test))]
#[napi]
pub fn native_zstd_decompress(buffer: Buffer) -> Result<Vec<u8>> {
    core::zstd_decompress_bytes(&buffer).map_err(|e| Error::from_reason(e))
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
        assert_eq!(native_adler32_bytes(&data), adler32_bytes(&data));
    }
}
