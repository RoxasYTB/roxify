use std::io::{Write, BufWriter, Read};
use std::fs::File;
use std::path::Path;
use walkdir::WalkDir;
use tar::{Builder, Header};

const PNG_HEADER: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];
const PIXEL_MAGIC: &[u8] = b"PXL1";
const MARKER_START: [(u8, u8, u8); 3] = [(255, 0, 0), (0, 255, 0), (0, 0, 255)];
const MARKER_END: [(u8, u8, u8); 3] = [(0, 0, 255), (0, 255, 0), (255, 0, 0)];
const MARKER_ZSTD: (u8, u8, u8) = (0, 255, 0);
const MAGIC: &[u8] = b"ROX1";

pub fn encode_dir_to_png(
    dir_path: &Path,
    output_path: &Path,
    compression_level: i32,
    name: Option<&str>,
) -> anyhow::Result<()> {
    encode_dir_to_png_encrypted(dir_path, output_path, compression_level, name, None, None)
}

pub fn encode_dir_to_png_encrypted(
    dir_path: &Path,
    output_path: &Path,
    compression_level: i32,
    name: Option<&str>,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
) -> anyhow::Result<()> {
    let tmp_zst = output_path.with_extension("tmp.zst");

    let file_list = compress_dir_to_zst(dir_path, &tmp_zst, compression_level)?;
    let file_list_json = serde_json::to_string(&file_list)?;

    let result = write_png_from_zst(
        &tmp_zst, output_path, name, Some(&file_list_json),
        passphrase, encrypt_type,
    );
    let _ = std::fs::remove_file(&tmp_zst);
    result
}

