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
    if len < INPUT_DROP_GRANULARITY {
        return;
    }

    // Note: file.sync_data() (fdatasync) was removed in v1.16.6+
    // Rationale: for decode operations, the source file remains intact on failure,
    // and the fsync() syscall blocks for 1-5ms per call, causing significant
    // throughput degradation on workloads with many files >8MB.
    advise_drop(file, 0, len);
}