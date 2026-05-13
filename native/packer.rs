use anyhow::Result;
use memmap2::MmapOptions;
use rayon::prelude::*;
use serde_json::json;
use std::fs;
use std::fs::{File, OpenOptions};
use std::io::Read;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

#[cfg(windows)]
use std::os::windows::fs::OpenOptionsExt;

const ROX_ALIGNMENT: usize = 4096;

fn align_up(offset: u64, alignment: u64) -> u64 {
    let mask = alignment - 1;
    (offset + mask) & !mask
}

pub struct PackResult {
    pub data: Vec<u8>,
    pub file_list_json: Option<String>,
}

// Windows VFS: Structure pour archive monolithique .rox
#[derive(Debug, Clone)]
pub struct VfsEntry {
    pub path: String,
    pub offset: u64,
    pub size: u64,
    pub compressed_size: u64,
}

#[derive(Debug)]
pub struct VfsArchive {
    pub entries: Vec<VfsEntry>,
    pub data: Vec<u8>,
}

impl VfsArchive {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            data: Vec::new(),
        }
    }

    pub fn add_file(&mut self, path: String, data: &[u8]) {
        let offset = self.data.len() as u64;
        let size = data.len() as u64;

        self.data.extend_from_slice(data);
        self.entries.push(VfsEntry {
            path,
            offset,
            size,
            compressed_size: size, // Pour l'instant non compressé
        });
    }

    // Windows: écriture ultra-optimisée en un seul fichier .rox
    pub fn write_to_rox_file(&self, target_path: &Path) -> Result<()> {
        // Créer le header VFS
        let mut header = Vec::new();

        // Magic number "ROXV"
        header.extend_from_slice(b"ROXV");

        // Version
        header.extend_from_slice(&1u32.to_le_bytes());

        // Nombre d'entrées
        header.extend_from_slice(&(self.entries.len() as u32).to_le_bytes());

        // Écrire les entrées
        for entry in &self.entries {
            // Longueur du chemin
            let path_bytes = entry.path.as_bytes();
            header.extend_from_slice(&(path_bytes.len() as u16).to_le_bytes());
            header.extend_from_slice(path_bytes);

            // Offset et taille
            header.extend_from_slice(&entry.offset.to_le_bytes());
            header.extend_from_slice(&entry.size.to_le_bytes());
            header.extend_from_slice(&entry.compressed_size.to_le_bytes());
        }

        // Calculer l'offset des données
        let data_offset = header.len() as u64;

        // Créer le fichier avec pré-allocation
        let file = open_file_with_share(target_path)?;

        // Pré-allouer l'espace total (header + data)
        let total_size = data_offset + self.data.len() as u64;
        file.set_len(total_size)?;

        // Memory Mapping pour écriture ultra-optimisée
        let mut mmap = unsafe { MmapOptions::new().map_mut(&file)? };

        // Écrire le header
        mmap[..header.len()].copy_from_slice(&header);

        // Écrire les données
        let data_start = data_offset as usize;
        let data_end = data_start + self.data.len();
        mmap[data_start..data_end].copy_from_slice(&self.data);

        // Flush asynchrone pour ne pas bloquer
        mmap.flush_async()?;

        Ok(())
    }

    pub fn from_pack_buffer(buf: &[u8]) -> Result<Self> {
        if buf.len() < 8 {
            return Err(anyhow::anyhow!("Buffer too small for pack format"));
        }
        let magic = u32::from_be_bytes(buf[0..4].try_into().unwrap());
        if magic != 0x524f5850u32 {
            return Err(anyhow::anyhow!("Unsupported pack magic for VFS conversion"));
        }

        let mut pos = 4;
        let file_count = u32::from_be_bytes(buf[pos..pos + 4].try_into().unwrap()) as usize;
        pos += 4;

        let mut entries = Vec::with_capacity(file_count);
        let mut data = Vec::new();

        for _ in 0..file_count {
            let name_len = u16::from_be_bytes(buf[pos..pos + 2].try_into().unwrap()) as usize;
            pos += 2;
            let name = String::from_utf8_lossy(&buf[pos..pos + name_len]).to_string();
            pos += name_len;
            let size = u64::from_be_bytes(buf[pos..pos + 8].try_into().unwrap()) as usize;
            pos += 8;
            let current_offset = data.len() as u64;
            let aligned_offset = align_up(current_offset, ROX_ALIGNMENT as u64);
            if aligned_offset > current_offset {
                data.resize(aligned_offset as usize, 0u8);
            }
            let offset = aligned_offset;
            let content = &buf[pos..pos + size];
            data.extend_from_slice(content);
            pos += size;
            entries.push(VfsEntry {
                path: name,
                offset,
                size: size as u64,
                compressed_size: size as u64,
            });
        }

        Ok(Self { entries, data })
    }

    pub fn from_rox_buffer(buf: &[u8]) -> Result<Self> {
        if buf.len() < 12 {
            return Err(anyhow::anyhow!("Buffer too small for ROXV header"));
        }
        let magic = u32::from_be_bytes(buf[0..4].try_into().unwrap());
        if magic != 0x524f5856u32 {
            return Err(anyhow::anyhow!("Invalid VFS magic"));
        }

        let version = u32::from_le_bytes(buf[4..8].try_into().unwrap());
        if version != 1 {
            return Err(anyhow::anyhow!("Unsupported ROXV version"));
        }

        let file_count = u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize;
        let mut pos = 12;
        let mut entries = Vec::with_capacity(file_count);

        for _ in 0..file_count {
            let name_len = u16::from_le_bytes(buf[pos..pos + 2].try_into().unwrap()) as usize;
            pos += 2;
            let name = String::from_utf8_lossy(&buf[pos..pos + name_len]).to_string();
            pos += name_len;
            let offset = u64::from_le_bytes(buf[pos..pos + 8].try_into().unwrap());
            pos += 8;
            let size = u64::from_le_bytes(buf[pos..pos + 8].try_into().unwrap());
            pos += 8;
            let compressed_size = u64::from_le_bytes(buf[pos..pos + 8].try_into().unwrap());
            pos += 8;
            entries.push(VfsEntry {
                path: name,
                offset,
                size,
                compressed_size,
            });
        }

        let data = buf[pos..].to_vec();
        for entry in &entries {
            if entry.offset + entry.size > data.len() as u64 {
                return Err(anyhow::anyhow!("Invalid ROXV entry bounds"));
            }
        }

        Ok(Self { entries, data })
    }
}

