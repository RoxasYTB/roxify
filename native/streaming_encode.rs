use std::io::{Write, BufWriter, Read};
use std::fs::File;
use std::path::{Path, PathBuf};
use rayon::prelude::*;
use serde::Serialize;
use walkdir::WalkDir;

use crate::png_chunk_writer::{ChunkedIdatWriter, write_png_chunk};

const PNG_HEADER: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];
const PIXEL_MAGIC: &[u8] = b"PXL1";
const MARKER_START: [(u8, u8, u8); 3] = [(255, 0, 0), (0, 255, 0), (0, 0, 255)];
const MARKER_END: [(u8, u8, u8); 3] = [(0, 0, 255), (0, 255, 0), (255, 0, 0)];
const MARKER_ZSTD: (u8, u8, u8) = (0, 255, 0);
const MAGIC: &[u8] = b"ROX1";
const PACK_MAGIC: u32 = 0x524f5850;

const MIN_ZST_CAPACITY: usize = 16 * 1024 * 1024;
const MB: u64 = 1024 * 1024;
const MAX_FILE_BUFFER_CAPACITY: usize = 4 * 1024 * 1024;
const PARALLEL_IO_FILE_THRESHOLD: u64 = MB;
const PARALLEL_IO_BATCH_BYTES: u64 = 128 * MB;
const PARALLEL_IO_BATCH_FILES: usize = 512;
const PARALLEL_IO_MIN_FILES: usize = 8;
const HEADER_VERSION_V2: u8 = 2;

pub type ProgressCallback = Box<dyn Fn(u64, u64, &str) + Send>;

struct DirectoryFile {
    path: PathBuf,
    rel_path: String,
    size: u64,
}

#[derive(Serialize)]
struct FileListEntry {
    name: String,
    size: u64,
}

struct CollectedDirectory {
    entries: Vec<DirectoryFile>,
    total_bytes: u64,
}

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
    encode_dir_to_png_encrypted_with_progress(dir_path, output_path, compression_level, name, passphrase, encrypt_type, None)
}

pub fn encode_dir_to_png_encrypted_with_progress(
    dir_path: &Path,
    output_path: &Path,
    compression_level: i32,
    name: Option<&str>,
    passphrase: Option<&str>,
    encrypt_type: Option<&str>,
    progress: Option<ProgressCallback>,
) -> anyhow::Result<()> {
    let (zst_buf, file_list_json) = compress_dir_to_zst_mem(dir_path, compression_level, &progress)?;

    let result = write_png_from_zst_mem(
        zst_buf, output_path, name, Some(&file_list_json),
        passphrase, encrypt_type, &progress,
    );

    if let Some(ref cb) = progress {
        cb(100, 100, "done");
    }

    result
}

