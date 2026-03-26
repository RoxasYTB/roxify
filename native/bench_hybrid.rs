use std::time::Instant;

mod rans_byte;
mod bwt;
mod mtf;
mod context_mixing;
mod pool;
mod hybrid;

fn bench_roundtrip(name: &str, data: &[u8]) {
    let compressor = hybrid::HybridCompressor::new(false, 4);

    let start = Instant::now();
    let (compressed, stats) = compressor.compress(data).unwrap();
    let compress_time = start.elapsed();

    let start = Instant::now();
    let decompressed = compressor.decompress(&compressed).unwrap();
    let decompress_time = start.elapsed();

    let ratio = (compressed.len() as f64) / (data.len() as f64) * 100.0;
    let compress_mbps = (data.len() as f64 / 1_048_576.0) / compress_time.as_secs_f64();
    let decompress_mbps = (data.len() as f64 / 1_048_576.0) / decompress_time.as_secs_f64();

    assert_eq!(decompressed, data, "ROUND-TRIP FAILED for {}", name);

    println!("=== {} ===", name);
    println!("  Input:       {} bytes", data.len());
    println!("  Compressed:  {} bytes ({:.1}%)", compressed.len(), ratio);
    println!("  Reduction:   {:.1}%", 100.0 - ratio);
    println!("  Compress:    {:.1} ms ({:.1} MB/s)", compress_time.as_secs_f64() * 1000.0, compress_mbps);
    println!("  Decompress:  {:.1} ms ({:.1} MB/s)", decompress_time.as_secs_f64() * 1000.0, decompress_mbps);
    println!("  Entropy:     {:.2} bits/byte", stats.entropy_bits);
    println!();
}

fn bench_zstd(name: &str, data: &[u8], level: i32) {
    let start = Instant::now();
    let compressed = zstd::encode_all(std::io::Cursor::new(data), level).unwrap();
    let compress_time = start.elapsed();

    let start = Instant::now();
    let decompressed = zstd::decode_all(std::io::Cursor::new(&compressed)).unwrap();
    let decompress_time = start.elapsed();

    let ratio = (compressed.len() as f64) / (data.len() as f64) * 100.0;
    let compress_mbps = (data.len() as f64 / 1_048_576.0) / compress_time.as_secs_f64();
    let decompress_mbps = (data.len() as f64 / 1_048_576.0) / decompress_time.as_secs_f64();

    assert_eq!(decompressed, data);

    println!("=== Zstd L{} ({}) ===", level, name);
    println!("  Compressed:  {} bytes ({:.1}%)", compressed.len(), ratio);
    println!("  Reduction:   {:.1}%", 100.0 - ratio);
    println!("  Compress:    {:.1} ms ({:.1} MB/s)", compress_time.as_secs_f64() * 1000.0, compress_mbps);
    println!("  Decompress:  {:.1} ms ({:.1} MB/s)", decompress_time.as_secs_f64() * 1000.0, decompress_mbps);
    println!();
}

fn main() {
    println!("╔══════════════════════════════════════════════════════════╗");
    println!("║     ROXIFY BWT-ANS COMPRESSION BENCHMARK               ║");
    println!("╚══════════════════════════════════════════════════════════╝\n");

    let text_1k: Vec<u8> = "Hello World! This is a test of the roxify compression engine. ".repeat(16).into_bytes();
    bench_roundtrip("Text 1KB", &text_1k);
    bench_zstd("Text 1KB", &text_1k, 3);
    bench_zstd("Text 1KB", &text_1k, 19);

    let text_100k: Vec<u8> = "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. ".repeat(1200).into_bytes();
    bench_roundtrip("Text 100KB", &text_100k);
    bench_zstd("Text 100KB", &text_100k, 3);
    bench_zstd("Text 100KB", &text_100k, 19);

    let text_1m: Vec<u8> = {
        let mut data = Vec::with_capacity(1_048_576);
        let phrases = [
            b"Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".as_slice(),
            b"Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ".as_slice(),
            b"Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. ".as_slice(),
            b"Duis aute irure dolor in reprehenderit in voluptate velit esse. ".as_slice(),
            b"Excepteur sint occaecat cupidatat non proident, sunt in culpa. ".as_slice(),
        ];
        let mut i = 0;
        while data.len() < 1_048_576 {
            data.extend_from_slice(phrases[i % phrases.len()]);
            i += 1;
        }
        data.truncate(1_048_576);
        data
    };
    bench_roundtrip("Text 1MB", &text_1m);
    bench_zstd("Text 1MB", &text_1m, 3);
    bench_zstd("Text 1MB", &text_1m, 19);

    let json_data: Vec<u8> = {
        let mut data = String::with_capacity(512_000);
        data.push('[');
        for i in 0..5000 {
            if i > 0 { data.push(','); }
            data.push_str(&format!(
                r#"{{"id":{},"name":"user_{}","email":"user{}@example.com","active":{},"score":{:.2},"tags":["tag1","tag2","tag3"]}}"#,
                i, i, i, i % 2 == 0, (i as f64) * 1.337
            ));
        }
        data.push(']');
        data.into_bytes()
    };
    bench_roundtrip("JSON 500KB", &json_data);
    bench_zstd("JSON 500KB", &json_data, 3);
    bench_zstd("JSON 500KB", &json_data, 19);

    let random_data: Vec<u8> = {
        let mut data = vec![0u8; 100_000];
        let mut state = 12345u64;
        for b in data.iter_mut() {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            *b = (state >> 33) as u8;
        }
        data
    };
    bench_roundtrip("Random 100KB", &random_data);
    bench_zstd("Random 100KB", &random_data, 3);

    let binary_data: Vec<u8> = {
        let mut data = Vec::with_capacity(256_000);
        for i in 0..256_000u32 {
            match i % 7 {
                0 => data.push(0),
                1 => data.push(0xFF),
                2 => data.push((i & 0xFF) as u8),
                3 => data.push(((i >> 8) & 0xFF) as u8),
                4 => data.push(b'A' + (i % 26) as u8),
                5 => data.push(0x20),
                _ => data.push((i.wrapping_mul(37) & 0xFF) as u8),
            }
        }
        data
    };
    bench_roundtrip("Binary 256KB", &binary_data);
    bench_zstd("Binary 256KB", &binary_data, 3);
    bench_zstd("Binary 256KB", &binary_data, 19);

    println!("All round-trip tests PASSED!");
}
