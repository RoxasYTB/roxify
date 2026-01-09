use anyhow::Result;
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

pub fn pack_directory(dir_path: &Path, base_dir: Option<&Path>) -> Result<Vec<u8>> {
    let base = base_dir.unwrap_or(dir_path);

    let mut files = Vec::new();
    for entry in WalkDir::new(dir_path).follow_links(false) {
        let entry = entry?;
        if entry.file_type().is_file() {
            files.push(entry.path().to_path_buf());
        }
    }

    let mut parts = Vec::new();

    for file_path in &files {
        let rel_path = file_path.strip_prefix(base)
            .unwrap_or(file_path.as_path())
            .to_string_lossy()
            .replace('\\', "/");

        let content = fs::read(file_path)?;
        let name_bytes = rel_path.as_bytes();

        let name_len = (name_bytes.len() as u16).to_be_bytes();
        let size = (content.len() as u64).to_be_bytes();

        parts.push(name_len.to_vec());
        parts.push(name_bytes.to_vec());
        parts.push(size.to_vec());
        parts.push(content);
    }

    let mut header = vec![0u8; 8];
    header[0..4].copy_from_slice(&0x524f5850u32.to_be_bytes());
    header[4..8].copy_from_slice(&(files.len() as u32).to_be_bytes());

    let mut result = Vec::new();
    result.extend_from_slice(&header);
    for part in parts {
        result.extend_from_slice(&part);
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
