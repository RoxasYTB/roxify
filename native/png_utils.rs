use bytemuck::{Pod, Zeroable};
use image::ImageReader;
use std::io::{Cursor, Read, Seek, SeekFrom};
use zstd;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct PngSignature([u8; 8]);

const PNG_SIG: PngSignature = PngSignature([137, 80, 78, 71, 13, 10, 26, 10]);
const HEADER_VERSION_V1: u8 = 1;
const HEADER_VERSION_V2: u8 = 2;

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
    // Windows optimization: validation rapide de la signature PNG
    if png_data.len() < 8 || &png_data[..8] != &[137, 80, 78, 71, 13, 10, 26, 10] {
        return Err("Invalid PNG signature".to_string());
    }

    // Windows optimization: essayer d'abord les méthodes les plus rapides
    if let Ok(payload) = extract_payload_direct(png_data) {
        if validate_payload_deep(&payload) {
            return Ok(payload);
        }
    }

    // Header-aware flexible extraction: works for unencrypted AND encrypted
    // payloads. Must run before reconstitution since reconstitution is costly.
    if let Ok(payload) = extract_payload_direct_flexible(png_data) {
        if validate_payload_deep(&payload) {
            return Ok(payload);
        }
    }

    // Windows optimization: vérifier les chunks rXFL avant reconstitution coûteuse
    if let Ok(chunks) = extract_png_chunks(png_data) {
        if let Some(_rxfl_chunk) = chunks.iter().find(|c| c.name == "rXFL") {
            // Si rXFL existe, essayer l'extraction directe depuis les pixels RGBA
            if let Ok(payload) = extract_payload_direct_from_pixels(png_data) {
                if validate_payload_deep(&payload) {
                    return Ok(payload);
                }
            }
        }
    }

    // Méthodes de reconstitution (plus lentes)
    if let Ok(reconst) = crate::reconstitution::crop_and_reconstitute(png_data) {
        if let Ok(payload) = extract_payload_direct(&reconst) {
            if validate_payload_deep(&payload) {
                return Ok(payload);
            }
        }
        if let Ok(payload) = extract_payload_direct_flexible(&reconst) {
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
            if let Ok(payload) = extract_payload_direct_flexible(&unstretched) {
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
        if let Ok(payload) = extract_payload_direct_flexible(&unstretched) {
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

    // Windows optimization: diagnostic détaillé pour le debugging
    let mut debug_info = "No valid payload found after all extraction attempts. Diagnostics: ".to_string();
    if let Ok(metadata) = get_png_metadata(png_data) {
        debug_info.push_str(&format!("PNG size: {}x{}, ", metadata.0, metadata.1));
    } else {
        debug_info.push_str("Invalid PNG metadata, ");
    }

    if let Ok(chunks) = extract_png_chunks(png_data) {
        let chunk_names: Vec<&str> = chunks.iter().map(|c| c.name.as_str()).collect();
        debug_info.push_str(&format!("chunks: {:?}, ", chunk_names));
    } else {
        debug_info.push_str("no chunks readable, ");
    }

    debug_info.push_str("file may be corrupted or use unsupported encoding.");

    Err(debug_info)
}

fn validate_payload_deep(payload: &[u8]) -> bool {
    if payload.len() < 5 { return false; }
    if payload[0] == 0x01 || payload[0] == 0x02 || payload[0] == 0x03 { return true; }
    let compressed = if payload[0] == 0x00 { &payload[1..] } else { payload };
    if compressed.starts_with(b"ROX1") { return true; }

    // Windows optimization: essayer zstd avec différentes options
    if crate::core::zstd_decompress_bytes(compressed, None).is_ok() {
        return true;
    }

    // Fallback: vérifier si c'est du zstd brut sans magic
    if compressed.len() > 4 {
        // Essayer de décompresser avec window_log max pour Windows
        if let Ok(mut decoder) = zstd::stream::Decoder::new(compressed) {
            let _ = decoder.window_log_max(31);
            if decoder.read_to_end(&mut Vec::new()).is_ok() {
                return true;
            }
        }
    }

    false
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

    // Recherche améliorée : plus flexible et robuste
    'outer: for y in 0..h {
        for x in 0..w {
            // Essayer différentes positions dans le pixel
            let p = get(x, y);
            let pixel_data = [p[0], p[1], p[2]];

            // Vérifier si le magic bytes est au début du pixel
            if pixel_data.len() >= 4 && pixel_data[0..4] == magic {
                header_row = Some(y);
                header_col = Some(x);
                break 'outer;
            }

            // Vérifier si le magic bytes est distribué sur plusieurs pixels
            if x < w.saturating_sub(1) {
                let p_next = get(x + 1, y);
                let combined = [p[0], p[1], p[2], p_next[0]];
                if combined == magic {
                    header_row = Some(y);
                    header_col = Some(x);
                    break 'outer;
                }
            }
        }
    }

    // Si toujours pas trouvé, essayer une recherche linéaire simple
    if header_row.is_none() {
        let flat_pixels: Vec<u8> = pixels.iter().flat_map(|p| [p[0], p[1], p[2]]).collect();
        for i in 0..flat_pixels.len().saturating_sub(4) {
            if flat_pixels[i..i+4] == magic {
                let pixel_idx = i / 3;
                header_row = Some(pixel_idx / w);
                header_col = Some(pixel_idx % w);
                break;
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
    let header = parse_pixel_payload_header(&logical_rgb, pos)?;
    let end = header.payload_offset + header.payload_len;
    if end > logical_rgb.len() { return Err("Truncated payload in embedded NN".to_string()); }
    Ok(logical_rgb[header.payload_offset..end].to_vec())
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

struct PixelPayloadHeader {
    payload_offset: usize,
    payload_len: usize,
}

fn parse_pixel_payload_header(buf: &[u8], pos: usize) -> Result<PixelPayloadHeader, String> {
    let mut idx = pos + 4;
    if idx + 2 > buf.len() {
        return Err("Truncated header".to_string());
    }

    let version = buf[idx];
    idx += 1;
    let name_len = buf[idx] as usize;
    idx += 1;
    if idx + name_len > buf.len() {
        return Err("Truncated name".to_string());
    }
    idx += name_len;

    let payload_len = match version {
        HEADER_VERSION_V1 => {
            if idx + 4 > buf.len() {
                return Err("Truncated payload length".to_string());
            }
            let len = u32::from_be_bytes([buf[idx], buf[idx + 1], buf[idx + 2], buf[idx + 3]]) as u64;
            idx += 4;
            len
        }
        HEADER_VERSION_V2 => {
            if idx + 8 > buf.len() {
                return Err("Truncated payload length64".to_string());
            }
            let len = u64::from_be_bytes([
                buf[idx],
                buf[idx + 1],
                buf[idx + 2],
                buf[idx + 3],
                buf[idx + 4],
                buf[idx + 5],
                buf[idx + 6],
                buf[idx + 7],
            ]);
            idx += 8;
            len
        }
        other => return Err(format!("Unsupported header version {}", other)),
    };

    let payload_len = usize::try_from(payload_len)
        .map_err(|_| "Payload too large for this platform".to_string())?;

    Ok(PixelPayloadHeader {
        payload_offset: idx,
        payload_len,
    })
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
    let raw = decode_to_rgb(png_data).map_err(|e| format!("RGB decode: {}", e))?;

    // Search for ROX1 magic in the pixel data
    let rox1_magic = b"ROX1";
    for i in 0..raw.len().saturating_sub(rox1_magic.len()) {
        if &raw[i..i + rox1_magic.len()] == rox1_magic {
            let compressed = &raw[i + 4..];

            // Try zstd decompression with multiple window logs
            use std::io::Read;
            let wlog_candidates = [10, 11, 12, 13, 14, 15, 17, 19, 21, 22, 24, 25, 27, 29, 31];

            for &wlog in &wlog_candidates {
                if let Ok(mut dec) = zstd::stream::Decoder::new(std::io::Cursor::new(compressed)) {
                    if dec.window_log_max(wlog).is_ok() {
                        let mut out = Vec::new();
                        if dec.read_to_end(&mut out).is_ok() {
                            if out.starts_with(b"ROX1") {
                                let inner = &out[4..];
                                for &wlog2 in &wlog_candidates[..10] {
                                    if let Ok(mut dec2) = zstd::stream::Decoder::new(std::io::Cursor::new(inner)) {
                                        if dec2.window_log_max(wlog2).is_ok() {
                                            let mut out2 = Vec::new();
                                            if dec2.read_to_end(&mut out2).is_ok() {
                                                return Ok(out2);
                                            }
                                        }
                                    }
                                }
                            }
                            return Ok(out);
                        }
                    }
                }
            }

            // For small files that couldn't decompress, try raw extraction
            let mut data_end = compressed.len();
            for (j, chunk) in compressed.chunks(3).enumerate() {
                if chunk[0] == 0 && chunk[1] == 0 && chunk[2] == 0 {
                    data_end = j * 3;
                    break;
                }
            }

            let raw_data = &compressed[..data_end];
            if raw_data.len() >= 4 {
                let magic = u32::from_be_bytes([raw_data[0], raw_data[1], raw_data[2], raw_data[3]]);
                if magic == 0x524f5856 || magic == 0x524f5849 || magic == 0x524f5850 || magic == 0x524f5831 {
                    return Ok(raw_data.to_vec());
                }
            }

            return Ok(raw_data.to_vec());
        }
    }

    Err("No ROX1 payload found in pixel data".to_string())
}

fn extract_payload_from_idat_stream(png_data: &[u8]) -> Result<Vec<u8>, String> {
    // Extraire le payload depuis le flux IDAT du PNG
    let mut cursor = std::io::Cursor::new(png_data);

    // Sauter le header PNG (8 octets)
    cursor.seek(std::io::SeekFrom::Start(8)).map_err(|e| format!("seek: {}", e))?;

    let mut idat_data = Vec::new();
    loop {
        let mut chunk_len_bytes = [0u8; 4];
        cursor.read_exact(&mut chunk_len_bytes).map_err(|e| format!("read chunk len: {}", e))?;
        let chunk_len = u32::from_be_bytes(chunk_len_bytes);

        let mut chunk_type_bytes = [0u8; 4];
        cursor.read_exact(&mut chunk_type_bytes).map_err(|e| format!("read chunk type: {}", e))?;
        let chunk_type = std::str::from_utf8(&chunk_type_bytes).map_err(|e| format!("invalid chunk type: {}", e))?;

        if chunk_type == "IDAT" {
            let mut chunk_data = vec![0u8; chunk_len as usize];
            cursor.read_exact(&mut chunk_data).map_err(|e| format!("read IDAT data: {}", e))?;
            idat_data.extend_from_slice(&chunk_data);
        } else {
            cursor.seek(std::io::SeekFrom::Current(chunk_len as i64 + 4)).map_err(|e| format!("skip chunk: {}", e))?;
        }

        if chunk_type == "IEND" {
            break;
        }
    }

    // Décompresser les données IDAT
    let mut decoder = flate2::read::ZlibDecoder::new(std::io::Cursor::new(idat_data));
    let mut decompressed = Vec::new();
    decoder.read_to_end(&mut decompressed).map_err(|e| format!("zlib decompress: {}", e))?;

    // Extraire le payload depuis les données décompressées
    find_payload_in_decompressed_data(&decompressed)
}

fn find_payload_in_decompressed_data(data: &[u8]) -> Result<Vec<u8>, String> {
    // Approche 1: Chercher le magic bytes ROX1
    let magic = b"ROX1";
    for i in 0..data.len().saturating_sub(magic.len()) {
        if &data[i..i+magic.len()] == magic {
            // Parser le header ROX1
            if i + 12 > data.len() {
                return Err("Truncated ROX1 header".to_string());
            }

            let pack_magic = u32::from_be_bytes([data[i+4], data[i+5], data[i+6], data[i+7]]);
            if pack_magic != 0x524F5850 { // "ROXP"
                return Err("Invalid ROX1 pack magic".to_string());
            }

            let _entries_count = u32::from_be_bytes([data[i+8], data[i+9], data[i+10], data[i+11]]) as usize;

            // Calculer la position du payload (après les headers)
            let payload_start = i + 12;
            if payload_start >= data.len() {
                return Err("No payload data".to_string());
            }

            // Essayer de trouver la fin du payload en cherchant zstd magic
            let zstd_magic = [0x28, 0xb5, 0x2f, 0xfd];
            let mut payload_end = data.len();
            for j in (payload_start + 10)..data.len().saturating_sub(4) {
                if &data[j..j+4] == zstd_magic {
                    payload_end = j;
                    break;
                }
            }

            return Ok(data[payload_start..payload_end].to_vec());
        }
    }

    // Approche 2: Chercher PXL1 (pour les données encodées dans les pixels)
    let pxl1_magic = b"PXL1";
    for i in 0..data.len().saturating_sub(pxl1_magic.len()) {
        if &data[i..i+pxl1_magic.len()] == pxl1_magic {
            // Parser le header PXL1
            if i + 8 > data.len() {
                return Err("Truncated PXL1 header".to_string());
            }

            let payload_len = u32::from_be_bytes([data[i+4], data[i+5], data[i+6], data[i+7]]) as usize;
            let payload_start = i + 8;
            let payload_end = (payload_start + payload_len).min(data.len());

            if payload_end > payload_start {
                return Ok(data[payload_start..payload_end].to_vec());
            }
        }
    }

    // Approche 3: Retourner toutes les données après le premier octet non nul
    for i in 0..data.len() {
        if data[i] != 0 {
            return Ok(data[i..].to_vec());
        }
    }

    Err("No payload found in IDAT data".to_string())
}

fn extract_payload_direct_from_pixels(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let (pixels, width, height) = decode_to_rgba_grid(png_data)?;
    let w = width as usize;
    let h = height as usize;

    let mut rgb_data = Vec::with_capacity(w * h * 3);
    for pixel in &pixels {
        rgb_data.extend_from_slice(&[pixel[0], pixel[1], pixel[2]]);
    }

    let magic = b"PXL1";
    for i in 0..rgb_data.len().saturating_sub(magic.len()) {
        if &rgb_data[i..i+magic.len()] == magic {
            // Parser le header PXL1
            if i + 8 > rgb_data.len() {
                return Err("Truncated PXL1 header".to_string());
            }

            let payload_len = u32::from_be_bytes([
                rgb_data[i+4],
                rgb_data[i+5],
                rgb_data[i+6],
                rgb_data[i+7]
            ]) as usize;

            let payload_start = i + 8;
            let payload_end = (payload_start + payload_len).min(rgb_data.len());

            if payload_end > payload_start {
                let mut payload = rgb_data[payload_start..payload_end].to_vec();

                // Corriger le BOM UTF-8 au début du payload
                if payload.len() >= 3 && payload[0..3] == [0xef, 0xbb, 0xbf] {
                    // BOM UTF-8 détecté, le supprimer
                    payload = payload[3..].to_vec();
                }

                return Ok(payload);
            }
        }
    }

    // Si PXL1 n'est pas trouvé, chercher ROX1
    let rox1_magic = b"ROX1";
    for i in 0..rgb_data.len().saturating_sub(rox1_magic.len()) {
        if &rgb_data[i..i+rox1_magic.len()] == rox1_magic {
            // Parser le header ROX1
            if i + 12 > rgb_data.len() {
                return Err("Truncated ROX1 header".to_string());
            }

            let pack_magic = u32::from_be_bytes([
                rgb_data[i+4],
                rgb_data[i+5],
                rgb_data[i+6],
                rgb_data[i+7]
            ]);

            if pack_magic != 0x524F5850 { // "ROXP"
                return Err("Invalid ROX1 pack magic".to_string());
            }

            let _entries_count = u32::from_be_bytes([
                rgb_data[i+8],
                rgb_data[i+9],
                rgb_data[i+10],
                rgb_data[i+11]
            ]) as usize;

            // Calculer la position du payload
            let payload_start = i + 12;
            if payload_start >= rgb_data.len() {
                return Err("No payload data".to_string());
            }

            // Estimer la fin du payload
            let estimated_payload_size = rgb_data.len() - payload_start - 50;
            let payload_end = (payload_start + estimated_payload_size).min(rgb_data.len());

            let mut payload = rgb_data[payload_start..payload_end].to_vec();

            // Corriger le BOM UTF-8 au début du payload
            if payload.len() >= 3 && payload[0..3] == [0xef, 0xbb, 0xbf] {
                // BOM UTF-8 détecté, le supprimer
                payload = payload[3..].to_vec();
            }

            return Ok(payload);
        }
    }

    Err("No payload found in RGB pixel data".to_string())
}

fn extract_payload_direct_flexible(png_data: &[u8]) -> Result<Vec<u8>, String> {
    // Version plus tolérante qui essaie plusieurs approches
    if let Ok(raw) = decode_to_rgb(png_data) {
        if let Ok(pos) = find_pixel_header(&raw) {
            if let Ok(header) = parse_pixel_payload_header(&raw, pos) {
                let end = header.payload_offset + header.payload_len;
                if end <= raw.len() {
                    let payload = raw[header.payload_offset..end].to_vec();
                    return Ok(payload);
                }
            }
        }
    }

    // Fallback: chercher n'importe quel motif ressemblant à PXL1
    if let Ok(raw) = decode_to_rgb(png_data) {
        let magic = b"PXL1";
        for i in 0..(raw.len().saturating_sub(magic.len() + 10)) {
            if &raw[i..i + magic.len()] == magic {
                // Essayer de parser à partir de cette position
                if let Ok(header) = parse_pixel_payload_header(&raw, i) {
                    let end = header.payload_offset + header.payload_len;
                    if end <= raw.len() {
                        let payload = raw[header.payload_offset..end].to_vec();
                        return Ok(payload);
                    }
                }
            }
        }
    }

    Err("Flexible extraction failed".to_string())
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
    let header = parse_pixel_payload_header(&logical_rgb, pos)?;
    let mut idx = header.payload_offset + header.payload_len;
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
    let header = parse_pixel_payload_header(&raw, pos)?;
    let mut idx = header.payload_offset + header.payload_len;
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
