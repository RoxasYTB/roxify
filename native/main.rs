use clap::{Parser, Subcommand};
use std::fs::File;
use std::io::{Read, Write};

mod core;
mod encoder;
mod packer;
mod crypto;
mod png_utils;
mod reconstitution;
use std::path::PathBuf;

#[derive(Parser)]
#[command(author, version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Encode {
        input: PathBuf,
        output: Option<PathBuf>,
        #[arg(short, long, default_value_t = 3)]
        level: i32,
        #[arg(short, long)]
        passphrase: Option<String>,
        #[arg(short, long, default_value = "aes")]
        encrypt: String,
        #[arg(short, long)]
        name: Option<String>,
    },
    List {
        input: PathBuf,
    },
    Scan {
        input: PathBuf,
        #[arg(short, long, value_name = "FILE")]
        #[arg(short, long, default_value_t = 4)]
        channels: usize,
        #[arg(short, long, value_delimiter = ',')]
        markers: Vec<String>,
    },
    DeltaEncode {
        input: PathBuf,
        output: Option<PathBuf>,
    },
    DeltaDecode {
        input: PathBuf,
        output: Option<PathBuf>,
    },
    Compress {
        input: PathBuf,
        output: Option<PathBuf>,
        #[arg(short, long, default_value_t = 19)]
        level: i32,
    },
    Decompress {
        input: PathBuf,
        output: Option<PathBuf>,
        #[arg(long)]
        files: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Decode {
        input: PathBuf,
        output: Option<PathBuf>,
        #[arg(short, long)]
        passphrase: Option<String>,
    },
    Crc32 {
        input: PathBuf,
    },
    Adler32 {
        input: PathBuf,
    },
}

fn read_all(path: &PathBuf) -> anyhow::Result<Vec<u8>> {
    let mut f = File::open(path)?;
    let mut buf = Vec::new();
    f.read_to_end(&mut buf)?;
    Ok(buf)
}

fn write_all(path: &PathBuf, data: &[u8]) -> anyhow::Result<()> {
    let mut f = File::create(path)?;
    f.write_all(data)?;
    Ok(())
}

