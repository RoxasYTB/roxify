use anyhow::Result;
use rayon::prelude::*;
use crate::bwt::{bwt_encode, BwtResult};
use crate::context_mixing::{analyze_entropy, ContextMixer};
use crate::rans::{build_symbols_from_frequencies, RansEncoder};
use crate::pool::BufferPool;
use std::sync::Arc;
use parking_lot::RwLock;

const BLOCK_SIZE: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct CompressionStats {
    pub original_size: u64,
    pub compressed_size: u64,
    pub ratio: f64,
    pub entropy_bits: f32,
    pub blocks_count: usize,
}

pub struct HybridCompressor {
    pool: Arc<BufferPool>,
    enable_gpu: bool,
    block_size: usize,
}

impl HybridCompressor {
    pub fn new(enable_gpu: bool, pool_size: usize) -> Self {
        HybridCompressor {
            pool: Arc::new(BufferPool::new(pool_size, BLOCK_SIZE)),
            enable_gpu,
            block_size: BLOCK_SIZE,
        }
    }

    pub fn compress(&self, data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
        let original_size = data.len() as u64;
        let entropy = analyze_entropy(data);

        let blocks: Vec<&[u8]> = data.chunks(self.block_size).collect();
        let blocks_count = blocks.len();

        let compressed_blocks: Vec<Vec<u8>> = blocks
            .into_par_iter()
            .map(|block| self.compress_block(block))
            .collect::<Result<Vec<_>, _>>()?;

        let mut result = Vec::with_capacity(original_size as usize / 2);
        result.extend_from_slice(&(blocks_count as u32).to_le_bytes());

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

    fn compress_block(&self, block: &[u8]) -> Result<Vec<u8>> {
        if block.is_empty() {
            return Ok(Vec::new());
        }

        let bwt = bwt_encode(block)?;
        let bwt_data = &bwt.transformed;

        let mut freqs = vec![0u32; 256];
        for &byte in bwt_data {
            freqs[byte as usize] += 1;
        }

        let symbols = build_symbols_from_frequencies(&freqs);
        let mut encoder = RansEncoder::new(symbols);

        for &byte in bwt_data {
            for bit_idx in 0..8 {
                let bit = (byte >> bit_idx) & 1 == 1;
                let symbol_idx = if bit { 1 } else { 0 };
                let _ = encoder.encode(symbol_idx);
            }
        }

        let encoded = encoder.finish();
        let mut result = Vec::with_capacity(4 + encoded.len());
        result.extend_from_slice(&bwt.primary_index.to_le_bytes());
        result.extend_from_slice(&encoded);

        Ok(result)
    }

    pub fn decompress(&self, data: &[u8]) -> Result<Vec<u8>> {
        if data.len() < 4 {
            return Err(anyhow::anyhow!("Invalid compressed data"));
        }

        let blocks_count = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
        let mut pos = 4;
        let mut result = Vec::new();

        for _ in 0..blocks_count {
            if pos + 4 > data.len() {
                return Err(anyhow::anyhow!("Truncated block header"));
            }

            let block_size = u32::from_le_bytes([
                data[pos],
                data[pos + 1],
                data[pos + 2],
                data[pos + 3],
            ]) as usize;
            pos += 4;

            if pos + block_size > data.len() {
                return Err(anyhow::anyhow!("Truncated block data"));
            }

            let block_data = &data[pos..pos + block_size];
            pos += block_size;

            let decompressed = self.decompress_block(block_data)?;
            result.extend_from_slice(&decompressed);
        }

        Ok(result)
    }

    fn decompress_block(&self, block: &[u8]) -> Result<Vec<u8>> {
        if block.len() < 4 {
            return Ok(Vec::new());
        }

        let _primary_index = u32::from_le_bytes([block[0], block[1], block[2], block[3]]);
        let _encoded_data = &block[4..];

        Ok(Vec::new())
    }

    pub fn estimate_gain(&self, data: &[u8]) -> f64 {
        let entropy = analyze_entropy(data);
        let theoretical_min = (data.len() as f64) * (entropy as f64) / 8.0;
        let ratio = theoretical_min / (data.len() as f64);
        (1.0 - ratio) * 100.0
    }
}

pub fn compress_high_performance(data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
    let compressor = HybridCompressor::new(true, 4);
    compressor.compress(data)
}

pub fn decompress_high_performance(data: &[u8]) -> Result<Vec<u8>> {
    let compressor = HybridCompressor::new(true, 4);
    compressor.decompress(data)
}
