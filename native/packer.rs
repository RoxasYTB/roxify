use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use rayon::prelude::*;
use serde_json::json;

pub struct PackResult {
    pub data: Vec<u8>,
    pub file_list_json: Option<String>,
}

pub fn pack_directory(dir_path: &Path, base_dir: Option<&Path>) -> Result<Vec<u8>> {
    let base = base_dir.unwrap_or(dir_path);

    let files: Vec<PathBuf> = WalkDir::new(dir_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .map(|e| e.path().to_path_buf())
        .collect();

    let file_data: Vec<(String, Vec<u8>)> = files
        .par_iter()
        .filter_map(|file_path| {
            let rel_path = file_path.strip_prefix(base)
                .unwrap_or(file_path.as_path())
                .to_string_lossy()
                .replace('\\', "/");

            match fs::read(file_path) {
                Ok(content) => Some((rel_path, content)),
                Err(e) => {
                    eprintln!("⚠️  Erreur lecture {}: {}", rel_path, e);
                    None
                }
            }
        })
        .collect();


    let total_size: usize = file_data.par_iter().map(|(path, content)| path.len() + content.len() + 10).sum();
    let mut result = Vec::with_capacity(8 + total_size);

    result.extend_from_slice(&0x524f5850u32.to_be_bytes());
    result.extend_from_slice(&(file_data.len() as u32).to_be_bytes());

    for (rel_path, content) in file_data {
        let name_bytes = rel_path.as_bytes();
        let name_len = (name_bytes.len() as u16).to_be_bytes();
        let size = (content.len() as u64).to_be_bytes();

        result.extend_from_slice(&name_len);
        result.extend_from_slice(name_bytes);
        result.extend_from_slice(&size);
        result.extend_from_slice(&content);
    }

    Ok(result)
}

pub fn pack_path(path: &Path) -> Result<Vec<u8>> {
    if path.is_file() {
        fs::read(path).map_err(Into::into)
    } else if path.is_dir() {
        pack_directory(path, Some(path))
    } else {
        Err(anyhow::anyhow!("Path is neither file nor directory"))
    }
}

pub fn pack_path_with_metadata(path: &Path) -> Result<PackResult> {
    if path.is_file() {
        let data = fs::read(path)?;
        let size = data.len();
        let name = path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("file");

        let file_list = json!([{"name": name, "size": size}]);
        Ok(PackResult {
            data,
            file_list_json: Some(file_list.to_string()),
        })
    } else if path.is_dir() {
        let base = path;
        let files: Vec<PathBuf> = WalkDir::new(path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.path().to_path_buf())
            .collect();

        let file_data: Vec<(String, Vec<u8>)> = files
            .par_iter()
            .filter_map(|file_path| {
                let rel_path = file_path.strip_prefix(base)
                    .unwrap_or(file_path.as_path())
                    .to_string_lossy()
                    .replace('\\', "/");

                match fs::read(file_path) {
                    Ok(content) => Some((rel_path, content)),
                    Err(e) => {
                        eprintln!("⚠️  Erreur lecture {}: {}", rel_path, e);
                        None
                    }
                }
            })
            .collect();

        let file_list: Vec<_> = file_data.iter()
            .map(|(name, content)| json!({"name": name, "size": content.len()}))
            .collect();

        let total_size: usize = file_data.par_iter()
            .map(|(path, content)| path.len() + content.len() + 10)
            .sum();

        let mut result = Vec::with_capacity(8 + total_size);
        result.extend_from_slice(&0x524f5850u32.to_be_bytes());
        result.extend_from_slice(&(file_data.len() as u32).to_be_bytes());

        for (rel_path, content) in file_data {
            let name_bytes = rel_path.as_bytes();
            let name_len = (name_bytes.len() as u16).to_be_bytes();
            let size = (content.len() as u64).to_be_bytes();

            result.extend_from_slice(&name_len);
            result.extend_from_slice(name_bytes);
            result.extend_from_slice(&size);
            result.extend_from_slice(&content);
        }

        Ok(PackResult {
            data: result,
            file_list_json: Some(serde_json::to_string(&file_list)?),
        })

    } else {
        Err(anyhow::anyhow!("Path is neither file nor directory"))
    }
}

pub fn unpack_buffer_to_dir(buf: &[u8], out_dir: &Path, files_opt: Option<&[String]>) -> Result<Vec<String>> {

    use std::convert::TryInto;
    let mut written = Vec::new();
    let mut pos = 0usize;

    if buf.len() < 8 { return Err(anyhow::anyhow!("Buffer too small")); }
    let magic = u32::from_be_bytes(buf[0..4].try_into().unwrap());

    if magic == 0x524f5849u32 {
        let index_len = u32::from_be_bytes(buf[4..8].try_into().unwrap()) as usize;
        pos = 8 + index_len;
        return unpack_entries_sequential(buf, pos, out_dir, files_opt);
    }

    if magic != 0x524f5850u32 { return Err(anyhow::anyhow!("Invalid pack magic")); }
    pos += 4;
    let file_count = u32::from_be_bytes(buf[pos..pos+4].try_into().unwrap()) as usize; pos += 4;

    let files_filter: Option<std::collections::HashSet<String>> = files_opt.map(|l| l.iter().map(|s| s.clone()).collect());

    for _ in 0..file_count {
        if pos + 2 > buf.len() { return Err(anyhow::anyhow!("Truncated pack (name len)")); }
        let name_len = u16::from_be_bytes(buf[pos..pos+2].try_into().unwrap()) as usize; pos += 2;
        if pos + name_len > buf.len() { return Err(anyhow::anyhow!("Truncated pack (name)")); }
        let name = String::from_utf8_lossy(&buf[pos..pos+name_len]).to_string(); pos += name_len;
        if pos + 8 > buf.len() { return Err(anyhow::anyhow!("Truncated pack (size)")); }
        let size = u64::from_be_bytes(buf[pos..pos+8].try_into().unwrap()) as usize; pos += 8;
        if pos + size > buf.len() { return Err(anyhow::anyhow!("Truncated pack (content)")); }

        let should_write = match &files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            let content = &buf[pos..pos+size];
                        let p = Path::new(&name);
            let mut safe = std::path::PathBuf::new();
            for comp in p.components() {
                if let std::path::Component::Normal(osstr) = comp {
                    safe.push(osstr);
                }
            }
            let dest = out_dir.join(&safe);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
            }
            std::fs::write(&dest, content).map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
            written.push(safe.to_string_lossy().to_string());
        }

        pos += size;
    }

    Ok(written)
}