fn parse_markers(v: &[String]) -> Option<Vec<u8>> {
    if v.is_empty() {
        return None;
    }
    let mut out = Vec::new();
    for s in v {
        let parts: Vec<&str> = s.split(|c| c == ':' || c == ',' ).collect();
        if parts.len() >= 3 {
            if let (Ok(r), Ok(g), Ok(b)) = (parts[0].parse::<u8>(), parts[1].parse::<u8>(), parts[2].parse::<u8>()) {
                out.push(r); out.push(g); out.push(b);
            }
        }
    }
    if out.is_empty() { None } else { Some(out) }
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Encode { input, output, level, passphrase, encrypt, name } => {
            use std::time::Instant;
            let start_pack = Instant::now();
            let pack_result = packer::pack_path_with_metadata(&input)?;
            let pack_time = start_pack.elapsed();

            let file_name = name.as_deref()
                .or_else(|| input.file_name().and_then(|n| n.to_str()));

            let enc_type = if passphrase.is_some() { Some(encrypt.clone()) } else { None };

            let start_encode = Instant::now();
            let png = if let Some(ref pass) = passphrase {
                encoder::encode_to_png_with_encryption_name_and_filelist(
                    &pack_result.data,
                    level,
                    Some(pass),
                    Some(&encrypt),
                    file_name,
                    pack_result.file_list_json.as_deref()
                )?
            } else {
                encoder::encode_to_png_with_name_and_filelist(
                    &pack_result.data,
                    level,
                    file_name,
                    pack_result.file_list_json.as_deref()
                )?
            };
            let encode_time = start_encode.elapsed();

            // Determine default output path if none provided
            let out_path: PathBuf = match output.clone() {
                Some(p) => p,
                None => {
                    // If input is a file, use same path with .png extension
                    if input.is_file() {
                        input.with_extension("png")
                    } else if input.is_dir() {
                        // For directories, create <dir>.png next to dir
                        input.with_extension("png")
                    } else {
                        // Fallback: use file name or 'out.png'
                        let stem = input.file_name().and_then(|n| n.to_str()).unwrap_or("out");
                        PathBuf::from(format!("{}.png", stem))
                    }
                }
            };

            let start_write = Instant::now();
            write_all(&out_path, &png)?;
            let write_time = start_write.elapsed();

            // Output a concise, pretty summary
            println!("--- Encode summary ---");
            println!("input: {:?}", input);
            println!("output: {:?}", out_path);
            println!("files_list: {}", if pack_result.file_list_json.is_some() { "embedded" } else { "none" });
            println!("encrypt: {}", enc_type.clone().unwrap_or_else(|| "none".to_string()));
            println!("original_size: {} bytes", pack_result.data.len());
            println!("png_size: {} bytes", png.len());
            if pack_result.data.len() > 0 {
                println!("ratio: {:.2}%", 100.0 * (1.0 - (png.len() as f64 / pack_result.data.len() as f64)));
            }
            println!("pack_time_ms: {}", pack_time.as_millis());
            println!("encode_time_ms: {}", encode_time.as_millis());
            println!("write_time_ms: {}", write_time.as_millis());

            if pack_result.file_list_json.is_some() {
                println!("(rXFL chunk embedded)");
            }
        }
        Commands::List { input } => {
            let buf = read_all(&input)?;
            let chunks = png_utils::extract_png_chunks(&buf).map_err(|e| anyhow::anyhow!(e))?;

            if let Some(rxfl_chunk) = chunks.iter().find(|c| c.name == "rXFL") {
                println!("{}", String::from_utf8_lossy(&rxfl_chunk.data));
                return Ok(());
            }

            if let Some(meta_chunk) = chunks.iter().find(|c| c.name == "rOXm") {
                if let Some(pos) = meta_chunk.data.windows(4).position(|w| w == b"rXFL") {
                    if pos + 8 <= meta_chunk.data.len() {
                        let json_len = u32::from_be_bytes([
                            meta_chunk.data[pos + 4],
                            meta_chunk.data[pos + 5],
                            meta_chunk.data[pos + 6],
                            meta_chunk.data[pos + 7],
                        ]) as usize;

                        let json_start = pos + 8;
                        let json_end = json_start + json_len;

                        if json_end <= meta_chunk.data.len() {
                            println!("{}", String::from_utf8_lossy(&meta_chunk.data[json_start..json_end]));
                            return Ok(());
                        }
                    }
                }
            }

            eprintln!("No file list found in PNG");
            std::process::exit(1);
        }
        Commands::Scan { input, channels, markers } => {
            let buf = read_all(&input)?;
            let marker_bytes = parse_markers(&markers);
            let res = crate::core::scan_pixels_bytes(&buf, channels, marker_bytes.as_deref());
            println!("magic_positions: {:?}", res.magic_positions);
            println!("marker_positions: {:?}", res.marker_positions);
        }
        Commands::DeltaEncode { input, output } => {
            let buf = read_all(&input)?;
            let out = crate::core::delta_encode_bytes(&buf);
            let dest = output.unwrap_or_else(|| PathBuf::from("delta.bin"));
            write_all(&dest, &out)?;
        }
        Commands::DeltaDecode { input, output } => {
            let buf = read_all(&input)?;
            let out = crate::core::delta_decode_bytes(&buf);
            let dest = output.unwrap_or_else(|| PathBuf::from("raw.bin"));
            write_all(&dest, &out)?;
        }
        Commands::Compress { input, output, level } => {
            let buf = read_all(&input)?;
            let out = crate::core::zstd_compress_bytes(&buf, level).map_err(|e: String| anyhow::anyhow!(e))?;
            let dest = output.unwrap_or_else(|| PathBuf::from("out.zst"));
            write_all(&dest, &out)?;
        }
        Commands::Decompress { input, output, files, passphrase } => {
            let buf = read_all(&input)?;
                        if let Some(files_str) = files {
                                let file_list: Option<Vec<String>> = if files_str.trim_start().starts_with('[') {
                    match serde_json::from_str::<Vec<String>>(&files_str) {
                        Ok(v) => Some(v),
                        Err(e) => {
                            eprintln!("Invalid JSON for --files: {}", e);
                            std::process::exit(1);
                        }
                    }
                } else {
                    let list = files_str.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect::<Vec<_>>();
                    Some(list)
                };

                                let is_png = buf.len() >= 8 && &buf[0..8] == &[137, 80, 78, 71, 13, 10, 26, 10];

                                use std::io::Cursor;
                let normalized: Vec<u8> = if is_png {
                    let payload = png_utils::extract_payload_from_png(&buf).map_err(|e| anyhow::anyhow!(e))?;
                    if payload.is_empty() { return Err(anyhow::anyhow!("Empty payload")); }
                    if payload[0] == 0x00u8 {
                        payload[1..].to_vec()
                    } else {
                                                let pass = passphrase.as_ref().map(|s: &String| s.as_str());
                        match crate::crypto::try_decrypt(&payload, pass) {
                            Ok(v) => v,
                            Err(e) => return Err(anyhow::anyhow!("Encrypted payload: {}", e)),
                        }
                    }
                } else {
                                        if buf[0] == 0x00u8 {
                        buf[1..].to_vec()
                    } else if buf.starts_with(b"ROX1") {
                        buf[4..].to_vec()
                    } else if buf[0] == 0x01u8 || buf[0] == 0x02u8 {
                        let pass = passphrase.as_ref().map(|s: &String| s.as_str());
                        match crate::crypto::try_decrypt(&buf, pass) {
                            Ok(v) => v,
                            Err(e) => return Err(anyhow::anyhow!("Encrypted payload: {}", e)),
                        }
                    } else {
                                                buf.to_vec()
                    }
                };

                                                let mut reader: Box<dyn std::io::Read> = if normalized.starts_with(b"ROX1") {
                    Box::new(Cursor::new(normalized[4..].to_vec()))
                } else {
                    let dec = zstd::stream::Decoder::new(Cursor::new(normalized)).map_err(|e| anyhow::anyhow!("zstd decoder init: {}", e))?;
                    Box::new(dec)
                };

                let out_dir = output.clone().unwrap_or_else(|| PathBuf::from("."));
                std::fs::create_dir_all(&out_dir).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_dir, e))?;
                let files_slice = file_list.as_ref().map(|v| v.as_slice());

                                let written = packer::unpack_stream_to_dir(&mut reader, &out_dir, files_slice).map_err(|e| anyhow::anyhow!(e))?;
                println!("Unpacked {} files", written.len());


                                                let is_png = buf.len() >= 8 && &buf[0..8] == &[137, 80, 78, 71, 13, 10, 26, 10];
                let out_bytes = if is_png {
                    let payload = png_utils::extract_payload_from_png(&buf).map_err(|e| anyhow::anyhow!(e))?;
                    if payload.is_empty() { return Err(anyhow::anyhow!("Empty payload")); }
                    let first = payload[0];
                    if first == 0x00u8 {
                        let compressed = payload[1..].to_vec();
                        match crate::core::zstd_decompress_bytes(&compressed) {
                            Ok(mut o) => {
                                if o.starts_with(b"ROX1") { o = o[4..].to_vec(); }
                                o
                            }
                            Err(e) => {
                                if compressed.starts_with(b"ROX1") {
                                    eprintln!("⚠️ zstd decompress failed ({}), but payload starts with ROX1: falling back to raw pack", e);
                                    compressed[4..].to_vec()
                                } else {
                                    return Err(anyhow::anyhow!("zstd decompress error: {}", e));
                                }
                            }
                        }
                    } else {
                                                let pass = passphrase.as_ref().map(|s| s.as_str());
                        match crate::crypto::try_decrypt(&payload, pass) {
                            Ok(v) => {
                                if v.starts_with(b"ROX1") {
                                                                        v[4..].to_vec()
                                } else {
                                                                        v
                                }
                            }
                            Err(e) => return Err(anyhow::anyhow!("Encrypted payload: {}", e)),
                        }
                    }
                } else {
                    match crate::core::zstd_decompress_bytes(&buf) {
                        Ok(mut x) => { if x.starts_with(b"ROX1") { x = x[4..].to_vec(); } x },
                        Err(e) => {
                            if buf.starts_with(b"ROX1") {
                                eprintln!("⚠️ zstd decompress failed ({}), but input already starts with ROX1: using raw pack", e);
                                buf[4..].to_vec()
                            } else {
                                return Err(anyhow::anyhow!("zstd decompress error: {}", e));
                            }
                        }
                    }
                };

                let dest = output.unwrap_or_else(|| PathBuf::from("out.raw"));
                write_all(&dest, &out_bytes)?;
            }
        }
        Commands::Decode { input, output, passphrase } => {
            let buf = read_all(&input)?;
            let chunks = png_utils::extract_png_chunks(&buf).map_err(|e| anyhow::anyhow!(e))?;
            let rxfl = chunks.iter().find(|c| c.name == "rXFL").ok_or_else(|| anyhow::anyhow!("No file list found in PNG"))?;
            let json_str = String::from_utf8_lossy(&rxfl.data).to_string();
            let list_val: serde_json::Value = serde_json::from_str(&json_str).map_err(|e| anyhow::anyhow!("Invalid rXFL JSON: {}", e))?;
            let mut files_vec: Vec<String> = Vec::new();
            if let serde_json::Value::Array(arr) = list_val {
                for item in arr.iter() {
                    if let Some(name) = item.get("name").and_then(|n| n.as_str()) {
                        files_vec.push(name.to_string());
                    } else if let Some(s) = item.as_str() {
                        files_vec.push(s.to_string());
                    }
                }
            }
            if files_vec.is_empty() { return Err(anyhow::anyhow!("No files found in rXFL chunk")); }

            use std::io::Cursor;
            let payload = png_utils::extract_payload_from_png(&buf).map_err(|e| anyhow::anyhow!(e))?;
            if payload.is_empty() { return Err(anyhow::anyhow!("Empty payload")); }
            let normalized: Vec<u8> = if payload[0] == 0x00u8 {
                payload[1..].to_vec()
            } else {
                let pass = passphrase.as_ref().map(|s: &String| s.as_str());
                match crate::crypto::try_decrypt(&payload, pass) {
                    Ok(v) => v,
                    Err(e) => return Err(anyhow::anyhow!("Encrypted payload: {}", e)),
                }
            };

            use std::time::Instant;

            // Determine output base: if user provides it, use it; otherwise pick sensible defaults.
            let out_base: PathBuf = match output.clone() {
                Some(p) => p,
                None => {
                    if files_vec.len() == 1 {
                        // default: write the single file into CWD with its original name
                        PathBuf::from(&files_vec[0])
                    } else {
                        // default: create a directory named after the PNG stem
                        let stem = input.file_stem().and_then(|s| s.to_str()).unwrap_or("out");
                        PathBuf::from(stem)
                    }
                }
            };

            let start_decode = Instant::now();

            // If normalized starts with ROX1, the inner payload (normalized[4..]) can be either:
            // - a pack archive (starts with pack magic 0x524F5850) -> use unpack_stream_to_dir
            // - a single raw file payload (just the file bytes) -> write directly to disk using the name from rXFL
            if normalized.starts_with(b"ROX1") {
                let inner = &normalized[4..];
                // pack magic: 0x524F5850
                if inner.len() >= 4 && &inner[0..4] == &[0x52, 0x4F, 0x58, 0x50] {
                    let mut reader: Box<dyn std::io::Read> = Box::new(Cursor::new(inner.to_vec()));
                    std::fs::create_dir_all(&out_base).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_base, e))?;
                    let files_slice = Some(files_vec.as_slice());
                    let written = packer::unpack_stream_to_dir(&mut reader, &out_base, files_slice).map_err(|e| anyhow::anyhow!(e))?;
                    let decode_time = start_decode.elapsed();
                    println!("--- Decode summary ---");
                    println!("input: {:?}", input);
                    println!("output_dir: {:?}", out_base);
                    println!("unpacked_files: {}", written.len());
                    println!("decode_time_ms: {}", decode_time.as_millis());
                    println!("Wrote {} files into {}", written.len(), out_base.display());
                } else if files_vec.len() == 1 {
                    // out_base may be a directory or a file path. If it's an existing directory or ends with a separator, write into it.
                    if out_base.exists() && out_base.is_dir() {
                        std::fs::create_dir_all(&out_base).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_base, e))?;
                        let out_path = out_base.join(&files_vec[0]);
                        std::fs::write(&out_path, inner).map_err(|e| anyhow::anyhow!("Cannot write file {:?}: {}", out_path, e))?;
                        let decode_time = start_decode.elapsed();
                        println!("--- Decode summary ---");
                        println!("input: {:?}", input);
                        println!("output: {:?}", out_path);
                        println!("decode_time_ms: {}", decode_time.as_millis());
                        println!("Wrote {}", out_path.display());
                    } else {
                        // treat out_base as a file path
                        if let Some(parent) = out_base.parent() {
                            if !parent.as_os_str().is_empty() {
                                std::fs::create_dir_all(parent).map_err(|e| anyhow::anyhow!("Cannot create parent directory {:?}: {}", parent, e))?;
                            }
                        }
                        std::fs::write(&out_base, inner).map_err(|e| anyhow::anyhow!("Cannot write file {:?}: {}", out_base, e))?;
                        let decode_time = start_decode.elapsed();
                        println!("--- Decode summary ---");
                        println!("input: {:?}", input);
                        println!("output: {:?}", out_base);
                        println!("decode_time_ms: {}", decode_time.as_millis());
                        println!("Wrote {}", out_base.display());
                    }
                } else {
                    return Err(anyhow::anyhow!("Payload is not a pack archive and multiple files requested"));
                }
            } else {
                // Not starting with ROX1: attempt zstd decompress and try unpacking as archive
                let dec = zstd::stream::Decoder::new(Cursor::new(normalized.clone())).map_err(|e| anyhow::anyhow!("zstd decoder init: {}", e))?;
                let mut buf = Vec::new();
                use std::io::Read as _;
                let mut dec_reader = dec;
                dec_reader.read_to_end(&mut buf).map_err(|e| anyhow::anyhow!("zstd decompress error: {}", e))?;
                if buf.starts_with(b"ROX1") {
                    let inner = &buf[4..];
                    if inner.len() >= 4 && &inner[0..4] == &[0x52, 0x4F, 0x58, 0x50] {
                        let mut reader: Box<dyn std::io::Read> = Box::new(Cursor::new(inner.to_vec()));
                        std::fs::create_dir_all(&out_base).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_base, e))?;
                        let files_slice = Some(files_vec.as_slice());
                        let written = packer::unpack_stream_to_dir(&mut reader, &out_base, files_slice).map_err(|e| anyhow::anyhow!(e))?;
                        let decode_time = start_decode.elapsed();
                        println!("--- Decode summary ---");
                        println!("input: {:?}", input);
                        println!("output_dir: {:?}", out_base);
                        println!("unpacked_files: {}", written.len());
                        println!("decode_time_ms: {}", decode_time.as_millis());
                    } else if files_vec.len() == 1 {
                        if out_base.exists() && out_base.is_dir() {
                            std::fs::create_dir_all(&out_base).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_base, e))?;
                            let out_path = out_base.join(&files_vec[0]);
                            std::fs::write(&out_path, &inner).map_err(|e| anyhow::anyhow!("Cannot write file {:?}: {}", out_path, e))?;
                            println!("Wrote {}", out_path.display());
                        } else {
                            if let Some(parent) = out_base.parent() {
                                if !parent.as_os_str().is_empty() {
                                    std::fs::create_dir_all(parent).map_err(|e| anyhow::anyhow!("Cannot create parent directory {:?}: {}", parent, e))?;
                                }
                            }
                            std::fs::write(&out_base, &inner).map_err(|e| anyhow::anyhow!("Cannot write file {:?}: {}", out_base, e))?;
                            println!("Wrote {}", out_base.display());
                        }
                    } else {
                        return Err(anyhow::anyhow!("Payload is not a pack archive and multiple files requested"));
                    }
                } else {
                    return Err(anyhow::anyhow!("Payload does not contain ROX1 header or a valid pack"));
                }
            }
        }
        Commands::Crc32 { input } => {
            let buf = read_all(&input)?;
            println!("crc32: {}", crate::core::crc32_bytes(&buf));
        }
        Commands::Adler32 { input } => {
            let buf = read_all(&input)?;
            println!("adler32: {}", crate::core::adler32_bytes(&buf));
        }
    }
    Ok(())
}

