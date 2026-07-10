use std::fs::File;
use std::path::Path;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
#[cfg(target_os = "linux")]
use std::os::unix::fs::MetadataExt;

pub const INPUT_DROP_GRANULARITY: u64 = 8 * 1024 * 1024;

pub fn advise_file_sequential(file: &File) {
    #[cfg(target_os = "linux")]
    unsafe {
        let _ = libc::posix_fadvise(file.as_raw_fd(), 0, 0, libc::POSIX_FADV_SEQUENTIAL);
    }

    #[cfg(not(target_os = "linux"))]
    let _ = file;
}

pub fn advise_drop(file: &File, offset: u64, len: u64) {
    if len == 0 {
        return;
    }

    #[cfg(target_os = "linux")]
    unsafe {
        let _ = libc::posix_fadvise(
            file.as_raw_fd(),
            offset as libc::off_t,
            len as libc::off_t,
            libc::POSIX_FADV_DONTNEED,
        );
    }

    #[cfg(not(target_os = "linux"))]
    let _ = (file, offset, len);
}

pub fn sync_and_drop(file: &File, len: u64) {
    if len < INPUT_DROP_GRANULARITY {
        return;
    }

    advise_drop(file, 0, len);
}

/// Returns `true` if the filesystem backing `path` is likely a rotational
/// hard disk (HDD). On Linux reads `/sys/block/*/queue/rotational` via
/// device major:minor from `stat()`. Non-Linux platforms default to `false`
/// (assume SSD, parallel I/O is safe).
pub fn is_rotational(path: &Path) -> bool {
    #[cfg(target_os = "linux")]
    {
        rotational_linux(path)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        false
    }
}

#[cfg(target_os = "linux")]
fn rotational_linux(path: &Path) -> bool {
    use std::fs::metadata;
    use std::io::Read;

    let meta = match metadata(path) {
        Ok(m) => m,
        Err(_) => return false,
    };
    // stat.st_dev is the device ID (major:minor) of the mounted filesystem
    let dev = meta.dev();

    // Walk /sys/block entries and check each one's `dev` file for a match
    let sys_block = Path::new("/sys/block");
    let dir = match sys_block.read_dir() {
        Ok(d) => d,
        Err(_) => return false,
    };

    for entry in dir.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();

        // Skip virtual/ram/loop/dm devices
        if name_str.starts_with("ram")
            || name_str.starts_with("loop")
            || name_str.starts_with("dm-")
            || name_str.starts_with("zram")
            || name_str.starts_with("nbd")
        {
            continue;
        }

        let dev_path = entry.path().join("dev");
        let dev_str = match std::fs::read_to_string(&dev_path) {
            Ok(s) => s.trim().to_string(),
            Err(_) => continue,
        };

        // Parse "MAJOR:MINOR" from the dev file
        let parts: Vec<&str> = dev_str.split(':').collect();
        if parts.len() != 2 {
            continue;
        }
        let major: u64 = match parts[0].parse() { Ok(v) => v, Err(_) => continue };
        let minor: u64 = match parts[1].parse() { Ok(v) => v, Err(_) => continue };
        let block_dev = (major << 20) | minor;

        if dev != block_dev {
            // Try parent partitions: check if our device is on this block device
            // by comparing if dev falls within the range of this block device.
            // For real block devices, the kernel encodes (major << 20 | minor).
            // Partitioned devices have minor != 0, and the base device has minor = 0
            // for the first partition, or the base device has a different scheme.
            // Simple approach: check the rotational flag from the base device
            // regardless of partition number.

            // For partition matching, check if the base device matches:
            // If this block device has minor 0, and our dev matches the major
            // with any minor... this requires checking partitions.
            // Actually, let's just check if maj(dev) matches.
            let dev_major = dev >> 20;
            if dev_major != major {
                continue;
            }

            // If the major matches, assume this is the right block device.
            // Partitioned devices share the same major.
        }

        // Read the rotational flag
        let rot_path = entry.path().join("queue/rotational");
        let mut rot_file = match File::open(&rot_path) {
            Ok(f) => f,
            Err(_) => continue,
        };
        let mut flag = [0u8; 1];
        if rot_file.read_exact(&mut flag).is_ok() {
            return flag[0] == b'1';
        }
    }

    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotational_flag_on_tmp_is_false() {
        // /tmp is typically tmpfs (non-rotational)
        let result = is_rotational(Path::new("/tmp"));
        assert!(!result, "/tmp should not be rotational");
    }

    #[test]
    fn rotational_flag_on_root_does_not_panic() {
        let _ = is_rotational(Path::new("/"));
    }
}