fn unpack_entries_sequential(buf: &[u8], start: usize, out_dir: &Path, files_opt: Option<&[String]>) -> Result<Vec<String>> {
    let mut written = Vec::new();
    let mut pos = start;
    let files_filter: Option<std::collections::HashSet<String>> = files_opt.map(|l| l.iter().map(|s| s.clone()).collect());

    while pos + 2 < buf.len() {
        let magic = u32::from_be_bytes(buf[pos..pos+4].try_into().unwrap_or([0;4]));
        if magic == 0x524f5849u32 {
            if pos + 8 > buf.len() { break; }
            let index_len = u32::from_be_bytes(buf[pos+4..pos+8].try_into().unwrap()) as usize;
            pos += 8 + index_len;
            continue;
        }

        if pos + 2 > buf.len() { break; }
        let name_len = u16::from_be_bytes(buf[pos..pos+2].try_into().unwrap()) as usize;
        pos += 2;
        if pos + name_len > buf.len() { break; }
        let name = String::from_utf8_lossy(&buf[pos..pos+name_len]).to_string();
        pos += name_len;
        if pos + 8 > buf.len() { break; }
        let size = u64::from_be_bytes(buf[pos..pos+8].try_into().unwrap()) as usize;
        pos += 8;
        if pos + size > buf.len() { break; }

        let should_write = match &files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            let content = &buf[pos..pos+size];
            let p = Path::new(&name);
            let mut safe = std::path::PathBuf::new();
            for comp in p.components() {
                if let std::path::Component::Normal(osstr) = comp {
                    safe.push(osstr);
                }
            }
            let dest = out_dir.join(&safe);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
            }
            std::fs::write(&dest, content).map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
            written.push(safe.to_string_lossy().to_string());
        }

        pos += size;
    }

    Ok(written)
}

fn unpack_progress_percent(total_expected: u64, bytes_processed: u64, file_count: usize, processed_files: usize) -> u64 {
    if total_expected > 0 {
        return 10 + (bytes_processed.saturating_mul(89) / total_expected).min(89);
    }
    if file_count > 0 {
        return 10 + ((processed_files as u64).saturating_mul(89) / file_count as u64).min(89);
    }
    10
}

fn report_unpack_progress(
    progress: Option<&(dyn Fn(u64, u64, &str) + Send)>,
    total_expected: u64,
    bytes_processed: u64,
    file_count: usize,
    processed_files: usize,
    last_pct: &mut u64,
) {
    if let Some(cb) = progress {
        let pct = unpack_progress_percent(total_expected, bytes_processed, file_count, processed_files);
        if pct > *last_pct {
            *last_pct = pct;
            cb(pct, 100, "extracting");
        }
    }
}

