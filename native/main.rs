use clap::{Parser, Subcommand};
use std::fs::File;
use std::io::{Read, Write};

mod core;
use std::path::PathBuf;

#[derive(Parser)]
#[command(author, version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
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
        Commands::Decompress { input, output } => {
            let buf = read_all(&input)?;
            let out = crate::core::zstd_decompress_bytes(&buf).map_err(|e: String| anyhow::anyhow!(e))?;
            let dest = output.unwrap_or_else(|| PathBuf::from("out.raw"));
            write_all(&dest, &out)?;
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

