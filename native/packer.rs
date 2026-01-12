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