pub fn unpack_buffer_to_vfs(buf: &[u8], target_rox: &Path) -> Result<()> {
    let archive = if buf.len() >= 4 && u32::from_be_bytes(buf[0..4].try_into().unwrap()) == 0x524f5856u32 {
        VfsArchive::from_rox_buffer(buf)?
    } else {
        VfsArchive::from_pack_buffer(buf)?
    };
    if let Some(parent) = target_rox.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
    }
    archive.write_to_rox_file(target_rox)
}

pub fn count_pack_entries(buf: &[u8]) -> Result<usize> {
    if buf.len() < 4 {
        return Err(anyhow::anyhow!("Buffer too small to count entries"));
    }

    let magic = u32::from_be_bytes(buf[0..4].try_into().unwrap());
    if magic == 0x524f5831u32 {
        return count_pack_entries(&buf[4..]);
    }
    if magic == 0x524f5856u32 {
        if buf.len() < 12 {
            return Err(anyhow::anyhow!("ROXV buffer too small"));
        }
        return Ok(u32::from_le_bytes(buf[8..12].try_into().unwrap()) as usize);
    }

    if magic == 0x524f5849u32 {
        if buf.len() < 8 {
            return Err(anyhow::anyhow!("ROXI buffer too small"));
        }
        let index_len = u32::from_be_bytes(buf[4..8].try_into().unwrap()) as usize;
        let index_start = 8;
        let index_end = index_start + index_len;
        if index_end > buf.len() {
            return Err(anyhow::anyhow!("ROXI index truncated"));
        }
        let json: Vec<serde_json::Value> = serde_json::from_slice(&buf[index_start..index_end])
            .map_err(|e| anyhow::anyhow!("ROXI index parse error: {}", e))?;
        return Ok(json.len());
    }

    if magic == 0x524f5850u32 {
        if buf.len() < 8 {
            return Err(anyhow::anyhow!("ROXP buffer too small"));
        }
        return Ok(u32::from_be_bytes(buf[4..8].try_into().unwrap()) as usize);
    }

    Err(anyhow::anyhow!("Unknown pack magic: 0x{:08x}", magic))
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
            let rel_path = file_path
                .strip_prefix(base)
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

    let total_size: usize = file_data
        .par_iter()
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
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");

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
                let rel_path = file_path
                    .strip_prefix(base)
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

        let file_list: Vec<_> = file_data
            .iter()
            .map(|(name, content)| json!({"name": name, "size": content.len()}))
            .collect();

        let total_size: usize = file_data
            .par_iter()
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

pub fn unpack_buffer_to_dir(
    buf: &[u8],
    out_dir: &Path,
    files_opt: Option<&[String]>,
) -> Result<Vec<String>> {
    use std::convert::TryInto;
    let mut written = Vec::new();
    let mut pos = 0usize;

    if buf.len() < 8 {
        return Err(anyhow::anyhow!("Buffer too small"));
    }
    let magic = u32::from_be_bytes(buf[0..4].try_into().unwrap());

    if magic == 0x524f5856u32 {
        return unpack_rox_vfs_to_dir(buf, out_dir, files_opt);
    }

    if magic == 0x524f5849u32 {
        let index_len = u32::from_be_bytes(buf[4..8].try_into().unwrap()) as usize;
        pos = 8 + index_len;
        return unpack_entries_sequential(buf, pos, out_dir, files_opt);
    }

    if magic != 0x524f5850u32 {
        return Err(anyhow::anyhow!("Invalid pack magic"));
    }
    pos += 4;
    let file_count = u32::from_be_bytes(buf[pos..pos + 4].try_into().unwrap()) as usize;
    pos += 4;

    let files_filter: Option<std::collections::HashSet<String>> =
        files_opt.map(|l| l.iter().map(|s| s.clone()).collect());

    for _ in 0..file_count {
        if pos + 2 > buf.len() {
            return Err(anyhow::anyhow!("Truncated pack (name len)"));
        }
        let name_len = u16::from_be_bytes(buf[pos..pos + 2].try_into().unwrap()) as usize;
        pos += 2;
        if pos + name_len > buf.len() {
            return Err(anyhow::anyhow!("Truncated pack (name)"));
        }
        let name = String::from_utf8_lossy(&buf[pos..pos + name_len]).to_string();
        pos += name_len;
        if pos + 8 > buf.len() {
            return Err(anyhow::anyhow!("Truncated pack (size)"));
        }
        let size = u64::from_be_bytes(buf[pos..pos + 8].try_into().unwrap()) as usize;
        pos += 8;
        if pos + size > buf.len() {
            return Err(anyhow::anyhow!("Truncated pack (content)"));
        }

        let should_write = match &files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            let content = &buf[pos..pos + size];
            let p = Path::new(&name);
            let mut safe = std::path::PathBuf::new();
            for comp in p.components() {
                if let std::path::Component::Normal(osstr) = comp {
                    safe.push(osstr);
                }
            }
            let dest = out_dir.join(&safe);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
            }
            std::fs::write(&dest, content)
                .map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
            written.push(safe.to_string_lossy().to_string());
        }

        pos += size;
    }

    Ok(written)
}

