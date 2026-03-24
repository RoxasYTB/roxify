use bytemuck::{Pod, Zeroable};
use image::ImageReader;
use std::io::{Cursor, Read, Seek, SeekFrom};

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PngSignature([u8; 8]);

const PNG_SIG: PngSignature = PngSignature([137, 80, 78, 71, 13, 10, 26, 10]);

#[derive(Debug, Clone)]
pub struct PngChunk {
    pub name: String,
    pub data: Vec<u8>,
}

fn read_u32_be(data: &[u8]) -> u32 {
    u32::from_be_bytes([data[0], data[1], data[2], data[3]])
}

fn write_u32_be(val: u32) -> [u8; 4] {
    val.to_be_bytes()
}

pub fn extract_png_chunks_streaming<R: Read + Seek>(reader: &mut R) -> Result<Vec<PngChunk>, String> {
    let mut sig = [0u8; 8];
    reader.read_exact(&mut sig).map_err(|e| format!("read sig: {}", e))?;
    if sig != PNG_SIG.0 {
        return Err("Invalid PNG signature".to_string());
    }

    let mut chunks = Vec::new();
    let mut header = [0u8; 8];

    loop {
        if reader.read_exact(&mut header).is_err() {
            break;
        }

        let length = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as usize;
        let chunk_type = [header[4], header[5], header[6], header[7]];
        let name = String::from_utf8_lossy(&chunk_type).to_string();

        if name == "IDAT" {
            reader.seek(SeekFrom::Current(length as i64 + 4)).map_err(|e| format!("seek: {}", e))?;
        } else {
            let mut data = vec![0u8; length];
            reader.read_exact(&mut data).map_err(|e| format!("read chunk {}: {}", name, e))?;
            reader.seek(SeekFrom::Current(4)).map_err(|e| format!("seek crc: {}", e))?;
            chunks.push(PngChunk { name: name.clone(), data });
        }

        if &chunk_type == b"IEND" {
            break;
        }
    }

    Ok(chunks)
}

pub fn extract_png_chunks(png_data: &[u8]) -> Result<Vec<PngChunk>, String> {
    if png_data.len() < 8 || &png_data[..8] != &PNG_SIG.0 {
        return Err("Invalid PNG signature".to_string());
    }

    let mut chunks = Vec::new();
    let mut pos = 8;

    while pos + 12 <= png_data.len() {
        let length = read_u32_be(&png_data[pos..pos + 4]) as usize;
        let chunk_type = &png_data[pos + 4..pos + 8];

        if pos + 12 + length > png_data.len() {
            break;
        }

        let chunk_data = &png_data[pos + 8..pos + 8 + length];

        let name = String::from_utf8_lossy(chunk_type).to_string();
        chunks.push(PngChunk {
            name,
            data: chunk_data.to_vec(),
        });

        pos += 12 + length;

        if chunk_type == b"IEND" {
            break;
        }
    }

    Ok(chunks)
}

pub fn encode_png_chunks(chunks: &[PngChunk]) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();

    output.extend_from_slice(&PNG_SIG.0);

    for chunk in chunks {
        let chunk_type = chunk.name.as_bytes();
        if chunk_type.len() != 4 {
            return Err(format!("Invalid chunk type length: {}", chunk.name));
        }

        let length = chunk.data.len() as u32;
        output.extend_from_slice(&write_u32_be(length));
        output.extend_from_slice(chunk_type);
        output.extend_from_slice(&chunk.data);

        let mut crc_data = Vec::new();
        crc_data.extend_from_slice(chunk_type);
        crc_data.extend_from_slice(&chunk.data);
        let crc = crate::core::crc32_bytes(&crc_data);
        output.extend_from_slice(&write_u32_be(crc));
    }

    Ok(output)
}

pub fn get_png_metadata(png_data: &[u8]) -> Result<(u32, u32, u8, u8), String> {
    let chunks = extract_png_chunks(png_data)?;

    let ihdr = chunks.iter()
        .find(|c| c.name == "IHDR")
        .ok_or("IHDR chunk not found")?;

    if ihdr.data.len() < 13 {
        return Err("Invalid IHDR chunk".to_string());
    }

    let width = read_u32_be(&ihdr.data[0..4]);
    let height = read_u32_be(&ihdr.data[4..8]);
    let bit_depth = ihdr.data[8];
    let color_type = ihdr.data[9];

    Ok((width, height, bit_depth, color_type))
}

