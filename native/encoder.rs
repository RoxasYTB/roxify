use anyhow::Result;

const MAGIC: &[u8] = b"ROX1";
const ENC_NONE: u8 = 0x00;
const PIXEL_MAGIC: &[u8] = b"PXL1";
const PNG_HEADER: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];

const MARKER_START: [(u8, u8, u8); 3] = [(255, 0, 0), (0, 255, 0), (0, 0, 255)];
const MARKER_END: [(u8, u8, u8); 3] = [(0, 0, 255), (0, 255, 0), (255, 0, 0)];
const MARKER_ZSTD: (u8, u8, u8) = (0, 255, 0);

pub fn encode_to_png(data: &[u8], compression_level: i32) -> Result<Vec<u8>> {
    let payload_input = [MAGIC, data].concat();
    
    let compressed = crate::core::zstd_compress_bytes(&payload_input, compression_level)
        .map_err(|e| anyhow::anyhow!("Compression failed: {}", e))?;
    
    let meta_pixel = build_meta_pixel(&compressed)?;
    let data_without_markers = [PIXEL_MAGIC, &meta_pixel].concat();
    
    let padding_needed = (3 - (data_without_markers.len() % 3)) % 3;
    let padded_data = if padding_needed > 0 {
        [&data_without_markers[..], &vec![0u8; padding_needed]].concat()
    } else {
        data_without_markers
    };
    
    let mut marker_bytes = Vec::with_capacity(12);
    for m in &MARKER_START {
        marker_bytes.extend_from_slice(&[m.0, m.1, m.2]);
    }
    marker_bytes.extend_from_slice(&[MARKER_ZSTD.0, MARKER_ZSTD.1, MARKER_ZSTD.2]);
    
    let data_with_markers = [&marker_bytes[..], &padded_data[..]].concat();
    
    let mut marker_end_bytes = Vec::with_capacity(9);
    for m in &MARKER_END {
        marker_end_bytes.extend_from_slice(&[m.0, m.1, m.2]);
    }
    
    let data_pixels = (data_with_markers.len() + 2) / 3;
    let end_marker_pixels = 3;
    let total_pixels = data_pixels + end_marker_pixels;
    
    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let side = side.max(end_marker_pixels);
    
    let width = side;
    let height = side;
    
    let total_data_bytes = width * height * 3;
    let mut full_data = vec![0u8; total_data_bytes];
    
    let marker_start_pos = (height - 1) * width * 3 + (width - end_marker_pixels) * 3;
    
    let copy_len = data_with_markers.len().min(marker_start_pos);
    full_data[..copy_len].copy_from_slice(&data_with_markers[..copy_len]);
    
    let end_len = marker_end_bytes.len().min(total_data_bytes - marker_start_pos);
    full_data[marker_start_pos..marker_start_pos + end_len]
        .copy_from_slice(&marker_end_bytes[..end_len]);
    
    let stride = width * 3 + 1;
    let mut scanlines = Vec::with_capacity(height * stride);
    
    for row in 0..height {
        scanlines.push(0u8);
        let src_start = row * width * 3;
        let src_end = (row + 1) * width * 3;
        scanlines.extend_from_slice(&full_data[src_start..src_end]);
    }
    
    let idat_data = create_raw_deflate(&scanlines);
    
    build_png(width, height, &idat_data)
}

fn build_meta_pixel(payload: &[u8]) -> Result<Vec<u8>> {
    let version = 1u8;
    let name_len = 0u8;
    let enc_flag = ENC_NONE;
    let payload_total_len = 1 + payload.len();
    let payload_len_bytes = (payload_total_len as u32).to_be_bytes();
    
    let mut result = Vec::with_capacity(1 + 1 + 4 + 1 + payload.len());
    result.push(version);
    result.push(name_len);
    result.extend_from_slice(&payload_len_bytes);
    result.push(enc_flag);
    result.extend_from_slice(payload);
    
    Ok(result)
}

fn build_png(width: usize, height: usize, idat_data: &[u8]) -> Result<Vec<u8>> {
    let mut png = Vec::with_capacity(8 + 25 + 12 + idat_data.len() + 12);
    
    png.extend_from_slice(PNG_HEADER);
    
    let mut ihdr_data = [0u8; 13];
    ihdr_data[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr_data[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr_data[8] = 8;
    ihdr_data[9] = 2;
    ihdr_data[10] = 0;
    ihdr_data[11] = 0;
    ihdr_data[12] = 0;
    
    write_chunk(&mut png, b"IHDR", &ihdr_data)?;
    write_chunk(&mut png, b"IDAT", idat_data)?;
    write_chunk(&mut png, b"IEND", &[])?;
    
    Ok(png)
}

fn write_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) -> Result<()> {
    let len = data.len() as u32;
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    
    let mut crc_data = Vec::with_capacity(chunk_type.len() + data.len());
    crc_data.extend_from_slice(chunk_type);
    crc_data.extend_from_slice(data);
    let crc = crate::core::crc32_bytes(&crc_data);
    
    out.extend_from_slice(&crc.to_be_bytes());
    Ok(())
}

fn create_raw_deflate(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len() + 6 + (data.len() / 65535 + 1) * 5);
    
    result.push(0x78);
    result.push(0x01);
    
    let mut offset = 0;
    while offset < data.len() {
        let chunk_size = (data.len() - offset).min(65535);
        let is_last = offset + chunk_size >= data.len();
        
        result.push(if is_last { 0x01 } else { 0x00 });
        
        result.push(chunk_size as u8);
        result.push((chunk_size >> 8) as u8);
        result.push(!chunk_size as u8);
        result.push((!(chunk_size >> 8)) as u8);
        
        result.extend_from_slice(&data[offset..offset + chunk_size]);
        offset += chunk_size;
    }
    
    let adler = crate::core::adler32_bytes(data);
    result.extend_from_slice(&adler.to_be_bytes());
    
    result
}
