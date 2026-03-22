#![allow(dead_code)]
use clap::{Parser, Subcommand};
use std::fs::File;
use std::io::{Read, Write};

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod core;
mod encoder;
mod packer;
mod crypto;
mod png_utils;
mod audio;
mod reconstitution;
mod archive;

use crate::encoder::ImageFormat;
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
        /// optional zstd dictionary file for payload compression
        #[arg(long, value_name = "FILE")]
        dict: Option<PathBuf>,
    },

    List {
        input: PathBuf,
    },
    Havepassphrase {
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
        /// optional zstd dictionary file to use for compression
        #[arg(long, value_name = "FILE")]
        dict: Option<PathBuf>,
    },
    TrainDict {
        /// sample files used to train the dictionary
        #[arg(short, long, value_name = "FILE", required = true)]
        samples: Vec<PathBuf>,
        /// desired dictionary size in bytes
        #[arg(short, long, default_value_t = 112640)]
        size: usize,
        /// output dictionary file
        output: PathBuf,
    },
    Decompress {
        input: PathBuf,
        output: Option<PathBuf>,
        #[arg(long)]
        files: Option<String>,
        #[arg(short, long)]
        passphrase: Option<String>,
        /// optional dictionary file used during decompression
        #[arg(long, value_name = "FILE")]
        dict: Option<PathBuf>,
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
        Commands::TrainDict { samples, size, output } => {
            let dict = core::train_zstd_dictionary(&samples, size)?;
            write_all(&output, &dict)?;
            println!("wrote {} bytes dictionary to {:?}", dict.len(), output);
            return Ok(());
        }
        Commands::Encode { input, output, level, passphrase, encrypt, name, dict } => {
            let is_dir = input.is_dir();
            let (payload, file_list_json) = if is_dir {
                let tar_data = archive::tar_pack_directory(&input)
                    .map_err(|e| anyhow::anyhow!(e))?;
                let list = archive::tar_file_list(&tar_data)
                    .map_err(|e| anyhow::anyhow!(e))?;
                let json_list: Vec<serde_json::Value> = list.iter()
                    .map(|(name, size)| serde_json::json!({"name": name, "size": size}))
                    .collect();
                (tar_data, Some(serde_json::to_string(&json_list)?))
            } else {
                let pack_result = packer::pack_path_with_metadata(&input)?;
                (pack_result.data, pack_result.file_list_json)
            };

            let file_name = name.as_deref()
                .or_else(|| input.file_name().and_then(|n| n.to_str()));

            let dict_bytes: Option<Vec<u8>> = match dict {
                Some(path) => Some(read_all(&path)?),
                None => None,
            };

            let png = if let Some(ref pass) = passphrase {
                encoder::encode_to_png_with_encryption_name_and_format_and_filelist(
                    &payload,
                    level,
                    Some(pass),
                    Some(&encrypt),
                    ImageFormat::Png,
                    file_name,
                    file_list_json.as_deref(),
                    dict_bytes.as_deref(),
                )?
            } else {
                encoder::encode_to_png_with_encryption_name_and_format_and_filelist(
                    &payload,
                    level,
                    None,
                    None,
                    ImageFormat::Png,
                    file_name,
                    file_list_json.as_deref(),
                    dict_bytes.as_deref(),
                )?
            };

            write_all(&output, &png)?;

            if file_list_json.is_some() {
                if is_dir {
                    println!("(TAR archive, rXFL chunk embedded)");
                } else {
                    println!("(rXFL chunk embedded)");
                }
            }
        }
        Commands::List { input } => {
            let mut file = File::open(&input)?;
            let chunks = png_utils::extract_png_chunks_streaming(&mut file).map_err(|e| anyhow::anyhow!(e))?;

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
        Commands::Havepassphrase { input } => {
            let buf = read_all(&input)?;
            let is_png = buf.len() >= 8 && &buf[0..8] == &[137, 80, 78, 71, 13, 10, 26, 10];
            if is_png {
                let payload = png_utils::extract_payload_from_png(&buf).map_err(|e| anyhow::anyhow!(e))?;
                if !payload.is_empty() && (payload[0] == 0x01 || payload[0] == 0x02) {
                    println!("Passphrase detected.");
                } else {
                    println!("No passphrase detected.");
                }
            } else {
                if !buf.is_empty() && (buf[0] == 0x01 || buf[0] == 0x02) {
                    println!("Passphrase detected.");
                } else {
                    println!("No passphrase detected.");
                }
            }
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
        Commands::Compress { input, output, level, dict } => {
            let buf = read_all(&input)?;
            let dict_bytes: Option<Vec<u8>> = match dict {
                Some(path) => Some(read_all(&path)?),
                None => None,
            };
            let out = crate::core::zstd_compress_bytes(
                &buf,
                level,
                dict_bytes.as_deref(),
            )
            .map_err(|e: String| anyhow::anyhow!(e))?;
            let dest = output.unwrap_or_else(|| PathBuf::from("out.zst"));
            write_all(&dest, &out)?;
        }
        Commands::Decompress { input, output, files, passphrase, dict } => {
            let buf = read_all(&input)?;
            let dict_bytes: Option<Vec<u8>> = match dict {
                Some(path) => Some(read_all(&path)?),
                None => None,
            };
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
                    let mut dec = zstd::stream::Decoder::new(Cursor::new(normalized)).map_err(|e| anyhow::anyhow!("zstd decoder init: {}", e))?;
                    dec.window_log_max(31).map_err(|e| anyhow::anyhow!("zstd window_log_max: {}", e))?;
                    Box::new(dec)
                };

                let out_dir = output.unwrap_or_else(|| PathBuf::from("."));
                std::fs::create_dir_all(&out_dir).map_err(|e| anyhow::anyhow!("Cannot create output directory {:?}: {}", out_dir, e))?;
                let files_slice = file_list.as_ref().map(|v| v.as_slice());

                                let written = packer::unpack_stream_to_dir(&mut reader, &out_dir, files_slice).map_err(|e| anyhow::anyhow!(e))?;
                println!("Unpacked {} files", written.len());
            } else {
                                                let is_png = buf.len() >= 8 && &buf[0..8] == &[137, 80, 78, 71, 13, 10, 26, 10];
                let out_bytes = if is_png {
                    let payload = png_utils::extract_payload_from_png(&buf).map_err(|e| anyhow::anyhow!(e))?;
                    if payload.is_empty() { return Err(anyhow::anyhow!("Empty payload")); }
                    let first = payload[0];
                    if first == 0x00u8 {
                        let compressed = payload[1..].to_vec();
                        match crate::core::zstd_decompress_bytes(&compressed, dict_bytes.as_deref()) {
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
                                let inner = if v.starts_with(b"ROX1") {
                                    v[4..].to_vec()
                                } else {
                                    v
                                };
                                match crate::core::zstd_decompress_bytes(&inner, dict_bytes.as_deref()) {
                                    Ok(mut o) => {
                                        if o.starts_with(b"ROX1") { o = o[4..].to_vec(); }
                                        o
                                    }
                                    Err(_) => inner,
                                }
                            }
                            Err(e) => return Err(anyhow::anyhow!("Encrypted payload: {}", e)),
                        }
                    }
                } else {
                    match crate::core::zstd_decompress_bytes(&buf, dict_bytes.as_deref()) {
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

                if archive::is_tar(&out_bytes) {
                    let out_dir = if dest.extension().is_none() || dest.is_dir() {
                        dest
                    } else {
                        PathBuf::from(".")
                    };
                    std::fs::create_dir_all(&out_dir)
                        .map_err(|e| anyhow::anyhow!("mkdir {:?}: {}", out_dir, e))?;
                    let written = archive::tar_unpack(&out_bytes, &out_dir)
                        .map_err(|e| anyhow::anyhow!(e))?;
                    println!("Unpacked {} files (TAR) to {:?}", written.len(), out_dir);
                } else if out_bytes.len() >= 4
                    && (u32::from_be_bytes(out_bytes[0..4].try_into().unwrap()) == 0x524f5850u32
                        || u32::from_be_bytes(out_bytes[0..4].try_into().unwrap()) == 0x524f5849u32)
                {
                    let out_dir = if dest.extension().is_none() || dest.is_dir() {
                        dest
                    } else {
                        PathBuf::from(".")
                    };
                    std::fs::create_dir_all(&out_dir)
                        .map_err(|e| anyhow::anyhow!("mkdir {:?}: {}", out_dir, e))?;
                    let written = packer::unpack_buffer_to_dir(&out_bytes, &out_dir, None)
                        .map_err(|e| anyhow::anyhow!(e))?;
                    println!("Unpacked {} files to {:?}", written.len(), out_dir);
                } else if dest.is_dir() {
                    let fname = if is_png {
                        png_utils::extract_name_from_png(&buf)
                    } else {
                        None
                    }.unwrap_or_else(|| {
                        input.file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "out.raw".to_string())
                    });
                    write_all(&dest.join(&fname), &out_bytes)?;
                } else {
                    write_all(&dest, &out_bytes)?;
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