pub fn unpack_stream_to_dir<R: std::io::Read>(
    reader: &mut R,
    out_dir: &Path,
    files_opt: Option<&[String]>,
    progress: Option<&(dyn Fn(u64, u64, &str) + Send)>,
    total_expected: u64,
) -> Result<Vec<String>> {
    let mut written = Vec::new();
    let files_filter: Option<std::collections::HashSet<String>> = files_opt.map(|l| l.iter().map(|s| s.clone()).collect());
    let mut requested = files_filter.as_ref().map(|s| s.len()).unwrap_or(usize::MAX);
    let mut file_count = 0usize;
    let mut processed_files = 0usize;
    let mut bytes_processed = 0u64;
    let mut last_pct = 10u64;

    let mut magic = read_pack_u32(reader)?;
    if magic == 0x524f5831u32 {
        magic = read_pack_u32(reader)?;
    }
    if magic == 0x524f5849u32 {
        let index_len = read_pack_u32(reader)? as u64;
        discard_pack_bytes(reader, index_len, &mut bytes_processed, file_count, processed_files, total_expected, progress, &mut last_pct)?;
        magic = read_pack_u32(reader)?;
    }
    if magic != 0x524f5850u32 {
        return Err(anyhow::anyhow!("Invalid pack magic: 0x{:08x}", magic));
    }

    file_count = read_pack_u32(reader)? as usize;

    for _ in 0..file_count {
        let name_len = read_pack_u16(reader)? as usize;
        let mut name_bytes = vec![0u8; name_len];
        read_pack_exact(reader, &mut name_bytes)?;
        let name = String::from_utf8_lossy(&name_bytes).to_string();
        let size = read_pack_u64(reader)?;

        let should_write = match &files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            let safe = sanitize_pack_path(&name);
            let dest = out_dir.join(&safe);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
            }
            let file = std::fs::File::create(&dest).map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
            let mut writer = std::io::BufWriter::with_capacity(file_buffer_capacity(size), file);
            copy_pack_bytes(reader, &mut writer, size, &mut bytes_processed, file_count, processed_files, total_expected, progress, &mut last_pct)?;
            finalize_output_file(writer, size, &dest)?;
            written.push(safe.to_string_lossy().to_string());
            if files_filter.is_some() {
                requested = requested.saturating_sub(1);
            }
        } else {
            discard_pack_bytes(reader, size, &mut bytes_processed, file_count, processed_files, total_expected, progress, &mut last_pct)?;
        }

        processed_files = processed_files.saturating_add(1);
        report_unpack_progress(progress, total_expected, bytes_processed, file_count, processed_files, &mut last_pct);

        if requested == 0 {
            if let Some(cb) = progress {
                cb(99, 100, "finishing");
            }
            return Ok(written);
        }
    }

    if let Some(cb) = progress {
        cb(99, 100, "finishing");
    }

    Ok(written)
}

fn read_pack_exact<R: std::io::Read>(reader: &mut R, buf: &mut [u8]) -> Result<()> {
    reader.read_exact(buf).map_err(|e| anyhow::anyhow!("Stream read error: {}", e))
}

fn read_pack_u16<R: std::io::Read>(reader: &mut R) -> Result<u16> {
    let mut buf = [0u8; 2];
    read_pack_exact(reader, &mut buf)?;
    Ok(u16::from_be_bytes(buf))
}

fn read_pack_u32<R: std::io::Read>(reader: &mut R) -> Result<u32> {
    let mut buf = [0u8; 4];
    read_pack_exact(reader, &mut buf)?;
    Ok(u32::from_be_bytes(buf))
}

fn read_pack_u64<R: std::io::Read>(reader: &mut R) -> Result<u64> {
    let mut buf = [0u8; 8];
    read_pack_exact(reader, &mut buf)?;
    Ok(u64::from_be_bytes(buf))
}

fn sanitize_pack_path(name: &str) -> std::path::PathBuf {
    let p = Path::new(name);
    let mut safe = std::path::PathBuf::new();
    for comp in p.components() {
        if let std::path::Component::Normal(osstr) = comp {
            safe.push(osstr);
        }
    }
    safe
}

fn file_buffer_capacity(size: u64) -> usize {
    usize::try_from(size)
        .unwrap_or(4 * 1024 * 1024)
        .min(4 * 1024 * 1024)
        .max(8192)
}