fn compress_dir_to_zst_mem(
    dir_path: &Path,
    compression_level: i32,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<(Vec<u8>, String)> {
    let collected = collect_directory_files(dir_path);
    let total_bytes = collected.total_bytes;
    let entries = collected.entries;

    let actual_level = compression_level.min(3);
    let mut encoder = zstd::stream::Encoder::new(
        Vec::with_capacity(estimate_zst_capacity(total_bytes)),
        actual_level,
    )
        .map_err(|e| anyhow::anyhow!("zstd init: {}", e))?;

    let threads = select_zstd_threads(total_bytes);
    if threads > 1 {
        let _ = encoder.multithread(threads);
    }
    let _ = encoder.long_distance_matching(true);
    let _ = encoder.window_log(30);

    encoder.write_all(MAGIC)?;
    encoder.write_all(&PACK_MAGIC.to_be_bytes())?;
    encoder.write_all(&(entries.len() as u32).to_be_bytes())?;

    let mut file_list = Vec::with_capacity(entries.len());
    let mut bytes_processed: u64 = 0;
    let mut last_pct: u64 = 0;
    let mut entry_index = 0usize;
    while entry_index < entries.len() {
        let batch_end = select_parallel_batch_end(&entries, entry_index);
        if batch_end > entry_index + 1 {
            let loaded = load_small_file_batch(&entries[entry_index..batch_end])?;
            for (entry, maybe_bytes) in entries[entry_index..batch_end].iter().zip(loaded.into_iter()) {
                let Some(bytes) = maybe_bytes else {
                    continue;
                };

                write_pack_entry_header(&mut encoder, &entry.rel_path, entry.size)?;
                encoder.write_all(&bytes)
                    .map_err(|e| anyhow::anyhow!("pack write {}: {}", entry.rel_path, e))?;

                file_list.push(FileListEntry {
                    name: entry.rel_path.clone(),
                    size: entry.size,
                });

                bytes_processed += entry.size;
                report_compress_progress(progress, total_bytes, bytes_processed, &mut last_pct);
            }
            entry_index = batch_end;
            continue;
        }

        let entry = &entries[entry_index];
        if write_directory_entry(&mut encoder, entry)? {
            file_list.push(FileListEntry {
                name: entry.rel_path.clone(),
                size: entry.size,
            });

            bytes_processed += entry.size;
            report_compress_progress(progress, total_bytes, bytes_processed, &mut last_pct);
        }
        entry_index += 1;
    }

    let zst_buf = encoder.finish().map_err(|e| anyhow::anyhow!("zstd finish: {}", e))?;
    let file_list_json = serde_json::to_string(&file_list)?;

    Ok((zst_buf, file_list_json))
}

fn write_pack_entry_header<W: Write>(writer: &mut W, rel_path: &str, size: u64) -> anyhow::Result<()> {
    let name_bytes = rel_path.as_bytes();
    let name_len = u16::try_from(name_bytes.len())
        .map_err(|_| anyhow::anyhow!("path too long for pack entry: {}", rel_path))?;
    writer.write_all(&name_len.to_be_bytes())?;
    writer.write_all(name_bytes)?;
    writer.write_all(&size.to_be_bytes())?;
    Ok(())
}

fn write_directory_entry<W: Write>(writer: &mut W, entry: &DirectoryFile) -> anyhow::Result<bool> {
    let file = match File::open(&entry.path) {
        Ok(file) => file,
        Err(_) => return Ok(false),
    };

    write_pack_entry_header(writer, &entry.rel_path, entry.size)?;

    let mut buf_reader = std::io::BufReader::with_capacity(file_buffer_capacity(entry.size), file);
    std::io::copy(&mut buf_reader, writer)
        .map_err(|e| anyhow::anyhow!("pack write {}: {}", entry.rel_path, e))?;

    Ok(true)
}

fn load_small_file_batch(entries: &[DirectoryFile]) -> anyhow::Result<Vec<Option<Vec<u8>>>> {
    entries.par_iter().map(load_directory_entry_bytes).collect()
}

fn load_directory_entry_bytes(entry: &DirectoryFile) -> anyhow::Result<Option<Vec<u8>>> {
    let mut file = match File::open(&entry.path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };

    let reserve = usize::try_from(entry.size.min(PARALLEL_IO_BATCH_BYTES)).unwrap_or(MAX_FILE_BUFFER_CAPACITY);
    let mut bytes = Vec::with_capacity(reserve.max(8192));
    file.read_to_end(&mut bytes)
        .map_err(|e| anyhow::anyhow!("pack read {}: {}", entry.rel_path, e))?;

    Ok(Some(bytes))
}

fn select_parallel_batch_end(entries: &[DirectoryFile], start: usize) -> usize {
    let Some(first) = entries.get(start) else {
        return start;
    };
    if !should_parallelize_entry(first) {
        return start + 1;
    }

    let mut end = start;
    let mut batch_bytes = 0u64;
    while end < entries.len() {
        let entry = &entries[end];
        if !should_parallelize_entry(entry) {
            break;
        }
        if end > start {
            if end - start >= PARALLEL_IO_BATCH_FILES {
                break;
            }
            if batch_bytes.saturating_add(entry.size) > PARALLEL_IO_BATCH_BYTES {
                break;
            }
        }
        batch_bytes = batch_bytes.saturating_add(entry.size);
        end += 1;
    }

    if end - start >= PARALLEL_IO_MIN_FILES {
        end
    } else {
        start + 1
    }
}

fn should_parallelize_entry(entry: &DirectoryFile) -> bool {
    entry.size <= PARALLEL_IO_FILE_THRESHOLD
}

fn file_buffer_capacity(size: u64) -> usize {
    usize::try_from(size)
        .unwrap_or(MAX_FILE_BUFFER_CAPACITY)
        .min(MAX_FILE_BUFFER_CAPACITY)
        .max(8192)
}

fn report_compress_progress(
    progress: &Option<ProgressCallback>,
    total_bytes: u64,
    bytes_processed: u64,
    last_pct: &mut u64,
) {
    if let Some(ref cb) = progress {
        let pct = if total_bytes > 0 {
            (bytes_processed * 89 / total_bytes).min(89)
        } else {
            89
        };
        if pct > *last_pct {
            *last_pct = pct;
            cb(pct, 100, "compressing");
        }
    }
}

fn collect_directory_files(dir_path: &Path) -> CollectedDirectory {
    let mut entries = Vec::new();
    let mut total_bytes = 0u64;

    for entry in WalkDir::new(dir_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file())
    {
        let size = match entry.metadata() {
            Ok(metadata) => metadata.len(),
            Err(_) => continue,
        };
        let path = entry.into_path();
        let rel = path.strip_prefix(dir_path).unwrap_or(path.as_path());
        let rel_path = normalize_rel_path(rel);

        total_bytes += size;
        entries.push(DirectoryFile {
            path,
            rel_path,
            size,
        });
    }

    CollectedDirectory {
        entries,
        total_bytes,
    }
}

fn normalize_rel_path(path: &Path) -> String {
    let rel_path = path.to_string_lossy();
    if rel_path.contains('\\') {
        rel_path.replace('\\', "/")
    } else {
        rel_path.into_owned()
    }
}

fn estimate_zst_capacity(total_bytes: u64) -> usize {
    let capped = total_bytes.min(usize::MAX as u64) as usize;
    (capped / 3).max(MIN_ZST_CAPACITY)
}

fn select_zstd_threads(total_bytes: u64) -> u32 {
    let max_threads = num_cpus::get().max(1) as u32;
    let ram_mb = crate::parse_linux_mem_available_mb().unwrap_or(4096);
    
    // Aggressive multi-threading for Pyxelze speed target (<10s)
    if total_bytes <= 16 * MB {
        // Small files: single thread to avoid overhead
        1
    } else if total_bytes <= 64 * MB {
        // Small-medium files: 2 threads
        max_threads.min(2)
    } else if total_bytes <= 256 * MB || ram_mb >= 8192 {
        // Medium files or high RAM: up to 4 threads
        max_threads.min(4)
    } else if total_bytes <= 1024 * MB || ram_mb >= 4096 {
        // Large files or medium RAM: up to 8 threads  
        max_threads.min(8)
    } else {
        // Very large files: use all available cores up to 16
        max_threads.min(16)
    }
}

fn write_png_from_zst_mem(
    zst_buf: Vec<u8>,
    output_path: &Path,
    name: Option<&str>,
    file_list: Option<&str>,
    passphrase: Option<&str>,
    _encrypt_type: Option<&str>,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<()> {
    let zst_size = zst_buf.len();

    let mut encryptor = match passphrase {
        Some(pass) if !pass.is_empty() => Some(crate::crypto::StreamingEncryptor::new(pass)?),
        _ => None,
    };

    let enc_header_len = encryptor.as_ref().map(|e| e.header_len()).unwrap_or(1);
    let hmac_trailer_len: usize = if encryptor.is_some() { 32 } else { 0 };

    let encrypted_payload_len = enc_header_len + zst_size + hmac_trailer_len;

    let version = HEADER_VERSION_V2;
    let name_bytes = name.map(|n| n.as_bytes()).unwrap_or(&[]);
    let name_len = name_bytes.len().min(255) as u8;
    let payload_len_bytes = (encrypted_payload_len as u64).to_be_bytes();

    let mut meta_header = Vec::with_capacity(1 + 1 + name_len as usize + 8);
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
    let marker_end_bytes = 9;
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
    let marker_end_pos = total_data_bytes - marker_end_bytes;

    let enc_header_bytes = if let Some(ref enc) = encryptor {
        enc.header.clone()
    } else {
        vec![0x00]
    };

    let header_bytes = build_header_bytes(&meta_header, &enc_header_bytes);

    let out_file = File::create(output_path)?;
    let buf_capacity = if total_data_bytes > 256 * 1024 * 1024 { 16 * 1024 * 1024 }
        else if total_data_bytes > 16 * 1024 * 1024 { 8 * 1024 * 1024 }
        else { (total_data_bytes / 2).max(65536).min(4 * 1024 * 1024) };
    let mut w = BufWriter::with_capacity(buf_capacity, out_file);

    w.write_all(PNG_HEADER)?;

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 2;
    write_png_chunk(&mut w, b"IHDR", &ihdr)?;

    let mut zst_reader = std::io::Cursor::new(zst_buf);

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
        total_data_bytes,
        progress,
    )?;

    if let Some(fl) = file_list {
        write_png_chunk(&mut w, b"rXFL", fl.as_bytes())?;
    }
    write_png_chunk(&mut w, b"IEND", &[])?;
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
    total_data_bytes: usize,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<()> {
    let mut idat = ChunkedIdatWriter::new(w);

    let stride = row_bytes + 1;
    let scanlines_total = height * stride;

    let zlib = [0x78u8, 0x01];
    idat.write_all(&zlib)?;

    let fl_chunk_data = file_list_chunk.unwrap_or(&[]);
    let payload_total = header_bytes.len() + zst_size + hmac_trailer_len + fl_chunk_data.len();
    let padding_after = total_data_bytes - payload_total.min(total_data_bytes);
    let marker_end_bytes = build_marker_end_bytes();

    let mut flat_pos: usize = 0;
    let mut scanline_pos: usize = 0;
    let mut deflate_block_remaining: usize = 0;

    let mut adler = simd_adler32::Adler32::new();

    let buf_size = 1024 * 1024;
    let mut transfer_buf = vec![0u8; buf_size];
    let zero_buf = vec![0u8; buf_size];

    let mut header_pos: usize = 0;
    let mut zst_remaining = zst_size;
    let mut hmac_pos: usize = 0;
    let mut hmac_written = hmac_trailer_len == 0;
    let mut hmac_finalized: Option<[u8; 32]> = None;
    let mut fl_pos: usize = 0;
    let mut zero_remaining = padding_after;

    let mut last_png_pct: u64 = 89;

    for row_idx in 0..height {
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
            idat.write_all(&header)?;
            deflate_block_remaining = block_size;
        }

        let filter_byte = [0u8];
        idat.write_all(&filter_byte)?;
        adler.write(&filter_byte);
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
                idat.write_all(&header)?;
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
                    idat.write_all(slice)?;
                    adler.write(slice);
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
                    idat.write_all(slice)?;
                    adler.write(slice);
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
                    idat.write_all(&transfer_buf[..got])?;
                    adler.write(&transfer_buf[..got]);
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
                        idat.write_all(slice)?;
                        adler.write(slice);
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
                    idat.write_all(slice)?;
                    adler.write(slice);
                    fl_pos += take;
                    flat_pos += take;
                    chunk_written += take;
                    scanline_pos += take;
                    deflate_block_remaining -= take;
                    cols_written += take;
                } else {
                    let max_before_marker = if flat_pos < marker_end_pos {
                        marker_end_pos - flat_pos
                    } else {
                        need
                    };
                    let take = need.min(zero_remaining).min(buf_size).min(max_before_marker);
                    if take == 0 { break; }
                    idat.write_all(&zero_buf[..take])?;
                    adler.write(&zero_buf[..take]);
                    zero_remaining -= take;
                    flat_pos += take;
                    chunk_written += take;
                    scanline_pos += take;
                    deflate_block_remaining -= take;
                    cols_written += take;
                }
            }
        }

        if let Some(ref cb) = progress {
            let pct = 90 + ((row_idx as u64 + 1) * 9 / height as u64).min(9);
            if pct > last_png_pct {
                last_png_pct = pct;
                cb(pct, 100, "writing_png");
            }
        }
    }

    let adler_val = adler.finish();
    let adler_bytes = adler_val.to_be_bytes();
    idat.write_all(&adler_bytes)?;
    idat.finish()
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