fn unpack_entries_sequential(
    buf: &[u8],
    start: usize,
    out_dir: &Path,
    files_opt: Option<&[String]>,
) -> Result<Vec<String>> {
    let mut written = Vec::new();
    let mut pos = start;
    let files_filter: Option<std::collections::HashSet<String>> =
        files_opt.map(|l| l.iter().map(|s| s.clone()).collect());

    while pos + 2 < buf.len() {
        let magic = u32::from_be_bytes(buf[pos..pos + 4].try_into().unwrap_or([0; 4]));
        if magic == 0x524f5849u32 {
            if pos + 8 > buf.len() {
                break;
            }
            let index_len = u32::from_be_bytes(buf[pos + 4..pos + 8].try_into().unwrap()) as usize;
            pos += 8 + index_len;
            continue;
        }

        if pos + 2 > buf.len() {
            break;
        }
        let name_len = u16::from_be_bytes(buf[pos..pos + 2].try_into().unwrap()) as usize;
        pos += 2;
        if pos + name_len > buf.len() {
            break;
        }
        let name = String::from_utf8_lossy(&buf[pos..pos + name_len]).to_string();
        pos += name_len;
        if pos + 8 > buf.len() {
            break;
        }
        let size = u64::from_be_bytes(buf[pos..pos + 8].try_into().unwrap()) as usize;
        pos += 8;
        if pos + size > buf.len() {
            break;
        }

        let should_write = match &files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            let content = &buf[pos..pos + size];
            let p = Path::new(&name);
            let mut safe = std::path::PathBuf::new();
            for comp in p.components() {
                if let std::path::Component::Normal(osstr) = comp {
                    safe.push(osstr);
                }
            }
            let dest = out_dir.join(&safe);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
            }
            std::fs::write(&dest, content)
                .map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
            written.push(safe.to_string_lossy().to_string());
        }

        pos += size;
    }

    Ok(written)
}

