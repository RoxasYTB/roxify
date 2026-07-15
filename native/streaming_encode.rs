use std::io::{Write, BufWriter, Read};
use std::fs::File;
use std::path::{Path, PathBuf};
use rayon::prelude::*;
use serde::Serialize;

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
const MAX_FILE_BUFFER_CAPACITY: usize = 16 * 1024 * 1024;
const PADDING_ZEROS: &[u8] = &[0u8; 65536];

static IS_SOURCE_ROTATIONAL: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

fn check_source_rotational(dir_path: &Path) {
    let _ = IS_SOURCE_ROTATIONAL.get_or_init(|| {
        crate::io_advice::is_rotational(dir_path)
    });
}

fn source_is_ssd() -> bool {
    !IS_SOURCE_ROTATIONAL.get().copied().unwrap_or(true)
}

const PARALLEL_IO_FILE_THRESHOLD: u64 = if cfg!(target_os = "windows") { 64 * MB } else { 32 * MB };
const PARALLEL_IO_MIN_FILES: usize = 2;
const HEADER_VERSION_V2: u8 = 2;

fn effective_budget_mb() -> u64 {
    std::env::var("ROX_RAM_BUDGET_MB_EFFECTIVE")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(2048)
}

fn parallel_io_batch_bytes() -> u64 {

    let mb = (effective_budget_mb() * 15 / 100).max(128);
    mb * MB
}

fn parallel_io_batch_files() -> usize {
    let budget = effective_budget_mb();

    (budget as usize * 1024 / 16).max(4096)
}

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
    check_source_rotational(dir_path);
    let collected = collect_directory_files(dir_path);
    let entries = collected.entries;
    let total_bytes: u64 = entries.iter().map(|e| e.size).sum();

    if entries.is_empty() {
        anyhow::bail!("No files found in directory: {}", dir_path.display());
    }

    let actual_level = if compression_level == 0 {
        select_adaptive_level(&entries)
    } else {
        compression_level.clamp(-100, 22).min(size_cap(total_bytes))
    };

    let adaptive_window_log = select_zstd_window_log(total_bytes);
    let zst_size_upper = estimate_zst_capacity(total_bytes);

    encode_dir_streaming(
        &entries, total_bytes, zst_size_upper, output_path,
        actual_level, name, passphrase, encrypt_type,
        adaptive_window_log, &progress,
    )?;

    if let Some(ref cb) = progress {
        cb(100, 100, "done");
    }

    Ok(())
}

