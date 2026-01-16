use bytemuck::{Pod, Zeroable};

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
        let crc = crc32fast::hash(&crc_data);
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

/// Extract the raw payload bytes embedded in a ROX PNG (the compressed/encrypted pack).
/// This re-uses the reconstitution cropping logic to ensure the payload area is found.
pub fn extract_payload_from_png(png_data: &[u8]) -> Result<Vec<u8>, String> {
    // Use the reconstitution logic to get a cropped PNG containing the payload pixels
    let reconst = crate::reconstitution::crop_and_reconstitute(png_data)?;
    // Load image to raw RGB
    let img = image::load_from_memory(&reconst).map_err(|e| format!("image load error: {}", e))?;
    let rgb = img.to_rgb8();
    let raw = rgb.into_raw(); // 3 bytes per pixel

    let magic = b"PXL1";
    // find magic
    let mut pos_opt: Option<usize> = None;
    for i in 0..(raw.len().saturating_sub(magic.len())) {
        if &raw[i..i + magic.len()] == magic {
            pos_opt = Some(i);
            break;
        }
    }
    let pos = pos_opt.ok_or("PIXEL_MAGIC not found")?;
    let mut idx = pos + magic.len();
    if idx + 2 > raw.len() { return Err("Truncated header".to_string()); }
    let _version = raw[idx]; idx += 1;
    let name_len = raw[idx] as usize; idx += 1;
    if idx + name_len > raw.len() { return Err("Truncated name".to_string()); }
    idx += name_len; // skip name
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