fn unpack_rox_vfs_to_dir(
    buf: &[u8],
    out_dir: &Path,
    files_opt: Option<&[String]>,
) -> Result<Vec<String>> {
    let archive = VfsArchive::from_rox_buffer(buf)?;
    let files_filter: Option<std::collections::HashSet<String>> = files_opt
        .map(|l| l.iter().map(|s| s.clone()).collect());
    let mut written = Vec::new();

    for entry in archive.entries {
        let should_write = match &files_filter {
            Some(set) => set.contains(&entry.path),
            None => true,
        };
        if !should_write {
            continue;
        }

        let content_start = entry.offset as usize;
        let content_end = content_start + entry.size as usize;
        let content = &archive.data[content_start..content_end];

        let p = Path::new(&entry.path);
        let mut safe = std::path::PathBuf::new();
        for comp in p.components() {
            if let std::path::Component::Normal(osstr) = comp {
                safe.push(osstr);
            }
        }

        let dest = out_dir.join(&safe);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
        }
        std::fs::write(&dest, content)
            .map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
        written.push(safe.to_string_lossy().to_string());
    }

    Ok(written)
}

fn unpack_progress_percent(
    total_expected: u64,
    bytes_processed: u64,
    file_count: usize,
    processed_files: usize,
) -> u64 {
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
        let pct =
            unpack_progress_percent(total_expected, bytes_processed, file_count, processed_files);
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
    let files_filter: Option<std::collections::HashSet<String>> =
        files_opt.map(|l| l.iter().map(|s| s.clone()).collect());
    let mut requested = files_filter.as_ref().map(|s| s.len()).unwrap_or(usize::MAX);
    let file_count: usize;
    let mut processed_files = 0usize;
    let mut bytes_processed = 0u64;
    let mut last_pct = 10u64;

    // Windows optimization: cache des répertoires déjà créés pour éviter l'overhead NTFS
    let mut created_dirs = std::collections::HashSet::new();

    let mut batch_files: Vec<(PathBuf, Vec<u8>)> = Vec::new();

    let flush_batch_files = |batch_files: &mut Vec<(PathBuf, Vec<u8>)>| -> Result<()> {
        for (dest, data) in batch_files.drain(..) {
            std::fs::write(&dest, &data)
                .map_err(|e| anyhow::anyhow!("Cannot write batched file {:?}: {}", dest, e))?;
        }
        Ok(())
    };

    let mut magic = read_pack_u32(reader)?;
    if magic == 0x524f5831u32 {
        magic = read_pack_u32(reader)?;
    }
    if magic == 0x524f5849u32 {
        // ROXI format: index contains file metadata, data follows directly
        let index_len = read_pack_u32(reader)? as u64;
        let mut index_bytes = vec![0u8; index_len as usize];
        read_pack_exact(reader, &mut index_bytes)?;

        // Parse index JSON
        let index: Vec<serde_json::Value> = serde_json::from_slice(&index_bytes)
            .map_err(|e| anyhow::anyhow!("Failed to parse ROXI index: {}", e))?;
        // Read next 4 bytes to check for ROXP
        let next = read_pack_u32(reader)?;

        // If no ROXP, data follows directly - put back the 4 bytes we read
        if next != 0x524f5850u32 {
            // ROXI-only format: put back the 4 bytes and process data stream
            let prefix = next.to_be_bytes();
            let mut chained = std::io::Cursor::new(prefix).chain(reader);
            return unpack_roxi_only_stream(
                &mut chained,
                &index,
                out_dir,
                files_filter.as_ref(),
                progress,
                total_expected,
            );
        }

        // ROXP follows - continue with normal ROXP processing
        magic = next;
    }
    if magic != 0x524f5850u32 && magic != 0x524f5856u32 {
        return Err(anyhow::anyhow!("Invalid pack magic: 0x{:08x}", magic));
    }
    let is_roxv = magic == 0x524f5856u32;

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
                // Windows optimization: utiliser le cache pour éviter l'overhead NTFS
                if cfg!(target_os = "windows") {
                    if !created_dirs.contains(parent) {
                        std::fs::create_dir_all(parent)
                            .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
                        created_dirs.insert(parent.to_path_buf());
                    }
                } else {
                    // Linux: comportement standard
                    std::fs::create_dir_all(parent)
                        .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
                }
            }

            // Windows optimization: création de fichiers ultra-optimisée
            let file = open_file_with_share(&dest)
                .map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;

            let mut writer: Box<dyn std::io::Write> = if cfg!(target_os = "windows") && size > 1024 * 1024 {
                // Windows: pour gros fichiers, écriture directe sans buffering
                Box::new(file)
            } else {
                // Linux ou petits fichiers: buffering standard
                Box::new(std::io::BufWriter::with_capacity(file_buffer_capacity(size), file))
            };
            // Windows optimization: extraction par batch pour éviter l'overhead NTFS
            if cfg!(target_os = "windows") {
                let mut file_data = vec![0u8; size as usize];
                reader.read_exact(&mut file_data)?;

                batch_files.push((dest.clone(), file_data));
                bytes_processed += size;
            } else {
                copy_pack_bytes(
                    reader,
                    &mut writer,
                    size,
                    &mut bytes_processed,
                    file_count,
                    processed_files,
                    total_expected,
                    progress,
                    &mut last_pct,
                )?;
            }
            // Windows optimization: finalisation simplifiée pour éviter l'overhead
            if cfg!(target_os = "windows") {
                // Windows: pas de finalisation spéciale pour performance
                drop(writer);
            } else {
                // Linux: finalisation standard (on ne peut pas downcast, donc on drop simplement)
                drop(writer);
            }
            written.push(safe.to_string_lossy().to_string());
            if files_filter.is_some() {
                requested = requested.saturating_sub(1);
            }
        } else {
            discard_pack_bytes(
                reader,
                size,
                &mut bytes_processed,
                file_count,
                processed_files,
                total_expected,
                progress,
                &mut last_pct,
            )?;
        }

        processed_files = processed_files.saturating_add(1);
        report_unpack_progress(
            progress,
            total_expected,
            bytes_processed,
            file_count,
            processed_files,
            &mut last_pct,
        );

        if requested == 0 {
            flush_batch_files(&mut batch_files)?;
            if let Some(cb) = progress {
                cb(99, 100, "finishing");
            }
            return Ok(written);
        }
    }

    flush_batch_files(&mut batch_files)?;

    if let Some(cb) = progress {
        cb(99, 100, "finishing");
    }

    Ok(written)
}

