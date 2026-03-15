use std::io::Cursor;
use std::path::Path;
use rayon::prelude::*;
use tar::{Archive, Builder, Header};
use walkdir::WalkDir;

pub fn tar_pack_directory(dir_path: &Path) -> Result<Vec<u8>, String> {
    let base = dir_path;

    let entries: Vec<_> = WalkDir::new(dir_path)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    let file_data: Vec<(String, Vec<u8>)> = entries
        .par_iter()
        .filter_map(|entry| {
            let full = entry.path();
            let rel = full.strip_prefix(base).unwrap_or(full);
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            match std::fs::read(full) {
                Ok(data) => Some((rel_str, data)),
                Err(_) => None,
            }
        })
        .collect();

    let total_estimate: usize = file_data.iter().map(|(n, d)| 512 + d.len() + 512 + n.len()).sum();
    let mut buf = Vec::with_capacity(total_estimate + 1024);
    {
        let mut builder = Builder::new(&mut buf);
        for (rel_str, data) in &file_data {
            let mut header = Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, rel_str, &data[..])
                .map_err(|e| format!("tar append {}: {}", rel_str, e))?;
        }
        builder.finish().map_err(|e| format!("tar finish: {}", e))?;
    }
    Ok(buf)
}

pub fn tar_unpack(tar_data: &[u8], output_dir: &Path) -> Result<Vec<String>, String> {
    let mut archive = Archive::new(Cursor::new(tar_data));
    let mut written = Vec::new();

    let entries = archive.entries().map_err(|e| format!("tar entries: {}", e))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("tar entry: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("tar entry path: {}", e))?
            .to_path_buf();

        let mut safe = std::path::PathBuf::new();
        for comp in path.components() {
            if let std::path::Component::Normal(osstr) = comp {
                safe.push(osstr);
            }
        }

        if safe.as_os_str().is_empty() {
            continue;
        }

        let dest = output_dir.join(&safe);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("mkdir {:?}: {}", parent, e))?;
        }

        entry
            .unpack(&dest)
            .map_err(|e| format!("tar unpack {:?}: {}", dest, e))?;
        written.push(safe.to_string_lossy().to_string());
    }

    Ok(written)
}

pub fn is_tar(data: &[u8]) -> bool {
    if data.len() < 263 {
        return false;
    }
    &data[257..262] == b"ustar"
}

pub fn tar_file_list(tar_data: &[u8]) -> Result<Vec<(String, u64)>, String> {
    let mut archive = Archive::new(Cursor::new(tar_data));
    let mut list = Vec::new();
    let entries = archive.entries().map_err(|e| format!("tar entries: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("tar entry: {}", e))?;
        let path = entry
            .path()
            .map_err(|e| format!("tar path: {}", e))?
            .to_string_lossy()
            .to_string();
        let size = entry.size();
        list.push((path, size));
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_tar_roundtrip() {
        let tmp = std::env::temp_dir().join("rox_tar_test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("sub")).unwrap();
        fs::write(tmp.join("hello.txt"), b"Hello TAR").unwrap();
        fs::write(tmp.join("sub/nested.txt"), b"Nested!").unwrap();

        let tar_data = tar_pack_directory(&tmp).unwrap();
        assert!(is_tar(&tar_data));

        let list = tar_file_list(&tar_data).unwrap();
        assert_eq!(list.len(), 2);

        let out = std::env::temp_dir().join("rox_tar_test_out");
        let _ = fs::remove_dir_all(&out);
        fs::create_dir_all(&out).unwrap();

        let written = tar_unpack(&tar_data, &out).unwrap();
        assert_eq!(written.len(), 2);
        assert_eq!(fs::read_to_string(out.join("hello.txt")).unwrap(), "Hello TAR");
        assert_eq!(fs::read_to_string(out.join("sub/nested.txt")).unwrap(), "Nested!");

        let _ = fs::remove_dir_all(&tmp);
        let _ = fs::remove_dir_all(&out);
    }

    #[test]
    fn test_tar_zstd_roundtrip() {
        use std::io::Write;

        let tmp = std::env::temp_dir().join("rox_tar_zstd_test");
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(tmp.join("a/b")).unwrap();
        fs::write(tmp.join("root.txt"), b"root file content").unwrap();
        fs::write(tmp.join("a/mid.txt"), b"mid level").unwrap();
        fs::write(tmp.join("a/b/deep.txt"), b"deep nested file").unwrap();

        let tar_data = tar_pack_directory(&tmp).unwrap();
        assert!(is_tar(&tar_data));

        let mut encoder = zstd::stream::Encoder::new(Vec::new(), 3).unwrap();
        encoder.write_all(&tar_data).unwrap();
        let compressed = encoder.finish().unwrap();

        let decompressed = zstd::stream::decode_all(std::io::Cursor::new(&compressed)).unwrap();
        assert!(is_tar(&decompressed));

        let out = std::env::temp_dir().join("rox_tar_zstd_test_out");
        let _ = fs::remove_dir_all(&out);
        fs::create_dir_all(&out).unwrap();

        let written = tar_unpack(&decompressed, &out).unwrap();
        assert_eq!(written.len(), 3);
        assert_eq!(fs::read_to_string(out.join("root.txt")).unwrap(), "root file content");
        assert_eq!(fs::read_to_string(out.join("a/mid.txt")).unwrap(), "mid level");
        assert_eq!(fs::read_to_string(out.join("a/b/deep.txt")).unwrap(), "deep nested file");

        let _ = fs::remove_dir_all(&tmp);
        let _ = fs::remove_dir_all(&out);
    }
}
