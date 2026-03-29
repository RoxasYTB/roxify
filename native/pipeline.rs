use anyhow::Result;
use rayon::prelude::*;

use crate::bwt::bwt_encode;
use crate::mtf::{mtf_encode, rle0_encode};
use crate::rans_byte::{SymbolStats, rans_encode_block};
use crate::context_mixing::analyze_entropy;

const ENTROPY_THRESHOLD_STORE: f32 = 7.95;
const ENTROPY_THRESHOLD_HIGH: f32 = 7.5;
const ENTROPY_THRESHOLD_MED: f32 = 6.0;

const BLOCK_FLAG_BWT: u8 = 0;
const BLOCK_FLAG_ZSTD: u8 = 1;
const BLOCK_FLAG_STORE: u8 = 2;
const BLOCK_FLAG_BWT_ZSTD: u8 = 3;

pub enum BlockResult {
    Compressed { index: usize, data: Vec<u8> },
    Error { index: usize, err: String },
}

pub struct PipelineConfig {
    pub block_size: usize,
    pub zstd_level: i32,
    pub pipeline_depth: usize,
}

impl Default for PipelineConfig {
    fn default() -> Self {
        PipelineConfig {
            block_size: 8 * 1024 * 1024,
            zstd_level: 3,
            pipeline_depth: num_cpus::get().max(2),
        }
    }
}

pub fn pipeline_compress(data: &[u8], config: &PipelineConfig) -> Result<Vec<Vec<u8>>> {
    let blocks: Vec<(usize, &[u8])> = data.chunks(config.block_size).enumerate().collect();
    let zstd_level = config.zstd_level;

    let results: Vec<Result<Vec<u8>>> = blocks
        .par_iter()
        .map(|(_, block)| pipeline_compress_block(block, zstd_level))
        .collect();

    results.into_iter().collect()
}

fn pipeline_compress_block(block: &[u8], zstd_level: i32) -> Result<Vec<u8>> {
    if block.is_empty() {
        return Ok(vec![BLOCK_FLAG_STORE]);
    }

    let sample_size = block.len().min(8192);
    let entropy = analyze_entropy(&block[..sample_size]);

    if entropy >= ENTROPY_THRESHOLD_STORE {
        let mut result = Vec::with_capacity(1 + block.len());
        result.push(BLOCK_FLAG_STORE);
        result.extend_from_slice(block);
        return Ok(result);
    }

    if entropy >= ENTROPY_THRESHOLD_HIGH {
        let compressed = zstd::encode_all(block, zstd_level.min(3))?;
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

    let bwt = bwt_encode(block)?;
    let bwt_zstd = zstd::encode_all(&bwt.transformed[..], zstd_level.min(6))?;
    let bwt_zstd_total = 1 + 4 + 4 + bwt_zstd.len();

    let direct_zstd = zstd::encode_all(block, zstd_level.min(6))?;
    let direct_zstd_total = 1 + 4 + direct_zstd.len();

    if entropy < ENTROPY_THRESHOLD_MED {
        let mtf_data = mtf_encode(&bwt.transformed);
        let rle_data = rle0_encode(&mtf_data);
        let stats = SymbolStats::from_data(&rle_data);
        let encoded = rans_encode_block(&rle_data, &stats);
        let stats_bytes = stats.serialize();
        let bwt_rans_total = 1 + 4 + 4 + 4 + stats_bytes.len() + encoded.len();

        let best = bwt_zstd_total.min(bwt_rans_total).min(direct_zstd_total);
        if best >= block.len() {
            let mut result = Vec::with_capacity(1 + block.len());
            result.push(BLOCK_FLAG_STORE);
            result.extend_from_slice(block);
            return Ok(result);
        }

        if best == bwt_zstd_total {
            let mut result = Vec::with_capacity(bwt_zstd_total);
            result.push(BLOCK_FLAG_BWT_ZSTD);
            result.extend_from_slice(&bwt.primary_index.to_le_bytes());
            result.extend_from_slice(&(block.len() as u32).to_le_bytes());
            result.extend_from_slice(&bwt_zstd);
            return Ok(result);
        }

        if best == bwt_rans_total {
            let mut result = Vec::with_capacity(bwt_rans_total);
            result.push(BLOCK_FLAG_BWT);
            result.extend_from_slice(&bwt.primary_index.to_le_bytes());
            result.extend_from_slice(&(block.len() as u32).to_le_bytes());
            result.extend_from_slice(&(rle_data.len() as u32).to_le_bytes());
            result.extend_from_slice(&stats_bytes);
            result.extend_from_slice(&encoded);
            return Ok(result);
        }

        let mut result = Vec::with_capacity(direct_zstd_total);
        result.push(BLOCK_FLAG_ZSTD);
        result.extend_from_slice(&(block.len() as u32).to_le_bytes());
        result.extend_from_slice(&direct_zstd);
        return Ok(result);
    }

    if bwt_zstd_total < direct_zstd_total && bwt_zstd_total < block.len() {
        let mut result = Vec::with_capacity(bwt_zstd_total);
        result.push(BLOCK_FLAG_BWT_ZSTD);
        result.extend_from_slice(&bwt.primary_index.to_le_bytes());
        result.extend_from_slice(&(block.len() as u32).to_le_bytes());
        result.extend_from_slice(&bwt_zstd);
        return Ok(result);
    }

    if direct_zstd_total < block.len() {
        let mut result = Vec::with_capacity(direct_zstd_total);
        result.push(BLOCK_FLAG_ZSTD);
        result.extend_from_slice(&(block.len() as u32).to_le_bytes());
        result.extend_from_slice(&direct_zstd);
        return Ok(result);
    }

    let mut result = Vec::with_capacity(1 + block.len());
    result.push(BLOCK_FLAG_STORE);
    result.extend_from_slice(block);
    Ok(result)
}