fn unpack_roxi_only_stream<R: std::io::Read>(
    reader: &mut R,
    index: &[serde_json::Value],
    out_dir: &Path,
    files_filter: Option<&std::collections::HashSet<String>>,
    progress: Option<&(dyn Fn(u64, u64, &str) + Send)>,
    total_expected: u64,
) -> Result<Vec<String>> {
    let mut written = Vec::new();
    let mut requested = files_filter.map(|s| s.len()).unwrap_or(usize::MAX);
    let mut bytes_processed = 0u64;
    let mut last_pct = 10u64;
    let file_count = index.len();
    let mut processed_files = 0usize;

    // Files are already in offset order in the index, no sorting needed
    for entry in index {
        let name = entry
            .get("path")
            .and_then(|p| p.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing path in ROXI index"))?
            .to_string();
        let size = entry
            .get("size")
            .and_then(|s| s.as_u64())
            .ok_or_else(|| anyhow::anyhow!("Missing size in ROXI index"))?;

        // Skip header: nameLen (2) + name (nameLen) + size (8)
        let name_len = name.len() as u64;
        let header_size = 2 + name_len + 8;
        discard_pack_bytes(
            reader,
            header_size,
            &mut bytes_processed,
            file_count,
            processed_files,
            total_expected,
            progress,
            &mut last_pct,
        )?;

        let should_write = match files_filter {
            Some(set) => set.contains(&name),
            None => true,
        };

        if should_write {
            let safe = sanitize_pack_path(&name);
            let dest = out_dir.join(&safe);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| anyhow::anyhow!("Cannot create parent dir {:?}: {}", parent, e))?;
            }
            let file = open_file_with_share(&dest)
                .map_err(|e| anyhow::anyhow!("Cannot write {:?}: {}", dest, e))?;
            let mut writer = std::io::BufWriter::with_capacity(file_buffer_capacity(size), file);
            copy_pack_bytes(
                reader,
                &mut writer,
                size,
                &mut bytes_processed,
                file_count,
                processed_files,
                total_expected,
                progress,
                &mut last_pct,
            )?;
            // Windows optimization: finalisation simplifiée pour éviter l'overhead
            if cfg!(target_os = "windows") {
                // Windows: pas de finalisation spéciale pour performance
                drop(writer);
            } else {
                // Linux: finalisation standard (on ne peut pas downcast, donc on drop simplement)
                drop(writer);
            }
            written.push(safe.to_string_lossy().to_string());
            if files_filter.is_some() {
                requested = requested.saturating_sub(1);
            }
        } else {
            discard_pack_bytes(
                reader,
                size,
                &mut bytes_processed,
                file_count,
                processed_files,
                total_expected,
                progress,
                &mut last_pct,
            )?;
        }

        processed_files = processed_files.saturating_add(1);
        report_unpack_progress(
            progress,
            total_expected,
            bytes_processed,
            file_count,
            processed_files,
            &mut last_pct,
        );

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
    reader
        .read_exact(buf)
        .map_err(|e| anyhow::anyhow!("Stream read error: {}", e))
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
    if cfg!(target_os = "windows") {
        // Windows: buffers ultra-larges pour performance maximale
        usize::try_from(size)
            .unwrap_or(64 * 1024 * 1024)
            .min(64 * 1024 * 1024) // 64MB max
            .max(1024 * 1024)       // 1MB min
    } else {
        // Linux: buffers standards
        usize::try_from(size)
            .unwrap_or(4 * 1024 * 1024)
            .min(4 * 1024 * 1024)
            .max(8192)
    }
}