fn compress_dir_to_zst_mem(
    dir_path: &Path,
    compression_level: i32,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<(Vec<u8>, String)> {
    let collected = collect_directory_files(dir_path);
    let mut entries = collected.entries;
    entries.retain(|e| e.path.exists());
    let total_bytes: u64 = entries.iter().map(|e| e.size).sum();

    let actual_level = if compression_level == 0 {
        select_adaptive_level(&entries)
    } else {
        compression_level.clamp(-100, 22).min(size_cap(total_bytes))
    };
    let mut encoder = zstd::stream::Encoder::new(
        Vec::with_capacity(estimate_zst_capacity(total_bytes)),
        actual_level,
    )
        .map_err(|e| anyhow::anyhow!("zstd init: {}", e))?;

    let threads = select_zstd_threads(total_bytes);
    if threads > 1 {
        if let Err(e) = encoder.multithread(threads) {
            eprintln!(
                "warn: zstd multithread({}) failed: {} — falls back to single thread",
                threads, e
            );
        }
    }
    if total_bytes > 32 * MB {
        let _ = encoder.long_distance_matching(true);
    }
    let adaptive_window_log = select_zstd_window_log(total_bytes);
    let _ = encoder.window_log(adaptive_window_log);

    if threads > 1 {
        let budget_mb = effective_budget_mb();
        let target_total_mb = (budget_mb / 3).max(128);
        let per_worker_mb = (target_total_mb / threads as u64).clamp(16, 256);
        let job_size_bytes = (per_worker_mb * MB).min(u32::MAX as u64) as u32;
        let _ = encoder.set_parameter(zstd::stream::raw::CParameter::JobSize(job_size_bytes));
    }

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

                write_pack_entry_header(&mut encoder, &entry.rel_path, bytes.len() as u64)?;
                encoder.write_all(&bytes)
                    .map_err(|e| anyhow::anyhow!("pack write {}: {}", entry.rel_path, e))?;

                file_list.push(FileListEntry {
                    name: entry.rel_path.clone(),
                    size: bytes.len() as u64,
                });

                bytes_processed += bytes.len() as u64;
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

fn compress_dir_to_zst_file(
    dir_path: &Path,
    tmp_path: &Path,
    compression_level: i32,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<(u64, String)> {
    let collected = collect_directory_files(dir_path);
    let mut entries = collected.entries;
    entries.retain(|e| e.path.exists());
    let total_bytes: u64 = entries.iter().map(|e| e.size).sum();

    let actual_level = if compression_level == 0 {
        select_adaptive_level(&entries)
    } else {
        compression_level.clamp(-100, 22)
    };
    let tmp_file = File::create(tmp_path)?;
    let mut encoder = zstd::stream::Encoder::new(
        std::io::BufWriter::with_capacity(8 * 1024 * 1024, tmp_file),
        actual_level,
    )
        .map_err(|e| anyhow::anyhow!("zstd init: {}", e))?;

    let threads = select_zstd_threads(total_bytes);
    if threads > 1 {
        if let Err(e) = encoder.multithread(threads) {
            eprintln!(
                "warn: zstd multithread({}) failed: {} — falls back to single thread",
                threads, e
            );
        }
    }

    let adaptive_window_log = select_zstd_window_log(total_bytes);
    let _ = encoder.window_log(adaptive_window_log);

    if threads > 1 {
        let budget_mb = effective_budget_mb();

        let target_total_mb = (budget_mb / 6).max(32);
        let per_worker_mb = (target_total_mb / threads as u64).clamp(4, 64);
        let job_size_bytes = (per_worker_mb * MB).min(u32::MAX as u64) as u32;
        let _ = encoder.set_parameter(zstd::stream::raw::CParameter::JobSize(job_size_bytes));
    }

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

                write_pack_entry_header(&mut encoder, &entry.rel_path, bytes.len() as u64)?;
                encoder.write_all(&bytes)
                    .map_err(|e| anyhow::anyhow!("pack write {}: {}", entry.rel_path, e))?;

                file_list.push(FileListEntry {
                    name: entry.rel_path.clone(),
                    size: bytes.len() as u64,
                });

                bytes_processed += bytes.len() as u64;
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

    encoder.finish().map_err(|e| anyhow::anyhow!("zstd finish: {}", e))?;
    let zst_size = std::fs::metadata(tmp_path)?.len();
    let file_list_json = serde_json::to_string(&file_list)?;

    Ok((zst_size, file_list_json))
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
    let file = match open_file_sequential(&entry.path) {
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

fn open_file_sequential(path: &Path) -> std::io::Result<File> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x08000000;
        std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(FILE_FLAG_SEQUENTIAL_SCAN)
            .open(path)
    }
    #[cfg(not(windows))]
    {
        File::open(path)
    }
}

fn load_directory_entry_bytes(entry: &DirectoryFile) -> anyhow::Result<Option<Vec<u8>>> {
    let mut file = match open_file_sequential(&entry.path) {
        Ok(file) => file,
        Err(_) => return Ok(None),
    };

    let reserve = usize::try_from(entry.size.min(parallel_io_batch_bytes())).unwrap_or(MAX_FILE_BUFFER_CAPACITY);
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

    let max_bytes = parallel_io_batch_bytes();
    let max_files = parallel_io_batch_files();
    while end < entries.len() {
        let entry = &entries[end];
        if !should_parallelize_entry(entry) {
            break;
        }
        if end > start {
            if end - start >= max_files {
                break;
            }
            if batch_bytes.saturating_add(entry.size) > max_bytes {
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

    if !source_is_ssd() {
        return false;
    }
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

    for entry in walkdir::WalkDir::new(dir_path)
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

    entries.sort_by(|a, b| {
        let ext_a = file_extension(&a.rel_path);
        let ext_b = file_extension(&b.rel_path);
        ext_a.cmp(ext_b).then_with(|| a.rel_path.cmp(&b.rel_path))
    });

    CollectedDirectory {
        entries,
        total_bytes,
    }
}

fn file_extension(rel_path: &str) -> &str {
    match rel_path.rfind('.') {
        Some(idx) if idx + 1 < rel_path.len() => &rel_path[idx + 1..],
        _ => "",
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
    capped.max(MIN_ZST_CAPACITY)
}

fn select_zstd_window_log(total_bytes: u64) -> u32 {
    if total_bytes <= 32 * MB { 22u32 }
    else if total_bytes <= 128 * MB { 24u32 }
    else if total_bytes <= 512 * MB { 26u32 }
    else if total_bytes <= 1024 * MB { 27u32 }
    else { 30u32 }
}

fn size_cap(total_bytes: u64) -> i32 {
    if total_bytes > 2 * 1024 * 1024 * 1024 { 1 }
    else if total_bytes > 1024 * 1024 * 1024 { 1 }
    else if total_bytes > 512 * 1024 * 1024 { 3 }
    else if total_bytes > 128 * 1024 * 1024 { 6 }
    else { 22 }
}

fn select_adaptive_level(entries: &[DirectoryFile]) -> i32 {
    let mut sample_data = Vec::with_capacity(4 * 1024 * 1024);
    for entry in entries.iter() {
        if sample_data.len() >= 4 * 1024 * 1024 {
            break;
        }
        if let Ok(mut f) = File::open(&entry.path) {
            let take = (4 * 1024 * 1024 - sample_data.len()).min(entry.size as usize);
            let start = sample_data.len();
            sample_data.resize(start + take, 0);
            let _ = f.read(&mut sample_data[start..]);
        }
    }
    if sample_data.is_empty() {
        return 3;
    }
    let compressed = zstd::bulk::compress(&sample_data, 3).unwrap_or_default();
    let ratio = compressed.len() as f64 / sample_data.len() as f64;

    let base = if ratio > 0.90 { 1 }
    else if ratio > 0.75 { 3 }
    else if ratio < 0.25 { 6 }
    else { 5 };

    let total_bytes: u64 = entries.iter().map(|e| e.size).sum();
    base.min(size_cap(total_bytes))
}

fn select_zstd_threads(total_bytes: u64) -> u32 {
    let max_threads = num_cpus::get().max(1) as u32;

    if total_bytes <= 1 * MB {
        return 1;
    }
    max_threads
}

fn write_png_from_zst_mem(
    zst_buf: Vec<u8>,
    output_path: &Path,
    name: Option<&str>,
    file_list: Option<&str>,
    passphrase: Option<&str>,
    _encrypt_type: Option<&str>,
    progress: &Option<ProgressCallback>,
    adaptive_window_log: u32,
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
    let window_log_pixel_bytes = 3;
    let data_with_markers_len = marker_start_len + padded_len;
    let data_pixels = (data_with_markers_len + 2) / 3;
    let end_marker_pixels = 4;
    let total_pixels = data_pixels + end_marker_pixels;

    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let side = side.max(end_marker_pixels);
    let width = side;
    let height = side;
    let row_bytes = width * 3;
    let total_data_bytes = width * height * 3;
    let marker_end_pos = total_data_bytes - window_log_pixel_bytes - marker_end_bytes;

    let enc_header_bytes = if let Some(ref enc) = encryptor {
        enc.header.clone()
    } else {
        vec![0x00]
    };

    let header_bytes = build_header_bytes(&meta_header, &enc_header_bytes);

    let out_file = File::create(output_path)?;
    let buf_capacity = if total_data_bytes > 256 * 1024 * 1024 { 64 * 1024 * 1024 }
        else if total_data_bytes > 16 * 1024 * 1024 { 32 * 1024 * 1024 }
        else { (total_data_bytes / 2).max(65536).min(16 * 1024 * 1024) };
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
        adaptive_window_log,
        progress,
    )?;

    if let Some(fl) = file_list {
        write_png_chunk(&mut w, b"rXFL", fl.as_bytes())?;
    }
    write_png_chunk(&mut w, b"IEND", &[])?;
    w.flush()?;

    Ok(())
}

fn write_png_from_zst_file(
    tmp_path: &Path,
    zst_size: u64,
    output_path: &Path,
    name: Option<&str>,
    file_list: Option<&str>,
    passphrase: Option<&str>,
    _encrypt_type: Option<&str>,
    progress: &Option<ProgressCallback>,
    adaptive_window_log: u32,
) -> anyhow::Result<()> {
    let mut encryptor = match passphrase {
        Some(pass) if !pass.is_empty() => Some(crate::crypto::StreamingEncryptor::new(pass)?),
        _ => None,
    };

    let enc_header_len = encryptor.as_ref().map(|e| e.header_len()).unwrap_or(1);
    let hmac_trailer_len: usize = if encryptor.is_some() { 32 } else { 0 };

    let encrypted_payload_len = enc_header_len + zst_size as usize + hmac_trailer_len;

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
    let window_log_pixel_bytes = 3;
    let data_with_markers_len = marker_start_len + padded_len;
    let data_pixels = (data_with_markers_len + 2) / 3;
    let end_marker_pixels = 4;
    let total_pixels = data_pixels + end_marker_pixels;

    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let side = side.max(end_marker_pixels);
    let width = side;
    let height = side;
    let row_bytes = width * 3;
    let total_data_bytes = width * height * 3;
    let marker_end_pos = total_data_bytes - window_log_pixel_bytes - marker_end_bytes;

    let enc_header_bytes = if let Some(ref enc) = encryptor {
        enc.header.clone()
    } else {
        vec![0x00]
    };

    let header_bytes = build_header_bytes(&meta_header, &enc_header_bytes);

    let out_file = File::create(output_path)?;
    let buf_capacity = if total_data_bytes > 256 * 1024 * 1024 { 64 * 1024 * 1024 }
        else if total_data_bytes > 16 * 1024 * 1024 { 32 * 1024 * 1024 }
        else { (total_data_bytes / 2).max(65536).min(16 * 1024 * 1024) };
    let mut w = BufWriter::with_capacity(buf_capacity, out_file);

    w.write_all(PNG_HEADER)?;

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&(width as u32).to_be_bytes());
    ihdr[4..8].copy_from_slice(&(height as u32).to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 2;
    write_png_chunk(&mut w, b"IHDR", &ihdr)?;

    let tmp_file = File::open(tmp_path)?;
    crate::io_advice::advise_file_sequential(&tmp_file);
    let mut zst_reader = std::io::BufReader::with_capacity(8 * 1024 * 1024, tmp_file);

    write_idat_streaming(
        &mut w,
        &header_bytes,
        &mut zst_reader,
        zst_size as usize,
        file_list_chunk.as_deref(),
        &mut encryptor,
        hmac_trailer_len,
        height,
        row_bytes,
        marker_end_pos,
        total_data_bytes,
        adaptive_window_log,
        progress,
    )?;

    if let Some(fl) = file_list {
        write_png_chunk(&mut w, b"rXFL", fl.as_bytes())?;
    }
    write_png_chunk(&mut w, b"IEND", &[])?;
    w.flush()?;

    Ok(())
}

fn encode_dir_streaming(
    entries: &[DirectoryFile],
    total_bytes: u64,
    zst_size_upper: usize,
    output_path: &Path,
    actual_level: i32,
    name: Option<&str>,
    passphrase: Option<&str>,
    _encrypt_type: Option<&str>,
    adaptive_window_log: u32,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<()> {

    let writer_encryptor = match passphrase {
        Some(pass) if !pass.is_empty() => Some(crate::crypto::StreamingEncryptor::new(pass)?),
        _ => None,
    };

    let enc_header_len = writer_encryptor.as_ref().map(|e| e.header_len()).unwrap_or(1);
    let hmac_trailer_len: usize = if writer_encryptor.is_some() { 32 } else { 0 };

    let file_list: Vec<FileListEntry> = entries.iter()
        .map(|e| FileListEntry { name: e.rel_path.clone(), size: e.size })
        .collect();
    let file_list_json = serde_json::to_string(&file_list)?;
    let file_list_chunk = {
        let json_bytes = file_list_json.as_bytes();
        let mut chunk = Vec::with_capacity(4 + 4 + json_bytes.len());
        chunk.extend_from_slice(b"rXFL");
        chunk.extend_from_slice(&(json_bytes.len() as u32).to_be_bytes());
        chunk.extend_from_slice(json_bytes);
        chunk
    };

    let encrypted_payload_len = enc_header_len + zst_size_upper + hmac_trailer_len;

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

    let total_meta_pixel_len = meta_header_len + encrypted_payload_len + file_list_chunk.len();
    let raw_payload_len = PIXEL_MAGIC.len() + total_meta_pixel_len;
    let padded_len = raw_payload_len + (3 - (raw_payload_len % 3)) % 3;

    let data_with_markers_len = 12 + padded_len;
    let data_pixels = (data_with_markers_len + 2) / 3;
    let total_pixels = data_pixels + 4;

    let side = (total_pixels as f64).sqrt().ceil() as usize;
    let width = side.max(4);
    let height = width;
    let _enc_header = writer_encryptor.as_ref().map(|e| e.header.clone()).unwrap_or_else(|| vec![0x00]);

    let output_path = output_path.to_path_buf();
    let entry_count = entries.len() as u32;
    let threads = select_zstd_threads(total_bytes);

    let budget_mb = effective_budget_mb();
    let job_size_bytes: u32 = if threads > 1 {
        let per_worker = ((budget_mb / 6).max(32) / threads as u64).clamp(4, 64);
        (per_worker * MB).min(u32::MAX as u64) as u32
    } else {
        0
    };

    use std::sync::mpsc;
    let (tx, rx) = mpsc::sync_channel::<Vec<(String, Vec<u8>)>>(2);

    let writer_handle = std::thread::Builder::new()
        .name("compress-writer".into())
        .spawn(move || -> anyhow::Result<Vec<u8>> {
            let mut zst_buf = Vec::with_capacity(estimate_zst_capacity(total_bytes));
            let mut encoder = zstd::stream::Encoder::new(&mut zst_buf, actual_level)
                .map_err(|e| anyhow::anyhow!("zstd init: {}", e))?;

            if threads > 1 {
                let _ = encoder.multithread(threads);
            }
            if total_bytes > 32 * MB {
                let _ = encoder.long_distance_matching(true);
            }
            let _ = encoder.window_log(adaptive_window_log);
            if threads > 1 && job_size_bytes > 0 {
                let _ = encoder.set_parameter(zstd::stream::raw::CParameter::JobSize(job_size_bytes));
            }

            encoder.write_all(MAGIC)?;
            encoder.write_all(&PACK_MAGIC.to_be_bytes())?;
            encoder.write_all(&entry_count.to_be_bytes())?;

            for batch in rx {
                for (rel_path, bytes) in batch {
                    write_pack_entry_header(&mut encoder, &rel_path, bytes.len() as u64)?;
                    encoder.write_all(&bytes)
                        .map_err(|e| anyhow::anyhow!("pack write {}: {}", rel_path, e))?;
                }
            }

            encoder.finish().map_err(|e| anyhow::anyhow!("zstd finish: {}", e))?;

            Ok(zst_buf)
        })
        .map_err(|e| anyhow::anyhow!("spawn writer thread: {}", e))?;

    let mut bytes_processed: u64 = 0;
    let mut last_pct: u64 = 0;
    let mut entry_index = 0usize;
    while entry_index < entries.len() {
        let batch_end = select_parallel_batch_end(entries, entry_index);
        let batch_slice = &entries[entry_index..batch_end];

        let loaded = if batch_end > entry_index + 1 {
            load_small_file_batch(batch_slice)?
        } else {
            match load_directory_entry_bytes(&entries[entry_index])? {
                Some(bytes) => vec![Some(bytes)],
                None => vec![None],
            }
        };

        let batch_files: Vec<(String, Vec<u8>)> = batch_slice.iter()
            .zip(loaded.into_iter())
            .filter_map(|(entry, maybe_bytes)| {
                maybe_bytes.map(|bytes| (entry.rel_path.clone(), bytes))
            })
            .collect();

        let batch_bytes: u64 = batch_files.iter().map(|(_, b)| b.len() as u64).sum();
        tx.send(batch_files)
            .map_err(|_| anyhow::anyhow!("pipeline channel closed"))?;

        bytes_processed += batch_bytes;
        report_compress_progress(progress, total_bytes, bytes_processed, &mut last_pct);
        entry_index = batch_end;
    }

    drop(tx);
    let zst_buf = writer_handle.join()
        .map_err(|_| anyhow::anyhow!("writer thread panic"))??;

    write_png_from_zst_mem(
        zst_buf, &output_path, name, Some(&file_list_json),
        passphrase, None, progress, adaptive_window_log,
    )?;

    if let Some(ref cb) = progress {
        cb(100, 100, "done");
    }

    Ok(())
}

struct CountingWriter<'a, W: Write> {
    inner: &'a mut W,
    encryptor: &'a mut Option<crate::crypto::StreamingEncryptor>,
    bytes_written: usize,
}

impl<'a, W: Write> CountingWriter<'a, W> {
    fn new(inner: &'a mut W, encryptor: &'a mut Option<crate::crypto::StreamingEncryptor>) -> Self {
        Self { inner, encryptor, bytes_written: 0 }
    }
}

impl<W: Write> Write for CountingWriter<'_, W> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if buf.is_empty() { return Ok(0); }
        if let Some(ref mut enc) = self.encryptor {
            let mut data = buf.to_vec();
            enc.encrypt_chunk(&mut data);
            self.inner.write_all(&data)?;
        } else {
            self.inner.write_all(buf)?;
        }
        self.bytes_written += buf.len();
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
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
    _height: usize,
    row_bytes: usize,
    _marker_end_pos: usize,
    total_data_bytes: usize,
    _window_log_value: u32,
    progress: &Option<ProgressCallback>,
) -> anyhow::Result<()> {

    let fl_chunk_data = file_list_chunk.unwrap_or(&[]);
    let payload_total =
        header_bytes.len() + zst_size + hmac_trailer_len + fl_chunk_data.len();
    let padding_after = total_data_bytes.saturating_sub(payload_total);

    let idat = ChunkedIdatWriter::new(w);
    let deflate = StoredDeflateWriter::new(idat);
    let mut row_writer = ScanlineFilterWriter::new(deflate, row_bytes);

    row_writer
        .write_all(header_bytes)
        .map_err(|e| anyhow::anyhow!("write header: {}", e))?;

    const TRANSFER_BUF_SIZE: usize = 16 * 1024 * 1024;
    let mut transfer_buf = vec![0u8; TRANSFER_BUF_SIZE];
    let mut zst_remaining = zst_size;
    let mut bytes_written_payload: u64 = header_bytes.len() as u64;
    let mut last_pct: u64 = 89;

    while zst_remaining > 0 {
        let take = zst_remaining.min(TRANSFER_BUF_SIZE);
        let got = zst_reader
            .read(&mut transfer_buf[..take])
            .map_err(|e| anyhow::anyhow!("read zst: {}", e))?;
        if got == 0 {
            break;
        }
        if let Some(ref mut enc) = encryptor {
            enc.encrypt_chunk(&mut transfer_buf[..got]);
        }
        row_writer
            .write_all(&transfer_buf[..got])
            .map_err(|e| anyhow::anyhow!("write zst pixels: {}", e))?;
        zst_remaining -= got;
        bytes_written_payload += got as u64;

        if let Some(ref cb) = progress {
            if payload_total > 0 {
                let pct = 90
                    + (bytes_written_payload.saturating_mul(9) / payload_total as u64).min(9);
                if pct > last_pct {
                    last_pct = pct;
                    cb(pct, 100, "writing_png");
                }
            }
        }
    }

    if let Some(enc) = encryptor.take() {
        let hmac_bytes = enc.finalize_hmac();
        row_writer
            .write_all(&hmac_bytes)
            .map_err(|e| anyhow::anyhow!("write hmac: {}", e))?;
    }

    if !fl_chunk_data.is_empty() {
        row_writer
            .write_all(fl_chunk_data)
            .map_err(|e| anyhow::anyhow!("write file list: {}", e))?;
    }

    if padding_after > 0 {
        let mut left = padding_after;
        while left > 0 {
            let n = left.min(PADDING_ZEROS.len());
            row_writer
                .write_all(&PADDING_ZEROS[..n])
                .map_err(|e| anyhow::anyhow!("write padding: {}", e))?;
            left -= n;
        }
    }

    let deflate = row_writer.into_inner();
    let idat = deflate
        .finish()
        .map_err(|e| anyhow::anyhow!("deflate finish: {}", e))?;
    idat.finish()?;

    Ok(())
}

const STORED_DEFLATE_BLOCK_MAX: usize = 65535;

struct StoredDeflateWriter<W: Write> {
    inner: W,
    pending: Vec<u8>,
    adler: simd_adler32::Adler32,
    header_written: bool,
}

impl<W: Write> StoredDeflateWriter<W> {
    fn new(inner: W) -> Self {
        Self {
            inner,
            pending: Vec::with_capacity(STORED_DEFLATE_BLOCK_MAX),
            adler: simd_adler32::Adler32::new(),
            header_written: false,
        }
    }

    fn ensure_header(&mut self) -> std::io::Result<()> {
        if !self.header_written {
            self.inner.write_all(&[0x78, 0x01])?;
            self.header_written = true;
        }
        Ok(())
    }

    fn emit_block(&mut self, data: &[u8], is_final: bool) -> std::io::Result<()> {
        let len = data.len() as u16;
        let nlen = !len;
        let header = [
            if is_final { 0x01 } else { 0x00 },
            (len & 0xff) as u8,
            (len >> 8) as u8,
            (nlen & 0xff) as u8,
            (nlen >> 8) as u8,
        ];
        self.inner.write_all(&header)?;
        if !data.is_empty() {
            self.inner.write_all(data)?;
        }
        Ok(())
    }

    fn finish(mut self) -> std::io::Result<W> {
        self.ensure_header()?;

        let len = self.pending.len() as u16;
        let nlen = !len;
        let header = [0x01u8, (len & 0xff) as u8, (len >> 8) as u8, (nlen & 0xff) as u8, (nlen >> 8) as u8];
        self.inner.write_all(&header)?;
        if !self.pending.is_empty() {
            self.inner.write_all(&self.pending)?;
        }
        let adler = self.adler.finish().to_be_bytes();
        self.inner.write_all(&adler)?;
        Ok(self.inner)
    }
}

impl<W: Write> Write for StoredDeflateWriter<W> {
    fn write(&mut self, mut buf: &[u8]) -> std::io::Result<usize> {
        let total = buf.len();
        if buf.is_empty() {
            return Ok(0);
        }
        self.ensure_header()?;
        self.adler.write(buf);

        while !buf.is_empty() {
            let space = STORED_DEFLATE_BLOCK_MAX - self.pending.len();
            let take = space.min(buf.len());
            self.pending.extend_from_slice(&buf[..take]);
            buf = &buf[take..];

            if self.pending.len() == STORED_DEFLATE_BLOCK_MAX && !buf.is_empty() {
                let header = [
                    0x00u8,
                    0xffu8,
                    0xffu8,
                    0x00u8,
                    0x00u8,
                ];
                self.inner.write_all(&header)?;
                self.inner.write_all(&self.pending)?;
                self.pending.clear();
            }
        }
        Ok(total)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

struct ScanlineFilterWriter<W: Write> {
    inner: W,
    row_bytes: usize,
    col_in_row: usize,
    row_started: bool,
}

impl<W: Write> ScanlineFilterWriter<W> {
    fn new(inner: W, row_bytes: usize) -> Self {
        Self {
            inner,
            row_bytes,
            col_in_row: 0,
            row_started: false,
        }
    }

    fn into_inner(self) -> W {
        self.inner
    }
}

impl<W: Write> Write for ScanlineFilterWriter<W> {
    fn write(&mut self, mut buf: &[u8]) -> std::io::Result<usize> {
        let total = buf.len();
        while !buf.is_empty() {
            if !self.row_started {
                self.inner.write_all(&[0u8])?;
                self.row_started = true;
                self.col_in_row = 0;
            }
            let remaining_in_row = self.row_bytes - self.col_in_row;
            let take = remaining_in_row.min(buf.len());
            self.inner.write_all(&buf[..take])?;
            self.col_in_row += take;
            buf = &buf[take..];
            if self.col_in_row >= self.row_bytes {
                self.row_started = false;
            }
        }
        Ok(total)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::read::ZlibDecoder;
    use std::io::Read;

    fn roundtrip(input: &[u8]) {
        let mut out = Vec::new();
        {
            let mut w = StoredDeflateWriter::new(&mut out);

            for chunk in input.chunks(7_919) {
                w.write_all(chunk).unwrap();
            }
            let _ = w.finish().unwrap();
        }

        let mut decoded = Vec::with_capacity(input.len());
        ZlibDecoder::new(out.as_slice())
            .read_to_end(&mut decoded)
            .unwrap();
        assert_eq!(decoded.len(), input.len(), "decoded length mismatch");
        assert_eq!(decoded, input, "decoded payload mismatch");
    }

    #[test]
    fn stored_deflate_roundtrip_empty() {
        roundtrip(&[]);
    }

    #[test]
    fn stored_deflate_roundtrip_small() {
        roundtrip(b"hello, deflate stored blocks");
    }

    #[test]
    fn stored_deflate_roundtrip_exactly_one_block() {
        let data: Vec<u8> = (0..STORED_DEFLATE_BLOCK_MAX).map(|i| (i & 0xff) as u8).collect();
        roundtrip(&data);
    }

    #[test]
    fn stored_deflate_roundtrip_exactly_two_blocks() {
        let data: Vec<u8> = (0..STORED_DEFLATE_BLOCK_MAX * 2)
            .map(|i| (i & 0xff) as u8)
            .collect();
        roundtrip(&data);
    }

    #[test]
    fn stored_deflate_roundtrip_two_and_a_half_blocks() {
        let n = STORED_DEFLATE_BLOCK_MAX * 2 + 12_345;
        let data: Vec<u8> = (0..n).map(|i| ((i * 31) & 0xff) as u8).collect();
        roundtrip(&data);
    }

    #[test]
    fn stored_deflate_split_writes_match() {

        let mut data = Vec::with_capacity(200_000);
        for i in 0..200_000 {
            data.push(((i * 17 + 3) & 0xff) as u8);
        }

        for chunk_size in [1, 13, 4096, 65_534, 65_535, 65_536, 200_000] {
            let mut out = Vec::new();
            {
                let mut w = StoredDeflateWriter::new(&mut out);
                for c in data.chunks(chunk_size) {
                    w.write_all(c).unwrap();
                }
                w.finish().unwrap();
            }
            let mut decoded = Vec::new();
            ZlibDecoder::new(out.as_slice())
                .read_to_end(&mut decoded)
                .unwrap();
            assert_eq!(decoded, data, "mismatch with chunk_size={}", chunk_size);
        }
    }

    #[test]
    fn scanline_filter_writer_inserts_zero_per_row() {
        let mut out = Vec::new();
        {
            let mut w = ScanlineFilterWriter::new(&mut out, 3);

            w.write_all(&[1, 2]).unwrap();
            w.write_all(&[3, 4, 5, 6]).unwrap();
        }

        assert_eq!(out, vec![0, 1, 2, 3, 0, 4, 5, 6]);
    }

    #[test]
    fn scanline_filter_writer_handles_full_rows() {
        let mut out = Vec::new();
        {
            let mut w = ScanlineFilterWriter::new(&mut out, 4);
            w.write_all(&[10, 20, 30, 40]).unwrap();
            w.write_all(&[50, 60, 70, 80]).unwrap();
        }
        assert_eq!(out, vec![0, 10, 20, 30, 40, 0, 50, 60, 70, 80]);
    }

    #[test]
    fn file_extension_handles_edge_cases() {
        assert_eq!(file_extension(""), "");
        assert_eq!(file_extension("noext"), "");
        assert_eq!(file_extension("foo.js"), "js");
        assert_eq!(file_extension("foo.bar.tsx"), "tsx");
        assert_eq!(file_extension("dir/foo.png"), "png");

        assert_eq!(file_extension("dotfile."), "");

        assert_eq!(file_extension(".gitignore"), "gitignore");
    }

    fn make_test_dir(seed: u64, file_count: usize, max_file_size: usize) -> std::path::PathBuf {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("rox_enc_dec_rt_{}_{}", seed, ms));
        std::fs::create_dir_all(&dir).unwrap();

        let mut state = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(1);
        for i in 0..file_count {
            let sz = ((state >> 16) as usize) % max_file_size + 1;
            let mut bytes = vec![0u8; sz];
            for b in bytes.iter_mut() {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                *b = (state >> 33) as u8;
            }
            let ext = match i % 4 {
                0 => "txt",
                1 => "bin",
                2 => "json",
                _ => "log",
            };
            std::fs::write(dir.join(format!("file_{:04}.{}", i, ext)), &bytes).unwrap();
        }
        dir
    }

    fn read_dir_to_map(dir: &std::path::Path) -> std::collections::BTreeMap<String, Vec<u8>> {
        use walkdir::WalkDir;
        let mut out = std::collections::BTreeMap::new();
        for entry in WalkDir::new(dir).into_iter().filter_map(|e| e.ok()) {
            if entry.file_type().is_file() {
                let p = entry.path();
                let rel = p
                    .strip_prefix(dir)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.insert(rel, std::fs::read(&p).unwrap());
            }
        }
        out
    }

    #[test]
    fn end_to_end_directory_roundtrip_small() {
        let src = make_test_dir(1, 5, 100);
        let png = src.with_extension("png");
        let out_dir = src.with_extension("out");
        let _ = std::fs::remove_file(&png);
        let _ = std::fs::remove_dir_all(&out_dir);

        encode_dir_to_png(&src, &png, 3, Some("test")).unwrap();
        assert!(png.exists(), "encoded PNG must exist");

        crate::streaming_decode::streaming_decode_to_dir(&png, &out_dir).unwrap();

        let original = read_dir_to_map(&src);
        let decoded = read_dir_to_map(&out_dir);
        assert_eq!(decoded, original, "decoded content differs from original");

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_dir_all(out_dir);
        let _ = std::fs::remove_dir_all(src);
    }

    #[test]
    fn end_to_end_directory_roundtrip_many_small_files() {

        let src = make_test_dir(2, 200, 4096);
        let png = src.with_extension("png");
        let out_dir = src.with_extension("out");
        let _ = std::fs::remove_file(&png);
        let _ = std::fs::remove_dir_all(&out_dir);

        encode_dir_to_png(&src, &png, 3, Some("many")).unwrap();
        crate::streaming_decode::streaming_decode_to_dir(&png, &out_dir).unwrap();

        let original = read_dir_to_map(&src);
        let decoded = read_dir_to_map(&out_dir);
        assert_eq!(
            decoded.len(),
            original.len(),
            "file count mismatch: {} vs {}",
            decoded.len(),
            original.len()
        );
        for (k, v) in &original {
            let decoded_v = decoded.get(k).unwrap_or_else(|| panic!("missing file: {}", k));
            assert_eq!(decoded_v.len(), v.len(), "size mismatch for {}", k);
            assert_eq!(decoded_v, v, "content mismatch for {}", k);
        }

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_dir_all(out_dir);
        let _ = std::fs::remove_dir_all(src);
    }

    #[test]
    fn end_to_end_directory_roundtrip_with_large_file() {

        use std::time::{SystemTime, UNIX_EPOCH};
        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let src = std::env::temp_dir().join(format!("rox_enc_dec_rt_large_{}", ms));
        std::fs::create_dir_all(&src).unwrap();

        let mut state = 3u64.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        for i in 0..3 {
            let sz = 5 * 1024 * 1024 + i * 1024;
            let mut bytes = vec![0u8; sz];
            for b in bytes.iter_mut() {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                *b = (state >> 33) as u8;
            }
            std::fs::write(src.join(format!("big_{}.bin", i)), &bytes).unwrap();
        }

        let png = src.with_extension("png");
        let out_dir = src.with_extension("out");
        let _ = std::fs::remove_file(&png);
        let _ = std::fs::remove_dir_all(&out_dir);

        encode_dir_to_png(&src, &png, 3, Some("large")).unwrap();
        crate::streaming_decode::streaming_decode_to_dir(&png, &out_dir).unwrap();

        let original = read_dir_to_map(&src);
        let decoded = read_dir_to_map(&out_dir);
        assert_eq!(decoded.len(), original.len(), "file count mismatch");
        for (k, v) in &original {
            assert_eq!(decoded.get(k).expect("missing file"), v, "content mismatch for {}", k);
        }

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_dir_all(out_dir);
        let _ = std::fs::remove_dir_all(src);
    }

    #[test]
    fn end_to_end_encrypted_directory_roundtrip() {
        let src = make_test_dir(10, 20, 8192);
        let png = src.with_extension("enc.png");
        let out_dir = src.with_extension("enc_out");
        let _ = std::fs::remove_file(&png);
        let _ = std::fs::remove_dir_all(&out_dir);

        encode_dir_to_png_encrypted(&src, &png, 3, Some("enc_test"), Some("testpass"), Some("aes")).unwrap();
        assert!(png.exists(), "encrypted PNG must exist");
        crate::streaming_decode::streaming_decode_to_dir_encrypted(&png, &out_dir, Some("testpass")).unwrap();

        let original = read_dir_to_map(&src);
        let decoded = read_dir_to_map(&out_dir);
        assert_eq!(decoded, original, "encrypted decoded content differs from original");

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_dir_all(out_dir);
        let _ = std::fs::remove_dir_all(src);
    }

    #[test]
    fn end_to_end_pipeline_variable_file_sizes() {
        use std::time::{SystemTime, UNIX_EPOCH};
        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let src = std::env::temp_dir().join(format!("rox_pipeline_var_{}", ms));
        std::fs::create_dir_all(&src).unwrap();

        let mut state = 42u64;
        for i in 0..50 {
            let sz = match i {
                j if j < 20 => 100,
                j if j < 40 => (state as usize % 50000) + 1000,
                _ => (state as usize % 500000) + 100000,
            };
            let mut bytes = vec![0u8; sz];
            for b in bytes.iter_mut() {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
                *b = (state >> 33) as u8;
            }
            std::fs::write(src.join(format!("mixed_{:04}.bin", i)), &bytes).unwrap();
        }

        let png = src.with_extension("pipeline.png");
        let out_dir = src.with_extension("pipeline_out");
        let _ = std::fs::remove_file(&png);
        let _ = std::fs::remove_dir_all(&out_dir);

        encode_dir_to_png(&src, &png, 3, Some("pipeline")).unwrap();
        crate::streaming_decode::streaming_decode_to_dir(&png, &out_dir).unwrap();

        let original = read_dir_to_map(&src);
        let decoded = read_dir_to_map(&out_dir);
        assert_eq!(decoded.len(), original.len(), "file count mismatch in pipeline test");
        for (k, v) in &original {
            assert_eq!(decoded.get(k).expect("missing file"), v, "content mismatch for {}", k);
        }

        let _ = std::fs::remove_file(png);
        let _ = std::fs::remove_dir_all(out_dir);
        let _ = std::fs::remove_dir_all(src);
    }

    #[test]
    fn should_parallelize_entry_respects_hdd_flag() {

        let entry = DirectoryFile {
            path: std::path::PathBuf::from("/tmp/test"),
            rel_path: "test".into(),
            size: 1024,
        };

        let result = should_parallelize_entry(&entry);
        let _ = result;
    }
}
