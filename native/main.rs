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
        output: PathBuf,
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
            let pack_result = packer::pack_path_with_metadata(&input)?;

            let file_name = name.as_deref()
                .or_else(|| input.file_name().and_then(|n| n.to_str()));

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

            write_all(&output, &png)?;

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
        Commands::Decompress { input, output, files } => {
            let buf = read_all(&input)?;
            // If files parameter is specified, extract only those files from a PNG/pack
            if let Some(files_str) = files {
                // parse file list: JSON array or comma-separated
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

                // detect PNG
                let is_png = buf.len() >= 8 && &buf[0..8] == &[137, 80, 78, 71, 13, 10, 26, 10];
                let pack_bytes: Vec<u8> = if is_png {
                    // extract payload from PNG
                    let payload = png_utils::extract_payload_from_png(&buf).map_err(|e| anyhow::anyhow!(e))?;
                    if payload.is_empty() { return Err(anyhow::anyhow!("Empty payload")); }
                    // payload format: [enc_flag?]... encoder may prefix ENC_NONE (0x00)
                    // Support only ENC_NONE (0x00) for now
                    let first = payload[0];
                    if first == 0x00u8 {
                        let compressed = payload[1..].to_vec();

                        // Try zstd decompress, with helpful diagnostics and fallback.
                        match crate::core::zstd_decompress_bytes(&compressed) {
                            Ok(mut out) => {
                                if out.starts_with(b"ROX1") {
                                    out = out[4..].to_vec();
                                }
                                out
                            }
                            Err(e) => {
                                // Detect common cases to provide clearer errors or fallbacks
                                let zstd_magic = [0x28u8, 0xB5, 0x2F, 0xFD];
                                let starts_zstd = compressed.len() >= 4 && &compressed[0..4] == &zstd_magic;
                                let first_bytes: String = compressed.iter().take(16).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join("");

                                // If the payload already looks like an uncompressed pack (ROX1), accept it
                                if compressed.starts_with(b"ROX1") {
                                    eprintln!("⚠️ zstd decompress failed ({}), but payload starts with ROX1: falling back to raw pack", e);
                                    // Strip magic now (packer expects raw pack without leading ROX1)
                                    let mut out = compressed[4..].to_vec();
                                    out
                                } else {
                                    let msg = format!("zstd decompress error: {}. compressed_len={} starts_zstd={} first16=0x{}", e, compressed.len(), starts_zstd, first_bytes);
                                    return Err(anyhow::anyhow!(msg));
                                }
                            }
                        }
                    } else {
                        return Err(anyhow::anyhow!("Encrypted payloads are not supported by native --files option"));
                    }
                } else {
                    // not a PNG: try zstd decompress, else treat as raw pack
                    match crate::core::zstd_decompress_bytes(&buf) {
                        Ok(mut x) => {
                            if x.starts_with(b"ROX1") {
                                x = x[4..].to_vec();
                            }
                            x
                        },
                        Err(e) => {
                            // Provide diagnostics and fallback if the buffer already looks like a pack
                            if buf.starts_with(b"ROX1") {
                                eprintln!("⚠️ zstd decompress failed ({}), but input already starts with ROX1: using raw pack", e);
                                buf[4..].to_vec()
                            } else {
                                let first_bytes: String = buf.iter().take(16).map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join("");
                                let msg = format!("zstd decompress error: {}. input_len={} first16=0x{}", e, buf.len(), first_bytes);
                                return Err(anyhow::anyhow!(msg));
                            }
                        }
                    }
                };

                let out_dir = output.unwrap_or_else(|| PathBuf::from("."));
                std::fs::create_dir_all(&out_dir).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_dir, e))?;
                let files_slice = file_list.as_ref().map(|v| v.as_slice());
                let written = packer::unpack_buffer_to_dir(&pack_bytes, &out_dir, files_slice).map_err(|e| anyhow::anyhow!(e))?;
                println!("Unpacked {} files", written.len());
            } else {
                // old behaviour: decompress all to a single raw file
                // If input is a PNG, extract payload first (handles payload-in-pixels case)
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
                        return Err(anyhow::anyhow!("Encrypted payloads are not supported by native decompress"));
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