fn finalize_output_file(
    mut writer: std::io::BufWriter<std::fs::File>,
    size: u64,
    dest: &Path,
) -> Result<()> {
    std::io::Write::flush(&mut writer)
        .map_err(|e| anyhow::anyhow!("Cannot flush {:?}: {}", dest, e))?;
    let file = writer
        .into_inner()
        .map_err(|e| anyhow::anyhow!("Cannot finalize {:?}: {}", dest, e.error()))?;

    // Windows optimization: réduire la synchronisation pour performance
    if cfg!(target_os = "windows") {
        // Windows: pas de sync_and_drop pour éviter l'overhead NTFS
        drop(file);
    } else {
        // Linux: conserver la synchronisation standard
        crate::io_advice::sync_and_drop(&file, size);
    }
    Ok(())
}

// Windows optimization: streaming direct ultra-optimisé
pub fn unpack_stream_to_dir_windows_optimized<R: std::io::Read>(
    reader: &mut R,
    out_dir: &Path,
    files_opt: Option<&[String]>,
    progress: Option<&(dyn Fn(u64, u64, &str) + Send)>,
    total_expected: u64,
) -> Result<Vec<String>> {
    let mut prefix = [0u8; 8];
    reader.read_exact(&mut prefix)?;
    let mut chained = std::io::Cursor::new(prefix.to_vec()).chain(reader);
    crate::packer::unpack_stream_to_dir(&mut chained, out_dir, files_opt, progress, total_expected)
}

