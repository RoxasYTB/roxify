use anyhow::Result;
use rayon::prelude::*;
use crate::bwt::{bwt_encode, bwt_decode};
use crate::mtf::{mtf_encode, mtf_decode, rle0_encode, rle0_decode};
use crate::rans_byte::{SymbolStats, rans_encode_block, rans_decode_block};
use crate::context_mixing::analyze_entropy;

const BLOCK_SIZE: usize = 1024 * 1024;

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
    pub fn new(_enable_gpu: bool, _pool_size: usize) -> Self {
        HybridCompressor {
            block_size: BLOCK_SIZE,
        }
    }

    pub fn compress(&self, data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
        let original_size = data.len() as u64;
        let entropy = analyze_entropy(data);

        let blocks: Vec<&[u8]> = data.chunks(self.block_size).collect();
        let blocks_count = blocks.len();

        let compressed_blocks: Vec<Vec<u8>> = blocks
            .into_iter()
            .map(|block| compress_block(block))
            .collect::<Result<Vec<_>, _>>()?;

        let total_compressed: usize = compressed_blocks.iter().map(|b| b.len() + 4).sum();
        let mut result = Vec::with_capacity(16 + total_compressed);
        result.extend_from_slice(b"RBW1");
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

        if &data[0..4] != b"RBW1" {
            return Err(anyhow::anyhow!("Invalid magic"));
        }

        let blocks_count = u32::from_le_bytes([data[4], data[5], data[6], data[7]]) as usize;
        let original_size = u64::from_le_bytes([
            data[8], data[9], data[10], data[11],
            data[12], data[13], data[14], data[15],
        ]) as usize;

        let mut pos = 16;
        let mut block_ranges: Vec<(usize, usize)> = Vec::with_capacity(blocks_count);

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
            block_ranges.push((pos, block_size));
            pos += block_size;
        }

        let decompressed_blocks: Vec<Vec<u8>> = block_ranges
            .into_iter()
            .map(|(start, size)| {
                let block_data = &data[start..start + size];
                decompress_block(block_data)
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

fn compress_block(block: &[u8]) -> Result<Vec<u8>> {
    if block.is_empty() {
        return Ok(Vec::new());
    }

    let bwt = bwt_encode(block)?;
    let mtf_data = mtf_encode(&bwt.transformed);
    let rle_data = rle0_encode(&mtf_data);

    let stats = SymbolStats::from_data(&rle_data);
    let encoded = rans_encode_block(&rle_data, &stats);

    let stats_bytes = stats.serialize();
    let rle_len = rle_data.len() as u32;
    let orig_len = block.len() as u32;

    let mut result = Vec::with_capacity(4 + 4 + 4 + stats_bytes.len() + encoded.len());
    result.extend_from_slice(&bwt.primary_index.to_le_bytes());
    result.extend_from_slice(&orig_len.to_le_bytes());
    result.extend_from_slice(&rle_len.to_le_bytes());
    result.extend_from_slice(&stats_bytes);
    result.extend_from_slice(&encoded);

    Ok(result)
}

fn decompress_block(block: &[u8]) -> Result<Vec<u8>> {
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
        return Err(anyhow::anyhow!(
            "Size mismatch: expected {}, got {}",
            orig_len,
            original.len()
        ));
    }

    Ok(original)
}

pub fn compress_high_performance(data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
    let compressor = HybridCompressor::new(false, 4);
    compressor.compress(data)
}

pub fn decompress_high_performance(data: &[u8]) -> Result<Vec<u8>> {
    let compressor = HybridCompressor::new(false, 4);
    compressor.decompress(data)
}