fn finalize_output_file(
    mut writer: std::io::BufWriter<std::fs::File>,
    size: u64,
    dest: &Path,
) -> Result<()> {
    std::io::Write::flush(&mut writer).map_err(|e| anyhow::anyhow!("Cannot flush {:?}: {}", dest, e))?;
    let file = writer.into_inner().map_err(|e| anyhow::anyhow!("Cannot finalize {:?}: {}", dest, e.error()))?;
    crate::io_advice::sync_and_drop(&file, size);
    Ok(())
}

fn copy_pack_bytes<R: std::io::Read, W: std::io::Write>(
    reader: &mut R,
    writer: &mut W,
    mut remaining: u64,
    bytes_processed: &mut u64,
    file_count: usize,
    processed_files: usize,
    total_expected: u64,
    progress: Option<&(dyn Fn(u64, u64, &str) + Send)>,
    last_pct: &mut u64,
) -> Result<()> {
    let mut buf = vec![0u8; 1024 * 1024];
    while remaining > 0 {
        let take = remaining.min(buf.len() as u64) as usize;
        let read = reader.read(&mut buf[..take]).map_err(|e| anyhow::anyhow!("Stream read error: {}", e))?;
        if read == 0 {
            return Err(anyhow::anyhow!("Truncated pack content"));
        }
        writer.write_all(&buf[..read]).map_err(|e| anyhow::anyhow!("Stream write error: {}", e))?;
        remaining -= read as u64;
        *bytes_processed = bytes_processed.saturating_add(read as u64);
        report_unpack_progress(progress, total_expected, *bytes_processed, file_count, processed_files, last_pct);
    }
    Ok(())
}

fn discard_pack_bytes<R: std::io::Read>(
    reader: &mut R,
    mut remaining: u64,
    bytes_processed: &mut u64,
    file_count: usize,
    processed_files: usize,
    total_expected: u64,
    progress: Option<&(dyn Fn(u64, u64, &str) + Send)>,
    last_pct: &mut u64,
) -> Result<()> {
    let mut buf = vec![0u8; 1024 * 1024];
    while remaining > 0 {
        let take = remaining.min(buf.len() as u64) as usize;
        let read = reader.read(&mut buf[..take]).map_err(|e| anyhow::anyhow!("Stream read error: {}", e))?;
        if read == 0 {
            return Err(anyhow::anyhow!("Truncated pack content"));
        }
        remaining -= read as u64;
        *bytes_processed = bytes_processed.saturating_add(read as u64);
        report_unpack_progress(progress, total_expected, *bytes_processed, file_count, processed_files, last_pct);
    }
    Ok(())
}

#[cfg(test)]
mod stream_tests {
    use super::*;
    use std::io::{Write, Read};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct ChunkedReader<R> {
        inner: R,
        max_chunk: usize,
    }