fn compress_dir_to_zst(
    dir_path: &Path,
    zst_path: &Path,
    compression_level: i32,
) -> anyhow::Result<Vec<serde_json::Value>> {
    let base = dir_path;

    let entries: Vec<_> = WalkDir::new(dir_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    let zst_file = File::create(zst_path)?;
    let buf_writer = BufWriter::with_capacity(16 * 1024 * 1024, zst_file);

    let actual_level = compression_level.min(3);
    let mut encoder = zstd::stream::Encoder::new(buf_writer, actual_level)
        .map_err(|e| anyhow::anyhow!("zstd init: {}", e))?;

    let threads = num_cpus::get() as u32;
    if threads > 1 {
        let _ = encoder.multithread(threads);
    }
    let _ = encoder.long_distance_matching(true);
    let _ = encoder.window_log(30);

    encoder.write_all(MAGIC)?;

    let mut file_list = Vec::new();
    {
        let mut tar_builder = Builder::new(&mut encoder);
        for entry in &entries {
            let full = entry.path();
            let rel = full.strip_prefix(base).unwrap_or(full);
            let rel_str = rel.to_string_lossy().replace('\\', "/");

            let metadata = match std::fs::metadata(full) {
                Ok(m) => m,
                Err(_) => continue,
            };
            let size = metadata.len();

            let mut header = Header::new_gnu();
            header.set_size(size);
            header.set_mode(0o644);
            header.set_cksum();

            let file = match File::open(full) {
                Ok(f) => f,
                Err(_) => continue,
            };
            let buf_reader = std::io::BufReader::with_capacity(
                (size as usize).min(4 * 1024 * 1024).max(8192),
                file,
            );

            tar_builder.append_data(&mut header, &rel_str, buf_reader)
                .map_err(|e| anyhow::anyhow!("tar append {}: {}", rel_str, e))?;

            file_list.push(serde_json::json!({"name": rel_str, "size": size}));
        }
        tar_builder.finish().map_err(|e| anyhow::anyhow!("tar finish: {}", e))?;
    }

    encoder.finish().map_err(|e| anyhow::anyhow!("zstd finish: {}", e))?;

    Ok(file_list)
}

fn write_png_from_zst(
    zst_path: &Path,
    output_path: &Path,
    name: Option<&str>,
    file_list: Option<&str>,
    passphrase: Option<&str>,
    _encrypt_type: Option<&str>,
) -> anyhow::Result<()> {
    let zst_size = std::fs::metadata(zst_path)?.len() as usize;

    let mut encryptor = match passphrase {
        Some(pass) if !pass.is_empty() => Some(crate::crypto::StreamingEncryptor::new(pass)?),
        _ => None,
    };

    let enc_header_len = encryptor.as_ref().map(|e| e.header_len()).unwrap_or(1);
    let hmac_trailer_len: usize = if encryptor.is_some() { 32 } else { 0 };

    let encrypted_payload_len = enc_header_len + zst_size + hmac_trailer_len;

    let version = 1u8;
    let name_bytes = name.map(|n| n.as_bytes()).unwrap_or(&[]);
    let name_len = name_bytes.len().min(255) as u8;
    let payload_len_bytes = (encrypted_payload_len as u32).to_be_bytes();

    let mut meta_header = Vec::with_capacity(1 + 1 + name_len as usize + 4);
    meta_header.push(version);
    meta_header.push(name_len);
    if name_len > 0 {
        meta_header.extend_from_slice(&name_bytes[..name_len as usize]);
    }
    meta_header.extend_from_slice(&payload_len_bytes);

    let meta_header_len = meta_header.len();

    let file_list_chunk = file_list.map(|fl| {
        let json_bytes = fl.as_bytes();
        let mut chunk = Vec::with_capacity(4 + 4 + json_bytes.len());
        chunk.extend_from_slice(b"rXFL");
        chunk.extend_from_slice(&(json_bytes.len() as u32).to_be_bytes());
        chunk.extend_from_slice(json_bytes);
        chunk
    });
    let file_list_inline_len = file_list_chunk.as_ref().map(|c| c.len()).unwrap_or(0);

    let total_meta_pixel_len = meta_header_len + encrypted_payload_len + file_list_inline_len;
    let raw_payload_len = PIXEL_MAGIC.len() + total_meta_pixel_len;
    let padding_needed = (3 - (raw_payload_len % 3)) % 3;
    let padded_len = raw_payload_len + padding_needed;

    let marker_start_len = 12;
    let data_with_markers_len = marker_start_len + padded_len;
    let data_pixels = (data_with_markers_len + 2) / 3;
    let end_marker_pixels = 3;
    let total_pixels = data_pixels + end_marker_pixels;

    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let side = side.max(end_marker_pixels);
    let width = side;
    let height = side;
    let row_bytes = width * 3;
    let total_data_bytes = width * height * 3;
    let marker_end_pos = (height - 1) * width * 3 + (width - end_marker_pixels) * 3;

    let enc_header_bytes = if let Some(ref enc) = encryptor {
        enc.header.clone()
    } else {
        vec![0x00]
    };

    let header_bytes = build_header_bytes(&meta_header, &enc_header_bytes);

    let stride = row_bytes + 1;
    let scanlines_total = height * stride;

    const MAX_BLOCK: usize = 65535;
    let num_blocks = (scanlines_total + MAX_BLOCK - 1) / MAX_BLOCK;
    let idat_len = 2 + num_blocks * 5 + scanlines_total + 4;

    let out_file = File::create(output_path)?;
    let mut w = BufWriter::with_capacity(16 * 1024 * 1024, out_file);

    w.write_all(PNG_HEADER)?;

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 2;
    write_chunk_hdr(&mut w, b"IHDR", &ihdr)?;

    let mut zst_file = File::open(zst_path)?;
    let mut zst_reader = std::io::BufReader::with_capacity(16 * 1024 * 1024, &mut zst_file);

    write_idat_streaming(
        &mut w,
        &header_bytes,
        &mut zst_reader,
        zst_size,
        file_list_chunk.as_deref(),
        &mut encryptor,
        hmac_trailer_len,
        height,
        row_bytes,
        marker_end_pos,
        idat_len,
        total_data_bytes,
    )?;

    if let Some(fl) = file_list {
        write_chunk_hdr(&mut w, b"rXFL", fl.as_bytes())?;
    }
    write_chunk_hdr(&mut w, b"IEND", &[])?;
    w.flush()?;

    Ok(())
}

fn build_header_bytes(meta_header: &[u8], enc_header: &[u8]) -> Vec<u8> {
    let mut header = Vec::with_capacity(12 + PIXEL_MAGIC.len() + meta_header.len() + enc_header.len());
    for m in &MARKER_START {
        header.push(m.0); header.push(m.1); header.push(m.2);
    }
    header.push(MARKER_ZSTD.0); header.push(MARKER_ZSTD.1); header.push(MARKER_ZSTD.2);
    header.extend_from_slice(PIXEL_MAGIC);
    header.extend_from_slice(meta_header);
    header.extend_from_slice(enc_header);
    header
}

fn write_idat_streaming<W: Write, R: Read>(
    w: &mut W,
    header_bytes: &[u8],
    zst_reader: &mut R,
    zst_size: usize,
    file_list_chunk: Option<&[u8]>,
    encryptor: &mut Option<crate::crypto::StreamingEncryptor>,
    hmac_trailer_len: usize,
    height: usize,
    row_bytes: usize,
    marker_end_pos: usize,
    idat_len: usize,
    total_data_bytes: usize,
) -> anyhow::Result<()> {
    w.write_all(&(idat_len as u32).to_be_bytes())?;
    w.write_all(b"IDAT")?;

    let mut crc = crc32fast::Hasher::new();
    crc.update(b"IDAT");

    let stride = row_bytes + 1;
    let scanlines_total = height * stride;

    let zlib = [0x78u8, 0x01];
    w.write_all(&zlib)?;
    crc.update(&zlib);

    let fl_chunk_data = file_list_chunk.unwrap_or(&[]);
    let payload_total = header_bytes.len() + zst_size + hmac_trailer_len + fl_chunk_data.len();
    let padding_after = total_data_bytes - payload_total.min(total_data_bytes);

    let marker_end_bytes = build_marker_end_bytes();

    let mut flat_pos: usize = 0;
    let mut scanline_pos: usize = 0;
    let mut deflate_block_remaining: usize = 0;

    let mut header_pos: usize = 0;
    let mut zst_remaining = zst_size;
    let mut hmac_pos: usize = 0;
    let mut hmac_written = hmac_trailer_len == 0;
    let mut hmac_finalized: Option<[u8; 32]> = None;
    let mut fl_pos: usize = 0;
    let mut zero_remaining = padding_after;

    let mut adler_a: u32 = 1;
    let mut adler_b: u32 = 0;

    let buf_size = 1024 * 1024;
    let mut transfer_buf = vec![0u8; buf_size];

    for _row in 0..height {
        if deflate_block_remaining == 0 {
            let remaining_scanlines = scanlines_total - scanline_pos;
            let block_size = remaining_scanlines.min(65535);
            let is_last = scanline_pos + block_size >= scanlines_total;
            let header = [
                if is_last { 0x01 } else { 0x00 },
                block_size as u8,
                (block_size >> 8) as u8,
                !block_size as u8,
                (!(block_size >> 8)) as u8,
            ];
            w.write_all(&header)?;
            crc.update(&header);
            deflate_block_remaining = block_size;
        }

        let filter_byte = [0u8];
        w.write_all(&filter_byte)?;
        crc.update(&filter_byte);
        adler_a = (adler_a + 0) % 65521;
        adler_b = (adler_b + adler_a) % 65521;
        scanline_pos += 1;
        deflate_block_remaining -= 1;

        let mut cols_written = 0;
        while cols_written < row_bytes {
            if deflate_block_remaining == 0 {
                let remaining_scanlines = scanlines_total - scanline_pos;
                let block_size = remaining_scanlines.min(65535);
                let is_last = scanline_pos + block_size >= scanlines_total;
                let header = [
                    if is_last { 0x01 } else { 0x00 },
                    block_size as u8,
                    (block_size >> 8) as u8,
                    !block_size as u8,
                    (!(block_size >> 8)) as u8,
                ];
                w.write_all(&header)?;
                crc.update(&header);
                deflate_block_remaining = block_size;
            }

            let can_write = (row_bytes - cols_written).min(deflate_block_remaining);

            let mut chunk_written = 0;
            while chunk_written < can_write {
                let need = can_write - chunk_written;

                let is_marker_end_region = flat_pos >= marker_end_pos && flat_pos < marker_end_pos + 9;

                if is_marker_end_region {
                    let me_offset = flat_pos - marker_end_pos;
                    let me_remaining = 9 - me_offset;
                    let take = need.min(me_remaining);
                    let slice = &marker_end_bytes[me_offset..me_offset + take];
                    w.write_all(slice)?;
                    crc.update(slice);
                    for &b in slice {
                        adler_a = (adler_a + b as u32) % 65521;
                        adler_b = (adler_b + adler_a) % 65521;
                    }
                    flat_pos += take;
                    chunk_written += take;
                    scanline_pos += take;
                    deflate_block_remaining -= take;
                    cols_written += take;
                    continue;
                }

                if header_pos < header_bytes.len() {
                    let avail = header_bytes.len() - header_pos;
                    let take = need.min(avail);
                    let slice = &header_bytes[header_pos..header_pos + take];
                    w.write_all(slice)?;
                    crc.update(slice);
                    for &b in slice {
                        adler_a = (adler_a + b as u32) % 65521;
                        adler_b = (adler_b + adler_a) % 65521;
                    }
                    header_pos += take;
                    flat_pos += take;
                    chunk_written += take;
                    scanline_pos += take;
                    deflate_block_remaining -= take;
                    cols_written += take;
                } else if zst_remaining > 0 {
                    let take = need.min(zst_remaining).min(buf_size);
                    let got = zst_reader.read(&mut transfer_buf[..take])
                        .map_err(|e| anyhow::anyhow!("read zst: {}", e))?;
                    if got == 0 { break; }
                    if let Some(ref mut enc) = encryptor {
                        enc.encrypt_chunk(&mut transfer_buf[..got]);
                    }
                    w.write_all(&transfer_buf[..got])?;
                    crc.update(&transfer_buf[..got]);
                    for &b in &transfer_buf[..got] {
                        adler_a = (adler_a + b as u32) % 65521;
                        adler_b = (adler_b + adler_a) % 65521;
                    }
                    zst_remaining -= got;
                    flat_pos += got;
                    chunk_written += got;
                    scanline_pos += got;
                    deflate_block_remaining -= got;
                    cols_written += got;
                } else if !hmac_written {
                    if hmac_finalized.is_none() {
                        if let Some(enc) = encryptor.take() {
                            hmac_finalized = Some(enc.finalize_hmac());
                        }
                    }
                    if let Some(ref hmac_bytes) = hmac_finalized {
                        let avail = hmac_trailer_len - hmac_pos;
                        let take = need.min(avail);
                        let slice = &hmac_bytes[hmac_pos..hmac_pos + take];
                        w.write_all(slice)?;
                        crc.update(slice);
                        for &b in slice {
                            adler_a = (adler_a + b as u32) % 65521;
                            adler_b = (adler_b + adler_a) % 65521;
                        }
                        hmac_pos += take;
                        flat_pos += take;
                        chunk_written += take;
                        scanline_pos += take;
                        deflate_block_remaining -= take;
                        cols_written += take;
                        if hmac_pos >= hmac_trailer_len {
                            hmac_written = true;
                        }
                    } else {
                        hmac_written = true;
                    }
                } else if fl_pos < fl_chunk_data.len() {
                    let avail = fl_chunk_data.len() - fl_pos;
                    let take = need.min(avail);
                    let slice = &fl_chunk_data[fl_pos..fl_pos + take];
                    w.write_all(slice)?;
                    crc.update(slice);
                    for &b in slice {
                        adler_a = (adler_a + b as u32) % 65521;
                        adler_b = (adler_b + adler_a) % 65521;
                    }
                    fl_pos += take;
                    flat_pos += take;
                    chunk_written += take;
                    scanline_pos += take;
                    deflate_block_remaining -= take;
                    cols_written += take;
                } else {
                    let take = need.min(zero_remaining).min(buf_size);
                    if take == 0 { break; }
                    let zeros = vec![0u8; take];
                    w.write_all(&zeros)?;
                    crc.update(&zeros);
                    for _ in 0..take {
                        adler_b = (adler_b + adler_a) % 65521;
                    }
                    zero_remaining -= take;
                    flat_pos += take;
                    chunk_written += take;
                    scanline_pos += take;
                    deflate_block_remaining -= take;
                    cols_written += take;
                }
            }
        }
    }

    let adler = (adler_b << 16) | adler_a;
    let adler_bytes = adler.to_be_bytes();
    w.write_all(&adler_bytes)?;
    crc.update(&adler_bytes);

    w.write_all(&crc.finalize().to_be_bytes())?;
    Ok(())
}

fn build_marker_end_bytes() -> [u8; 9] {
    let mut buf = [0u8; 9];
    for (i, m) in MARKER_END.iter().enumerate() {
        buf[i * 3] = m.0;
        buf[i * 3 + 1] = m.1;
        buf[i * 3 + 2] = m.2;
    }
    buf
}

fn write_chunk_hdr<W: Write>(w: &mut W, chunk_type: &[u8; 4], data: &[u8]) -> anyhow::Result<()> {
    w.write_all(&(data.len() as u32).to_be_bytes())?;
    w.write_all(chunk_type)?;
    w.write_all(data)?;
    let mut h = crc32fast::Hasher::new();
    h.update(chunk_type);
    h.update(data);
    w.write_all(&h.finalize().to_be_bytes())?;
    Ok(())
}
