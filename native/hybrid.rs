use anyhow::Result;
use rayon::prelude::*;
use crate::bwt::{bwt_encode, bwt_decode};
use crate::mtf::{mtf_encode, mtf_decode, rle0_encode, rle0_decode};
use crate::rans_byte::{SymbolStats, rans_encode_block, rans_decode_block};
use crate::context_mixing::analyze_entropy;

const BLOCK_SIZE: usize = 1024 * 1024;

const BLOCK_FLAG_BWT: u8 = 0;
const BLOCK_FLAG_ZSTD: u8 = 1;
const BLOCK_FLAG_STORE: u8 = 2;

const ENTROPY_THRESHOLD_STORE: f32 = 7.95;
const ENTROPY_THRESHOLD_ZSTD: f32 = 7.5;

#[derive(Clone, Debug)]
pub struct CompressionStats {
    pub original_size: u64,
    pub compressed_size: u64,
    pub ratio: f64,
    pub entropy_bits: f32,
    pub blocks_count: usize,
}

pub struct HybridCompressor {
    block_size: usize,
}

impl HybridCompressor {
    pub fn new() -> Self {
        HybridCompressor {
            block_size: BLOCK_SIZE,
        }
    }

    pub fn compress(&self, data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
        let original_size = data.len() as u64;
        let blocks: Vec<&[u8]> = data.chunks(self.block_size).collect();
        let blocks_count = blocks.len();

        let compressed_blocks: Vec<Vec<u8>> = blocks
            .par_iter()
            .map(|block| compress_block(block))
            .collect::<Result<Vec<_>, _>>()?;

        let entropy = if data.len() > 4096 {
            analyze_entropy(&data[..4096.min(data.len())])
        } else {
            analyze_entropy(data)
        };

        let total_compressed: usize = compressed_blocks.iter().map(|b| b.len() + 4).sum();
        let mut result = Vec::with_capacity(16 + total_compressed);
        result.extend_from_slice(b"RBW2");
        result.extend_from_slice(&(blocks_count as u32).to_le_bytes());
        result.extend_from_slice(&original_size.to_le_bytes());

        for block in &compressed_blocks {
            result.extend_from_slice(&(block.len() as u32).to_le_bytes());
            result.extend_from_slice(block);
        }

        let compressed_size = result.len() as u64;
        let ratio = (compressed_size as f64) / (original_size as f64);

        Ok((result, CompressionStats {
            original_size,
            compressed_size,
            ratio,
            entropy_bits: entropy,
            blocks_count,
        }))
    }

    pub fn decompress(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() < 16 {
            return Err(anyhow::anyhow!("Invalid compressed data"));
        }

        let magic = &data[0..4];
        let v2 = magic == b"RBW2";
        if magic != b"RBW1" && !v2 {
            return Err(anyhow::anyhow!("Invalid magic"));
        }

        let blocks_count = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let original_size = u64::from_le_bytes([
            data[8], data[9], data[10], data[11],
            data[12], data[13], data[14], data[15],
        ]) as usize;

        let mut pos = 16;
        let mut block_slices: Vec<&[u8]> = Vec::with_capacity(blocks_count);

        for _ in 0..blocks_count {
            if pos + 4 > data.len() {
                return Err(anyhow::anyhow!("Truncated block header"));
            }
            let block_size = u32::from_le_bytes([
                data[pos], data[pos + 1], data[pos + 2], data[pos + 3],
            ]) as usize;
            pos += 4;
            if pos + block_size > data.len() {
                return Err(anyhow::anyhow!("Truncated block data"));
            }
            block_slices.push(&data[pos..pos + block_size]);
            pos += block_size;
        }

        let decompressed_blocks: Vec<Vec<u8>> = block_slices
            .par_iter()
            .map(|block_data| {
                if v2 {
                    decompress_block_v2(block_data)
                } else {
                    decompress_block_v1(block_data)
                }
            })
            .collect::<Result<Vec<_>, _>>()?;

        let mut result = Vec::with_capacity(original_size);
        for block in decompressed_blocks {
            result.extend_from_slice(&block);
        }

        Ok(result)
    }

    pub fn estimate_gain(&self, data: &[u8]) -> f64 {
        let entropy = analyze_entropy(data);
        let theoretical_min = (data.len() as f64) * (entropy as f64) / 8.0;
        let ratio = theoretical_min / (data.len() as f64);
        (1.0 - ratio) * 100.0
    }
}

fn compress_block_with_entropy(block: &[u8], entropy: f32) -> Result<Vec<u8>> {
    if block.is_empty() {
        return Ok(vec![BLOCK_FLAG_STORE]);
    }

    if entropy >= ENTROPY_THRESHOLD_STORE {
        let mut result = Vec::with_capacity(1 + block.len());
        result.push(BLOCK_FLAG_STORE);
        result.extend_from_slice(block);
        return Ok(result);
    }

    if entropy >= ENTROPY_THRESHOLD_ZSTD {
        let compressed = zstd::encode_all(block, 1)?;
        if compressed.len() < block.len() {
            let mut result = Vec::with_capacity(1 + 4 + compressed.len());
            result.push(BLOCK_FLAG_ZSTD);
            result.extend_from_slice(&(block.len() as u32).to_le_bytes());
            result.extend_from_slice(&compressed);
            return Ok(result);
        }
        let mut result = Vec::with_capacity(1 + block.len());
        result.push(BLOCK_FLAG_STORE);
        result.extend_from_slice(block);
        return Ok(result);
    }

    try_bwt_or_zstd(block)
}