pub fn extract_payload_from_png(png_data: &[u8]) -> Result<Vec<u8>, String> {
    if let Ok(payload) = extract_payload_direct(png_data) {
        if validate_payload_deep(&payload) {
            return Ok(payload);
        }
    }
    if let Ok(reconst) = crate::reconstitution::crop_and_reconstitute(png_data) {
        if let Ok(payload) = extract_payload_direct(&reconst) {
            if validate_payload_deep(&payload) {
                return Ok(payload);
            }
        }
        if let Ok(unstretched) = crate::reconstitution::unstretch_nn(&reconst) {
            if let Ok(payload) = extract_payload_direct(&unstretched) {
                if validate_payload_deep(&payload) {
                    return Ok(payload);
                }
            }
        }
    }
    if let Ok(unstretched) = crate::reconstitution::unstretch_nn(png_data) {
        if let Ok(payload) = extract_payload_direct(&unstretched) {
            if validate_payload_deep(&payload) {
                return Ok(payload);
            }
        }
    }
    if let Ok(payload) = extract_payload_from_embedded_nn(png_data) {
        if validate_payload_deep(&payload) {
            return Ok(payload);
        }
    }
    Err("No valid payload found after all extraction attempts".to_string())
}

fn validate_payload_deep(payload: &[u8]) -> bool {
    if payload.len() < 5 { return false; }
    if payload[0] == 0x01 || payload[0] == 0x02 { return true; }
    let compressed = if payload[0] == 0x00 { &payload[1..] } else { payload };
    if compressed.starts_with(b"ROX1") { return true; }
    crate::core::zstd_decompress_bytes(compressed, None).is_ok()
}

fn find_pixel_header(raw: &[u8]) -> Result<usize, String> {
    let magic = b"PXL1";
    for i in 0..(raw.len().saturating_sub(magic.len())) {
        if &raw[i..i + magic.len()] == magic {
            return Ok(i);
        }
    }
    Err("PIXEL_MAGIC not found".to_string())
}

fn decode_to_rgb(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader = ImageReader::new(Cursor::new(png_data))
        .with_guessed_format()
        .map_err(|e| format!("format guess error: {}", e))?;
    reader.no_limits();
    let img = reader.decode().map_err(|e| format!("image decode error: {}", e))?;
    Ok(img.to_rgb8().into_raw())
}

fn decode_to_rgba_grid(png_data: &[u8]) -> Result<(Vec<[u8; 4]>, u32, u32), String> {
    let mut reader = ImageReader::new(Cursor::new(png_data))
        .with_guessed_format()
        .map_err(|e| format!("format guess error: {}", e))?;
    reader.no_limits();
    let img = reader.decode().map_err(|e| format!("image decode error: {}", e))?;
    let rgba = img.to_rgba8();
    let w = rgba.width();
    let h = rgba.height();
    let pixels: Vec<[u8; 4]> = rgba.pixels().map(|p| [p[0], p[1], p[2], p[3]]).collect();
    Ok((pixels, w, h))
}

