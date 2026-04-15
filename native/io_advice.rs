use std::fs::File;
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;

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
    if len == 0 {
        return;
    }

    let _ = file.sync_data();
    advise_drop(file, 0, len);
}