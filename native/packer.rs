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

/// Unpack a pack-format buffer into the given directory. If `files_opt` is Some(list)
/// only the specified filenames will be written. Returns vector of written relative paths.
pub fn unpack_buffer_to_dir(buf: &[u8], out_dir: &Path, files_opt: Option<&[String]>) -> Result<Vec<String>> {
    use std::io::Cursor;
    use std::convert::TryInto;
    let mut written = Vec::new();
    let mut pos = 0usize;

    if buf.len() < 8 { return Err(anyhow::anyhow!("Buffer too small")); }
    let magic = u32::from_be_bytes(buf[0..4].try_into().unwrap());
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
        let content = &buf[pos..pos+size]; pos += size;

        let should_write = match &files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            // sanitize path components to avoid path traversal
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
    }

    Ok(written)
}