fn reconstruct_logical_pixels_from_nn(
    pixels: &[[u8; 4]], width: u32, height: u32
) -> Result<Vec<u8>, String> {
    let w = width as usize;
    let h = height as usize;
    let get = |x: usize, y: usize| -> [u8; 4] { pixels[y * w + x] };

    let magic = [b'P', b'X', b'L', b'1'];

    let mut header_row = None;
    let mut header_col = None;
    'outer: for y in 0..h {
        for x in 0..w.saturating_sub(1) {
            let p0 = get(x, y);
            let p1 = get(x + 1, y);
            let seq = [p0[0], p0[1], p0[2], p1[0], p1[1], p1[2]];
            for start in 0..3 {
                if start + 4 <= 6 && seq[start] == magic[0] && seq[start+1] == magic[1]
                    && seq[start+2] == magic[2] && seq[start+3] == magic[3]
                {
                    header_row = Some(y);
                    header_col = Some(x);
                    break 'outer;
                }
            }
        }
    }
    let header_row = header_row.ok_or("PXL1 not found in 2D pixel scan")?;
    let header_col = header_col.ok_or("PXL1 column not found")?;

    let mut scale_y = 1usize;
    for dy in 1..h - header_row {
        let y2 = header_row + dy;
        let mut same = true;
        for x in header_col..(header_col + 4).min(w) {
            if get(x, y2) != get(x, header_row) { same = false; break; }
        }
        if same { scale_y += 1; } else { break; }
    }

    let cur = get(header_col, header_row);
    let mut block_start = header_col;
    while block_start > 0 && get(block_start - 1, header_row) == cur {
        block_start -= 1;
    }
    let mut block_end = header_col + 1;
    while block_end < w && get(block_end, header_row) == cur {
        block_end += 1;
    }
    let scale_x = block_end - block_start;
    if scale_x < 2 {
        return Err("Could not determine NN scale_x".to_string());
    }

    let ref_y = header_row;
    let mut embed_left = block_start;
    loop {
        if embed_left < scale_x { break; }
        let candidate = embed_left - scale_x;
        let c0 = get(candidate, ref_y);
        let mut is_block = true;
        for dx in 1..scale_x {
            if candidate + dx >= w || get(candidate + dx, ref_y) != c0 {
                is_block = false;
                break;
            }
        }
        if !is_block { break; }
        if candidate + scale_x < w && get(candidate + scale_x, ref_y) == c0 {
            break;
        }
        embed_left = candidate;
    }

    let mut embed_top = header_row;
    loop {
        if embed_top < scale_y { break; }
        let candidate = embed_top - scale_y;
        let mut is_block = true;
        for dy in 0..scale_y {
            if candidate + dy >= h { is_block = false; break; }
            if dy > 0 && get(embed_left, candidate + dy) != get(embed_left, candidate) {
                is_block = false;
                break;
            }
        }
        if !is_block { break; }
        embed_top = candidate;
    }

    let mut logical_cols: Vec<usize> = Vec::new();
    let mut x = embed_left;
    while x < w {
        logical_cols.push(x);
        let c = get(x, ref_y);
        let mut nx = x + 1;
        while nx < w && get(nx, ref_y) == c {
            nx += 1;
        }
        if nx >= w { break; }
        let blk = nx - x;
        if blk < scale_x.saturating_sub(2) || blk > scale_x + 2 {
            break;
        }
        x = nx;
    }

    let mut logical_rows: Vec<usize> = Vec::new();
    let mut y = embed_top;
    while y < h {
        logical_rows.push(y);
        let c = get(embed_left, y);
        let mut ny = y + 1;
        while ny < h && get(embed_left, ny) == c {
            ny += 1;
        }
        if ny >= h { break; }
        let blk = ny - y;
        if blk < scale_y.saturating_sub(2) || blk > scale_y + 2 {
            break;
        }
        y = ny;
    }

    if logical_cols.len() < 3 || logical_rows.len() < 3 {
        return Err("Embedded region too small".to_string());
    }

    let img_w = logical_cols.len();
    let mut logical_rgb = Vec::with_capacity(img_w * logical_rows.len() * 3);
    for &ry in &logical_rows {
        for &cx in &logical_cols {
            let p = get(cx, ry);
            logical_rgb.push(p[0]);
            logical_rgb.push(p[1]);
            logical_rgb.push(p[2]);
        }
    }
    Ok(logical_rgb)
}