fn open_file_with_share(dest: &Path) -> Result<File> {
    #[cfg(windows)]
    {
        const FILE_SHARE_READ: u32 = 0x00000001;
        const FILE_SHARE_WRITE: u32 = 0x00000002;
        const FILE_SHARE_DELETE: u32 = 0x00000004;
        const FILE_FLAG_SEQUENTIAL_SCAN: u32 = 0x08000000;
        Ok(OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
            .custom_flags(FILE_FLAG_SEQUENTIAL_SCAN)
            .open(dest)?)
    }
    #[cfg(not(windows))]
    {
        Ok(OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(dest)?)
    }
}

// Windows optimization: écriture ultra-optimisée avec Memory Mapping et pré-allocation
fn write_file_with_mmap(dest: &Path, data: &[u8]) -> Result<()> {
    // Créer le fichier avec pré-allocation
    let file = open_file_with_share(dest)?;

    // Pré-allouer l'espace disque (SetEndOfFile)
    file.set_len(data.len() as u64)?;

    // Memory Mapping pour écriture directe
    let mut mmap = unsafe { MmapOptions::new().map_mut(&file)? };

    // Écriture directe dans la mémoire mappée
    mmap.copy_from_slice(data);

    // Synchronisation asynchrone (pas de flush bloquant)
    mmap.flush_async()?;

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
    let mut buf = if cfg!(target_os = "windows") {
        // Windows: buffers ultra-larges pour performance maximale
        vec![0u8; 64 * 1024 * 1024] // 64MB buffer
    } else {
        // Linux: buffer standard
        vec![0u8; 1024 * 1024] // 1MB buffer
    };

    // Windows optimization: pour les très gros transferts, utiliser std::io::copy directement
    if cfg!(target_os = "windows") && remaining > 100 * 1024 * 1024 {
        use std::io::copy;
        let mut temp_reader = reader.take(remaining);
        let copied = copy(&mut temp_reader, &mut *writer)
            .map_err(|e| anyhow::anyhow!("Fast copy error: {}", e))?;
        *bytes_processed = bytes_processed.saturating_add(copied as u64);

        // Mettre à jour le progrès une seule fois pour éviter l'overhead
        if let Some(cb) = progress {
            let pct = unpack_progress_percent(total_expected, *bytes_processed, file_count, processed_files);
            if pct > *last_pct {
                *last_pct = pct;
                cb(pct, 100, "ultra-fast copy");
            }
        }
        return Ok(());
    }

    // Copie standard pour les petits fichiers
    while remaining > 0 {
        let take = remaining.min(buf.len() as u64) as usize;
        let read = reader
            .read(&mut buf[..take])
            .map_err(|e| anyhow::anyhow!("Stream read error: {}", e))?;
        if read == 0 {
            return Err(anyhow::anyhow!("Truncated pack content"));
        }
        writer
            .write_all(&buf[..read])
            .map_err(|e| anyhow::anyhow!("Stream write error: {}", e))?;
        remaining -= read as u64;
        *bytes_processed = bytes_processed.saturating_add(read as u64);
        report_unpack_progress(
            progress,
            total_expected,
            *bytes_processed,
            file_count,
            processed_files,
            last_pct,
        );
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
        let read = reader
            .read(&mut buf[..take])
            .map_err(|e| anyhow::anyhow!("Stream read error: {}", e))?;
        if read == 0 {
            return Err(anyhow::anyhow!("Truncated pack content"));
        }
        remaining -= read as u64;
        *bytes_processed = bytes_processed.saturating_add(read as u64);
        report_unpack_progress(
            progress,
            total_expected,
            *bytes_processed,
            file_count,
            processed_files,
            last_pct,
        );
    }
    Ok(())
}