    impl<R: Read> Read for ChunkedReader<R> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            let limit = buf.len().min(self.max_chunk);
            self.inner.read(&mut buf[..limit])
        }
    }

    #[test]
    fn test_unpack_stream_to_dir() -> Result<()> {
                let mut parts: Vec<u8> = Vec::new();
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());         parts.extend_from_slice(&(2u32.to_be_bytes()));
        let name1 = b"file1.txt";
        parts.extend_from_slice(&(name1.len() as u16).to_be_bytes());
        parts.extend_from_slice(name1);
        let content1 = b"hello world";
        parts.extend_from_slice(&(content1.len() as u64).to_be_bytes());
        parts.extend_from_slice(content1);

        let name2 = b"file2.txt";
        parts.extend_from_slice(&(name2.len() as u16).to_be_bytes());
        parts.extend_from_slice(name2);
        let content2 = b"goodbye";
        parts.extend_from_slice(&(content2.len() as u64).to_be_bytes());
        parts.extend_from_slice(content2);

                let mut encoder = zstd::stream::Encoder::new(Vec::new(), 0).map_err(|e| anyhow::anyhow!(e))?;
        encoder.write_all(&parts).map_err(|e| anyhow::anyhow!(e))?;
        let compressed = encoder.finish().map_err(|e| anyhow::anyhow!(e))?;

        let mut dec = zstd::stream::Decoder::new(std::io::Cursor::new(compressed.clone())).map_err(|e| anyhow::anyhow!(e))?;
        dec.window_log_max(31).map_err(|e| anyhow::anyhow!(e))?;

                let mut all = Vec::new();
        dec.read_to_end(&mut all).map_err(|e| anyhow::anyhow!(e))?;
        assert_eq!(all.len(), parts.len());
        assert_eq!(&all[..], &parts[..]);

                let mut dec2 = zstd::stream::Decoder::new(std::io::Cursor::new(compressed)).map_err(|e| anyhow::anyhow!(e))?;
        dec2.window_log_max(31).map_err(|e| anyhow::anyhow!(e))?;

                let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        let tmpdir = std::env::temp_dir().join(format!("rox_unpack_test_{}", ms));
        let _ = std::fs::create_dir_all(&tmpdir);

        let out = unpack_stream_to_dir(&mut dec2, &tmpdir, None, None, 0)?;

                assert_eq!(out.len(), 2);
        assert!(tmpdir.join("file1.txt").exists());
        assert!(tmpdir.join("file2.txt").exists());
                let _ = std::fs::remove_file(tmpdir.join("file1.txt"));
        let _ = std::fs::remove_file(tmpdir.join("file2.txt"));
        let _ = std::fs::remove_dir(&tmpdir);
        Ok(())
    }

    #[test]
    fn test_unpack_stream_from_png_payload() -> Result<()> {
                let mut parts: Vec<u8> = Vec::new();
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());         parts.extend_from_slice(&(2u32.to_be_bytes()));
        let name1 = b"file1.txt";
        parts.extend_from_slice(&(name1.len() as u16).to_be_bytes());
        parts.extend_from_slice(name1);
        let content1 = b"hello world";
        parts.extend_from_slice(&(content1.len() as u64).to_be_bytes());
        parts.extend_from_slice(content1);

        let name2 = b"file2.txt";
        parts.extend_from_slice(&(name2.len() as u16).to_be_bytes());
        parts.extend_from_slice(name2);
        let content2 = b"goodbye";
        parts.extend_from_slice(&(content2.len() as u64).to_be_bytes());
        parts.extend_from_slice(content2);

                let png = crate::encoder::encode_to_png_with_name_and_filelist(&parts, 0, None, None)?;
                let payload = crate::png_utils::extract_payload_from_png(&png).map_err(|e| anyhow::anyhow!(e))?;
        assert!(!payload.is_empty());
                let first = payload[0];
        assert_eq!(first, 0x00u8);
        let compressed = payload[1..].to_vec();
        let mut dec = zstd::stream::Decoder::new(std::io::Cursor::new(compressed)).map_err(|e| anyhow::anyhow!(e))?;
        dec.window_log_max(31).map_err(|e| anyhow::anyhow!(e))?;

                let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        let tmpdir = std::env::temp_dir().join(format!("rox_unpack_png_test_{}", ms));
        let _ = std::fs::create_dir_all(&tmpdir);

        let out = unpack_stream_to_dir(&mut dec, &tmpdir, None, None, 0)?;

        assert_eq!(out.len(), 2);
        assert!(tmpdir.join("file1.txt").exists());
        assert!(tmpdir.join("file2.txt").exists());

                let _ = std::fs::remove_file(tmpdir.join("file1.txt"));
        let _ = std::fs::remove_file(tmpdir.join("file2.txt"));
        let _ = std::fs::remove_dir(&tmpdir);
        Ok(())
    }

    #[test]
    fn test_unpack_stream_to_dir_large_file_small_reads() -> Result<()> {
        let large = vec![0x5a; 2 * 1024 * 1024];
        let mut parts: Vec<u8> = Vec::new();
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());
        parts.extend_from_slice(&(1u32.to_be_bytes()));
        let name = b"big.bin";
        parts.extend_from_slice(&(name.len() as u16).to_be_bytes());
        parts.extend_from_slice(name);
        parts.extend_from_slice(&(large.len() as u64).to_be_bytes());
        parts.extend_from_slice(&large);

        let reader = std::io::Cursor::new(parts);
        let mut reader = ChunkedReader { inner: reader, max_chunk: 37 };

        let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
        let tmpdir = std::env::temp_dir().join(format!("rox_unpack_large_stream_test_{}", ms));
        let _ = std::fs::create_dir_all(&tmpdir);

        let out = unpack_stream_to_dir(&mut reader, &tmpdir, None, None, large.len() as u64)?;

        assert_eq!(out, vec!["big.bin".to_string()]);
        let restored = std::fs::read(tmpdir.join("big.bin"))?;
        assert_eq!(restored.len(), large.len());
        assert_eq!(restored, large);

        let _ = std::fs::remove_file(tmpdir.join("big.bin"));
        let _ = std::fs::remove_dir(&tmpdir);
        Ok(())
    }
}