fn extract_payload_from_embedded_nn(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let (pixels, width, height) = decode_to_rgba_grid(png_data)?;
    let logical_rgb = reconstruct_logical_pixels_from_nn(&pixels, width, height)?;
    let pos = {
        let magic = b"PXL1";
        let mut found = None;
        for i in 0..logical_rgb.len().saturating_sub(4) {
            if &logical_rgb[i..i+4] == magic {
                found = Some(i);
                break;
            }
        }
        found.ok_or("PXL1 not found in reconstructed pixels")?
    };
    let mut idx = pos + 4;
    if idx + 2 > logical_rgb.len() { return Err("Truncated header in embedded NN".to_string()); }
    let _version = logical_rgb[idx]; idx += 1;
    let name_len = logical_rgb[idx] as usize; idx += 1;
    if idx + name_len > logical_rgb.len() { return Err("Truncated name in embedded NN".to_string()); }
    idx += name_len;
    if idx + 4 > logical_rgb.len() { return Err("Truncated payload length in embedded NN".to_string()); }
    let payload_len = ((logical_rgb[idx] as u32) << 24)
        | ((logical_rgb[idx+1] as u32) << 16)
        | ((logical_rgb[idx+2] as u32) << 8)
        | (logical_rgb[idx+3] as u32);
    idx += 4;
    let end = idx + (payload_len as usize);
    if end > logical_rgb.len() { return Err("Truncated payload in embedded NN".to_string()); }
    Ok(logical_rgb[idx..end].to_vec())
}

pub fn extract_name_from_png(png_data: &[u8]) -> Option<String> {
    if let Some(name) = extract_name_direct(png_data) {
        return Some(name);
    }
    if let Ok(reconst) = crate::reconstitution::crop_and_reconstitute(png_data) {
        if let Some(name) = extract_name_direct(&reconst) {
            return Some(name);
        }
        if let Ok(unstretched) = crate::reconstitution::unstretch_nn(&reconst) {
            if let Some(name) = extract_name_direct(&unstretched) {
                return Some(name);
            }
        }
    }
    if let Ok(unstretched) = crate::reconstitution::unstretch_nn(png_data) {
        if let Some(name) = extract_name_direct(&unstretched) {
            return Some(name);
        }
    }
    if let Ok(name) = extract_name_from_embedded_nn(png_data) {
        return Some(name);
    }
    None
}

fn extract_name_direct(png_data: &[u8]) -> Option<String> {
    let raw = decode_to_rgb(png_data).ok()?;
    let pos = find_pixel_header(&raw).ok()?;
    let mut idx = pos + 4;
    if idx + 2 > raw.len() { return None; }
    idx += 1;
    let name_len = raw[idx] as usize; idx += 1;
    if name_len == 0 || idx + name_len > raw.len() { return None; }
    String::from_utf8(raw[idx..idx + name_len].to_vec()).ok()
}

fn extract_name_from_embedded_nn(png_data: &[u8]) -> Result<String, String> {
    let (pixels, width, height) = decode_to_rgba_grid(png_data)?;
    let logical_rgb = reconstruct_logical_pixels_from_nn(&pixels, width, height)?;
    let pos = find_pixel_header(&logical_rgb)?;
    let mut idx = pos + 4;
    if idx + 2 > logical_rgb.len() { return Err("Truncated".to_string()); }
    idx += 1;
    let name_len = logical_rgb[idx] as usize; idx += 1;
    if name_len == 0 || idx + name_len > logical_rgb.len() { return Err("Truncated name".to_string()); }
    String::from_utf8(logical_rgb[idx..idx + name_len].to_vec()).map_err(|e| e.to_string())
}

fn extract_payload_direct(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let raw = decode_to_rgb(png_data)?;
    let pos = find_pixel_header(&raw)?;
    let mut idx = pos + 4;
    if idx + 2 > raw.len() { return Err("Truncated header".to_string()); }
    let _version = raw[idx]; idx += 1;
    let name_len = raw[idx] as usize; idx += 1;
    if idx + name_len > raw.len() { return Err("Truncated name".to_string()); }
    idx += name_len;
    if idx + 4 > raw.len() { return Err("Truncated payload length".to_string()); }
    let payload_len = ((raw[idx] as u32) << 24)
        | ((raw[idx+1] as u32) << 16)
        | ((raw[idx+2] as u32) << 8)
        | (raw[idx+3] as u32);
    idx += 4;
    let end = idx + (payload_len as usize);
    if end > raw.len() { return Err("Truncated payload".to_string()); }
    let payload = raw[idx..end].to_vec();
    Ok(payload)
}