#[cfg(test)]
mod stream_tests {
    use super::*;
    use std::io::{Read, Write};
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
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());
        parts.extend_from_slice(&(2u32.to_be_bytes()));
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

        let mut encoder =
            zstd::stream::Encoder::new(Vec::new(), 0).map_err(|e| anyhow::anyhow!(e))?;
        encoder.write_all(&parts).map_err(|e| anyhow::anyhow!(e))?;
        let compressed = encoder.finish().map_err(|e| anyhow::anyhow!(e))?;

        let mut dec = zstd::stream::Decoder::new(std::io::Cursor::new(compressed.clone()))
            .map_err(|e| anyhow::anyhow!(e))?;
        dec.window_log_max(31).map_err(|e| anyhow::anyhow!(e))?;

        let mut all = Vec::new();
        dec.read_to_end(&mut all).map_err(|e| anyhow::anyhow!(e))?;
        assert_eq!(all.len(), parts.len());
        assert_eq!(&all[..], &parts[..]);

        let mut dec2 = zstd::stream::Decoder::new(std::io::Cursor::new(compressed))
            .map_err(|e| anyhow::anyhow!(e))?;
        dec2.window_log_max(31).map_err(|e| anyhow::anyhow!(e))?;

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
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
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());
        parts.extend_from_slice(&(2u32.to_be_bytes()));
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
        let payload =
            crate::png_utils::extract_payload_from_png(&png).map_err(|e| anyhow::anyhow!(e))?;
        assert!(!payload.is_empty());
        let first = payload[0];
        assert_eq!(first, 0x00u8);
        let compressed = payload[1..].to_vec();
        let mut dec = zstd::stream::Decoder::new(std::io::Cursor::new(compressed))
            .map_err(|e| anyhow::anyhow!(e))?;
        dec.window_log_max(31).map_err(|e| anyhow::anyhow!(e))?;

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
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
    fn test_unpack_buffer_to_vfs_creates_rox() -> Result<()> {
        let mut parts: Vec<u8> = Vec::new();
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());
        parts.extend_from_slice(&(2u32.to_be_bytes()));
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

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let tmpdir = std::env::temp_dir().join(format!("rox_unpack_vfs_test_{}", ms));
        let _ = std::fs::create_dir_all(&tmpdir);
        let rox_path = tmpdir.join("archive.rox");

        unpack_buffer_to_vfs(&parts, &rox_path)?;
        assert!(rox_path.exists());

        let rox_bytes = std::fs::read(&rox_path)?;
        assert_eq!(u32::from_be_bytes(rox_bytes[0..4].try_into().unwrap()), 0x524f5856u32);

        let extract_dir = tmpdir.join("extract");
        let _ = std::fs::create_dir_all(&extract_dir);
        let written = unpack_buffer_to_dir(&rox_bytes, &extract_dir, None)?;
        assert_eq!(written.len(), 2);
        assert!(extract_dir.join("file1.txt").exists());
        assert!(extract_dir.join("file2.txt").exists());

        let _ = std::fs::remove_file(extract_dir.join("file1.txt"));
        let _ = std::fs::remove_file(extract_dir.join("file2.txt"));
        let _ = std::fs::remove_file(&rox_path);
        let _ = std::fs::remove_dir(&extract_dir);
        let _ = std::fs::remove_dir(&tmpdir);
        Ok(())
    }

    #[test]
    fn test_rox_alignment_from_pack_buffer() -> Result<()> {
        let mut parts: Vec<u8> = Vec::new();
        parts.extend_from_slice(&0x524f5850u32.to_be_bytes());
        parts.extend_from_slice(&(2u32.to_be_bytes()));
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

        let archive = VfsArchive::from_pack_buffer(&parts)?;
        for entry in &archive.entries {
            assert_eq!(entry.offset % ROX_ALIGNMENT as u64, 0);
        }

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let tmpdir = std::env::temp_dir().join(format!("rox_unpack_align_test_{}", ms));
        let _ = std::fs::create_dir_all(&tmpdir);
        let rox_path = tmpdir.join("archive.rox");

        archive.write_to_rox_file(&rox_path)?;
        assert!(rox_path.exists());

        let _ = std::fs::remove_file(&rox_path);
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
        let mut reader = ChunkedReader {
            inner: reader,
            max_chunk: 37,
        };

        let ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis();
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
