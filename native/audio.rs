/// WAV container for binary data.
///
/// Encodes raw bytes as 8-bit unsigned PCM mono samples (44100 Hz).
/// Header is exactly 44 bytes. Total overhead: 44 bytes.
///
/// Compared to PNG (stored deflate): PNG overhead grows with data size
/// (zlib framing, filter bytes, chunk CRCs). WAV overhead is constant.

const WAV_HEADER_SIZE: usize = 44;
const SAMPLE_RATE: u32 = 44100;
const BITS_PER_SAMPLE: u16 = 8;
const NUM_CHANNELS: u16 = 1;

/// Pack raw bytes into a WAV file (8-bit PCM, mono, 44100 Hz).
/// The bytes are stored directly as unsigned PCM samples.
/// Returns the complete WAV file as a Vec<u8>.
pub fn bytes_to_wav(data: &[u8]) -> Vec<u8> {
    let data_size = data.len() as u32;
    let file_size = WAV_HEADER_SIZE as u32 - 8 + data_size; // RIFF chunk size

    let byte_rate = SAMPLE_RATE * NUM_CHANNELS as u32 * (BITS_PER_SAMPLE as u32 / 8);
    let block_align = NUM_CHANNELS * (BITS_PER_SAMPLE / 8);

    let mut wav = Vec::with_capacity(WAV_HEADER_SIZE + data.len());

    // RIFF header
    wav.extend_from_slice(b"RIFF");
    wav.extend_from_slice(&file_size.to_le_bytes());
    wav.extend_from_slice(b"WAVE");

    // fmt sub-chunk
    wav.extend_from_slice(b"fmt ");
    wav.extend_from_slice(&16u32.to_le_bytes()); // sub-chunk size (PCM = 16)
    wav.extend_from_slice(&1u16.to_le_bytes());  // audio format (1 = PCM)
    wav.extend_from_slice(&NUM_CHANNELS.to_le_bytes());
    wav.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    wav.extend_from_slice(&byte_rate.to_le_bytes());
    wav.extend_from_slice(&block_align.to_le_bytes());
    wav.extend_from_slice(&BITS_PER_SAMPLE.to_le_bytes());

    // data sub-chunk
    wav.extend_from_slice(b"data");
    wav.extend_from_slice(&data_size.to_le_bytes());
    wav.extend_from_slice(data);

    wav
}

/// Extract raw bytes from a WAV file.
/// Returns the PCM data (the original bytes) or an error.
pub fn wav_to_bytes(wav: &[u8]) -> Result<Vec<u8>, String> {
    if wav.len() < WAV_HEADER_SIZE {
        return Err("WAV data too short".to_string());
    }

    // Validate RIFF header
    if &wav[0..4] != b"RIFF" {
        return Err("Not a RIFF file".to_string());
    }
    if &wav[8..12] != b"WAVE" {
        return Err("Not a WAVE file".to_string());
    }

    // Find the "data" sub-chunk (skip fmt and any other chunks)
    let mut offset = 12; // past "RIFF" + size + "WAVE"
    loop {
        if offset + 8 > wav.len() {
            return Err("data chunk not found".to_string());
        }
        let chunk_id = &wav[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            wav[offset + 4],
            wav[offset + 5],
            wav[offset + 6],
            wav[offset + 7],
        ]) as usize;

        if chunk_id == b"data" {
            let data_start = offset + 8;
            let data_end = data_start + chunk_size;
            if data_end > wav.len() {
                // Allow truncation: return what we have
                return Ok(wav[data_start..].to_vec());
            }
            return Ok(wav[data_start..data_end].to_vec());
        }

        // Skip this chunk (+ padding byte if odd size)
        offset += 8 + chunk_size;
        if chunk_size % 2 != 0 {
            offset += 1; // RIFF chunks are word-aligned
        }
    }
}

/// Check if a buffer starts with a RIFF/WAVE header.
pub fn is_wav(buf: &[u8]) -> bool {
    buf.len() >= 12 && &buf[0..4] == b"RIFF" && &buf[8..12] == b"WAVE"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wav_roundtrip() {
        let data = b"Hello, World! This is roxify audio container test data.";
        let wav = bytes_to_wav(data);

        // Check header
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(wav.len(), 44 + data.len());

        // Roundtrip
        let recovered = wav_to_bytes(&wav).expect("decode should succeed");
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_wav_empty() {
        let data: &[u8] = b"";
        let wav = bytes_to_wav(data);
        assert_eq!(wav.len(), 44);
        let recovered = wav_to_bytes(&wav).expect("decode empty");
        assert!(recovered.is_empty());
    }

    #[test]
    fn test_wav_large() {
        let data = vec![0xAB_u8; 1024 * 1024]; // 1 MB
        let wav = bytes_to_wav(&data);
        assert_eq!(wav.len(), 44 + 1024 * 1024);
        let recovered = wav_to_bytes(&wav).expect("decode large");
        assert_eq!(recovered, data);
    }

    #[test]
    fn test_is_wav() {
        let wav = bytes_to_wav(b"test");
        assert!(is_wav(&wav));
        assert!(!is_wav(b"not a wav"));
        assert!(!is_wav(b"RIFF1234XXXX")); // RIFF but not WAVE
    }

    #[test]
    fn test_invalid_wav() {
        assert!(wav_to_bytes(b"short").is_err());
        assert!(wav_to_bytes(b"NOT a RIFF file!").is_err());
    }
}