pub fn extract_file_list_from_pixels(png_data: &[u8]) -> Result<String, String> {
    if let Ok(result) = extract_file_list_direct(png_data) {
        return Ok(result);
    }
    if let Ok(reconst) = crate::reconstitution::crop_and_reconstitute(png_data) {
        if let Ok(result) = extract_file_list_direct(&reconst) {
            return Ok(result);
        }
        if let Ok(unstretched) = crate::reconstitution::unstretch_nn(&reconst) {
            if let Ok(result) = extract_file_list_direct(&unstretched) {
                return Ok(result);
            }
        }
    }
    if let Ok(unstretched) = crate::reconstitution::unstretch_nn(png_data) {
        if let Ok(result) = extract_file_list_direct(&unstretched) {
            return Ok(result);
        }
    }
    if let Ok(result) = extract_file_list_from_embedded_nn(png_data) {
        return Ok(result);
    }
    Err("No file list found after all extraction attempts".to_string())
}

fn extract_file_list_from_embedded_nn(png_data: &[u8]) -> Result<String, String> {
    let (pixels, width, height) = decode_to_rgba_grid(png_data)?;
    let logical_rgb = reconstruct_logical_pixels_from_nn(&pixels, width, height)?;
    let pos = find_pixel_header(&logical_rgb)?;
    let mut idx = pos + 4;
    if idx + 2 > logical_rgb.len() { return Err("Truncated".to_string()); }
    idx += 1;
    let name_len = logical_rgb[idx] as usize; idx += 1;
    if idx + name_len > logical_rgb.len() { return Err("Truncated".to_string()); }
    idx += name_len;
    if idx + 4 > logical_rgb.len() { return Err("Truncated".to_string()); }
    let payload_len = ((logical_rgb[idx] as u32) << 24)
        | ((logical_rgb[idx+1] as u32) << 16)
        | ((logical_rgb[idx+2] as u32) << 8)
        | (logical_rgb[idx+3] as u32);
    idx += 4;
    idx += payload_len as usize;
    if idx + 8 > logical_rgb.len() { return Err("No file list in embedded NN".to_string()); }
    if &logical_rgb[idx..idx + 4] != b"rXFL" { return Err("No rXFL marker in embedded NN".to_string()); }
    idx += 4;
    let json_len = ((logical_rgb[idx] as u32) << 24)
        | ((logical_rgb[idx+1] as u32) << 16)
        | ((logical_rgb[idx+2] as u32) << 8)
        | (logical_rgb[idx+3] as u32);
    idx += 4;
    let json_end = idx + json_len as usize;
    if json_end > logical_rgb.len() { return Err("Truncated file list in embedded NN".to_string()); }
    String::from_utf8(logical_rgb[idx..json_end].to_vec()).map_err(|e| format!("Invalid UTF-8: {}", e))
}

fn extract_file_list_direct(png_data: &[u8]) -> Result<String, String> {
    let raw = decode_to_rgb(png_data)?;
    let pos = find_pixel_header(&raw)?;
    let mut idx = pos + 4;
    if idx + 2 > raw.len() { return Err("Truncated header".to_string()); }
    idx += 1;
    let name_len = raw[idx] as usize; idx += 1;
    if idx + name_len > raw.len() { return Err("Truncated name".to_string()); }
    idx += name_len;
    if idx + 4 > raw.len() { return Err("Truncated payload length".to_string()); }
    let payload_len = ((raw[idx] as u32) << 24)
        | ((raw[idx+1] as u32) << 16)
        | ((raw[idx+2] as u32) << 8)
        | (raw[idx+3] as u32);
    idx += 4;
    idx += payload_len as usize;
    if idx + 8 > raw.len() { return Err("No file list in pixel data".to_string()); }
    if &raw[idx..idx + 4] != b"rXFL" { return Err("No rXFL marker in pixel data".to_string()); }
    idx += 4;
    let json_len = ((raw[idx] as u32) << 24)
        | ((raw[idx+1] as u32) << 16)
        | ((raw[idx+2] as u32) << 8)
        | (raw[idx+3] as u32);
    idx += 4;
    let json_end = idx + json_len as usize;
    if json_end > raw.len() { return Err("Truncated file list JSON".to_string()); }
    String::from_utf8(raw[idx..json_end].to_vec()).map_err(|e| format!("Invalid UTF-8 in file list: {}", e))
}
