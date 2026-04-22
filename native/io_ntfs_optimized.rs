use std::fs::{File, OpenOptions};
use std::io::{BufWriter, Write};
use std::path::Path;

/// Buffer size optimized for NTFS (larger = fewer syscalls)
#[cfg(windows)]
const NTFS_WRITE_BUFFER: usize = 4 * 1024 * 1024; // 4MB for Windows/NTFS
#[cfg(not(windows))]
const NTFS_WRITE_BUFFER: usize = 64 * 1024; // 64KB for Unix

/// Optimized file writer with large buffer for NTFS
pub struct OptimizedFileWriter {
    writer: BufWriter<File>,
}

impl OptimizedFileWriter {
    pub fn create(path: &Path) -> std::io::Result<Self> {
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(path)?;
        
        Ok(Self {
            writer: BufWriter::with_capacity(NTFS_WRITE_BUFFER, file),
        })
    }
    
    pub fn write_all(&mut self, buf: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(buf)
    }
    
    pub fn flush(&mut self) -> std::io::Result<()> {
        self.writer.flush()
    }
}

/// Write file with optimized buffering for target filesystem
pub fn write_file_optimized(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut writer = OptimizedFileWriter::create(path)?;
    writer.write_all(content)?;
    writer.flush()?;
    Ok(())
}

/// Batch write multiple files - keeps files open for better NTFS performance
pub fn write_files_batch(
    base_dir: &Path,
    files: &[(String, &[u8])],
) -> Result<Vec<String>, String> {
    let mut written = Vec::with_capacity(files.len());
    
    for (rel_path, content) in files {
        let safe_path = sanitize_path(rel_path);
        let dest = base_dir.join(&safe_path);
        
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create parent dir {:?}: {}", parent, e))?;
        }
        
        write_file_optimized(&dest, content)
            .map_err(|e| format!("Cannot write {:?}: {}", dest, e))?;
        
        written.push(safe_path.to_string_lossy().to_string());
    }
    
    Ok(written)
}

fn sanitize_path(path: &str) -> std::path::PathBuf {
    let mut safe = std::path::PathBuf::new();
    for comp in std::path::Path::new(path).components() {
        if let std::path::Component::Normal(osstr) = comp {
            safe.push(osstr);
        }
    }
    safe
}

/// Pre-allocate file space on NTFS to reduce fragmentation
#[cfg(windows)]
pub fn preallocate_file(path: &Path, size: u64) -> std::io::Result<()> {
    use std::os::windows::fs::FileExt;
    
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(path)?;
    
    // Pre-allocate space
    file.set_len(size)?;
    Ok(())
}

#[cfg(not(windows))]
pub fn preallocate_file(_path: &Path, _size: u64) -> std::io::Result<()> {
    Ok(())
}
