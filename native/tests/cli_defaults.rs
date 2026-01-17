use std::fs;
use std::process::Command;
use tempfile::TempDir;
use std::path::PathBuf;

fn bin_path() -> String {
    "./target/debug/roxify_native".to_string()
}

#[test]
fn test_encode_and_decode_default_single_file() {
    let td = TempDir::new().unwrap();
    let input = td.path().join("file1.txt");
    fs::write(&input, b"hello world").unwrap();

    // Encode without specifying output
    let out = Command::new(bin_path())
        .current_dir(
            std::env::current_dir().unwrap()
        )
        .arg("encode")
        .arg(&input)
        .output()
        .expect("failed to run encode");

    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("--- Encode summary ---"));

    let png_path = input.with_extension("png");
    assert!(png_path.exists());

    // Decode without specifying output; run decode with current_dir = tempdir so default file written there
    let decode_out = Command::new(bin_path())
        .current_dir(td.path())
        .arg("decode")
        .arg(png_path.to_str().unwrap())
        .output()
        .expect("failed to run decode");

    let dstdout = String::from_utf8_lossy(&decode_out.stdout);
    assert!(dstdout.contains("--- Decode summary ---"));

    let decoded = td.path().join("file1.txt");
    assert!(decoded.exists());
    let content = fs::read_to_string(&decoded).unwrap();
    assert_eq!(content, "hello world");
}

#[test]
fn test_encode_and_decode_default_dir() {
    let td = TempDir::new().unwrap();
    let dir = td.path().join("sampdir");
    std::fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("a.txt"), b"A").unwrap();
    fs::write(dir.join("b.txt"), b"B").unwrap();

    // Encode directory without output -> should create sampdir.png
    let out = Command::new(bin_path())
        .arg("encode")
        .arg(&dir)
        .output()
        .expect("failed to run encode dir");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("--- Encode summary ---"));

    let png_path = PathBuf::from("sampdir.png");
    assert!(png_path.exists());

    // Decode without output -> should create directory 'sampdir' in current dir
    // remove any existing out dir
    let _ = std::fs::remove_dir_all("sampdir");
    let dout = Command::new(bin_path())
        .arg("decode")
        .arg(png_path.to_str().unwrap())
        .output()
        .expect("failed to run decode dir");
    let dstdout = String::from_utf8_lossy(&dout.stdout);
    assert!(dstdout.contains("--- Decode summary ---"));

    let out_dir = PathBuf::from("sampdir");
    assert!(out_dir.exists());
    assert!(out_dir.join("a.txt").exists());
    assert!(out_dir.join("b.txt").exists());
}