fn compress_block(block: &[u8]) -> Result<Vec<u8>> {
    if block.is_empty() {
        return Ok(vec![BLOCK_FLAG_STORE]);
    }

    let entropy = analyze_entropy(block);
    compress_block_with_entropy(block, entropy)
}

fn try_bwt_or_zstd(block: &[u8]) -> Result<Vec<u8>> {
    let bwt = bwt_encode(block)?;
    let mtf_data = mtf_encode(&bwt.transformed);
    let rle_data = rle0_encode(&mtf_data);
    let stats = SymbolStats::from_data(&rle_data);
    let encoded = rans_encode_block(&rle_data, &stats);
    let stats_bytes = stats.serialize();

    let bwt_total = 1 + 4 + 4 + 4 + stats_bytes.len() + encoded.len();

    if bwt_total < block.len() {
        let zstd_compressed = zstd::encode_all(block, 3)?;
        let zstd_total = 1 + 4 + zstd_compressed.len();

        if zstd_total < bwt_total {
            let mut result = Vec::with_capacity(zstd_total);
            result.push(BLOCK_FLAG_ZSTD);
            result.extend_from_slice(&(block.len() as u32).to_le_bytes());
            result.extend_from_slice(&zstd_compressed);
            return Ok(result);
        }

        let mut result = Vec::with_capacity(bwt_total);
        result.push(BLOCK_FLAG_BWT);
        result.extend_from_slice(&bwt.primary_index.to_le_bytes());
        result.extend_from_slice(&(block.len() as u32).to_le_bytes());
        result.extend_from_slice(&(rle_data.len() as u32).to_le_bytes());
        result.extend_from_slice(&stats_bytes);
        result.extend_from_slice(&encoded);
        return Ok(result);
    }

    let zstd_compressed = zstd::encode_all(block, 3)?;
    if 1 + 4 + zstd_compressed.len() < block.len() {
        let mut result = Vec::with_capacity(1 + 4 + zstd_compressed.len());
        result.push(BLOCK_FLAG_ZSTD);
        result.extend_from_slice(&(block.len() as u32).to_le_bytes());
        result.extend_from_slice(&zstd_compressed);
        return Ok(result);
    }

    let mut result = Vec::with_capacity(1 + block.len());
    result.push(BLOCK_FLAG_STORE);
    result.extend_from_slice(block);
    Ok(result)
}

fn decompress_block_v2(block: &[u8]) -> Result<Vec<u8>> {
    if block.is_empty() {
        return Err(anyhow::anyhow!("Empty block"));
    }

    match block[0] {
        BLOCK_FLAG_STORE => Ok(block[1..].to_vec()),
        BLOCK_FLAG_ZSTD => {
            if block.len() < 5 {
                return Err(anyhow::anyhow!("Truncated zstd block"));
            }
            let orig_len = u32::from_le_bytes([block[1], block[2], block[3], block[4]]) as usize;
            let mut decoded = zstd::decode_all(&block[5..])?;
            decoded.truncate(orig_len);
            Ok(decoded)
        }
        BLOCK_FLAG_BWT => {
            if block.len() < 13 {
                return Err(anyhow::anyhow!("Truncated BWT block"));
            }
            let primary_index = u32::from_le_bytes([block[1], block[2], block[3], block[4]]);
            let orig_len = u32::from_le_bytes([block[5], block[6], block[7], block[8]]) as usize;
            let rle_len = u32::from_le_bytes([block[9], block[10], block[11], block[12]]) as usize;

            let (stats, stats_size) = SymbolStats::deserialize(&block[13..])?;
            let encoded = &block[13 + stats_size..];

            let rle_data = rans_decode_block(encoded, &stats, rle_len)?;
            let mtf_data = rle0_decode(&rle_data);
            let bwt_data = mtf_decode(&mtf_data);
            let original = bwt_decode(&bwt_data, primary_index)?;

            if original.len() != orig_len {
                return Err(anyhow::anyhow!("Size mismatch"));
            }
            Ok(original)
        }
        _ => Err(anyhow::anyhow!("Unknown block type: {}", block[0])),
    }
}

fn decompress_block_v1(block: &[u8]) -> Result<Vec<u8>> {
    if block.len() < 12 {
        return Err(anyhow::anyhow!("Block too small"));
    }

    let primary_index = u32::from_le_bytes([block[0], block[1], block[2], block[3]]);
    let orig_len = u32::from_le_bytes([block[4], block[5], block[6], block[7]]) as usize;
    let rle_len = u32::from_le_bytes([block[8], block[9], block[10], block[11]]) as usize;

    let (stats, stats_size) = SymbolStats::deserialize(&block[12..])?;
    let encoded = &block[12 + stats_size..];

    let rle_data = rans_decode_block(encoded, &stats, rle_len)?;
    let mtf_data = rle0_decode(&rle_data);
    let bwt_data = mtf_decode(&mtf_data);
    let original = bwt_decode(&bwt_data, primary_index)?;

    if original.len() != orig_len {
        return Err(anyhow::anyhow!("Size mismatch"));
    }

    Ok(original)
}

pub fn compress_high_performance(data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
    let compressor = HybridCompressor::new();
    compressor.compress(data)
}

pub fn decompress_high_performance(data: &[u8]) -> Result<Vec<u8>> {
    let compressor = HybridCompressor::new();
    compressor.decompress(data)
}
