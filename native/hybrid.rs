use anyhow::Result;
use std::sync::mpsc::sync_channel;
use std::sync::atomic::{AtomicUsize, Ordering};
use crate::bwt::{bwt_encode, bwt_decode};
use crate::mtf::{mtf_encode, mtf_decode, rle0_encode, rle0_decode};
use crate::rans_byte::{SymbolStats, rans_encode_block, rans_decode_block};
use crate::context_mixing::analyze_entropy;

const BLOCK_SIZE: usize = 16 * 1024 * 1024;

const BLOCK_FLAG_BWT: u8 = 0;
const BLOCK_FLAG_ZSTD: u8 = 1;
const BLOCK_FLAG_STORE: u8 = 2;
const BLOCK_FLAG_BWT_O1: u8 = 3;
const BLOCK_FLAG_ZSTD_L19: u8 = 4;
const BLOCK_FLAG_ZSTD_FULL: u8 = 5;

const ENTROPY_THRESHOLD_STORE: f32 = 7.95;
const ENTROPY_THRESHOLD_ZSTD: f32 = 7.5;

const ZSTD_SKIP_BWT_RATIO: f64 = 0.70;

#[derive(Clone, Debug)]
pub struct CompressionStats {
    pub original_size: u64,
    pub compressed_size: u64,
    pub ratio: f64,
    pub entropy_bits: f32,
    pub blocks_count: usize,
}

struct BlockResult {
    idx: usize,
    data: Result<Vec<u8>>,
}

pub struct HybridCompressor {
    block_size: usize,
    num_workers: usize,
}

impl Default for HybridCompressor {
    fn default() -> Self {
        Self::new()
    }
}

impl HybridCompressor {
    pub fn new() -> Self {
        let num_workers = (num_cpus::get() / 4).max(1);
        HybridCompressor {
            block_size: BLOCK_SIZE,
            num_workers,
        }
    }

    pub fn compress(&self, data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
        let original_size = data.len() as u64;
        let blocks_count = (data.len() + self.block_size - 1) / self.block_size;

        let entropy = if data.len() > 4096 {
            analyze_entropy(&data[..4096.min(data.len())])
        } else {
            analyze_entropy(data)
        };

        let mut result = Vec::with_capacity(16 + blocks_count * 4 + original_size as usize / 3);
        result.extend_from_slice(b"RBW2");
        result.extend_from_slice(&(blocks_count as u32).to_le_bytes());
        result.extend_from_slice(&original_size.to_le_bytes());
        let sizes_offset = result.len();
        result.resize(sizes_offset + blocks_count * 4, 0);

        if blocks_count == 0 {
            let cs = result.len() as u64;
            return Ok((result, CompressionStats {
                original_size, compressed_size: cs,
                ratio: 1.0, entropy_bits: entropy, blocks_count,
            }));
        }

        let nw = self.num_workers.min(blocks_count);
        let bs = self.block_size;
        let dl = data.len();
        let offsets: Vec<(usize, usize)> = (0..blocks_count).map(|i| {
            let s = i * bs; let e = (s + bs).min(dl); (s, e)
        }).collect();

        let (res_tx, res_rx) = sync_channel::<BlockResult>(nw * 2);
        let next_job = AtomicUsize::new(0);
        let err = std::sync::Mutex::new(None::<anyhow::Error>);

        let nj = &next_job;
        let offs = &offsets;
        let bc = blocks_count;
        let dt = data;

        let mut next_idx = 0usize;

        std::thread::scope(|s| {
            for _ in 0..nw {
                let tx = res_tx.clone();
                s.spawn(move || {
                    loop {
                        let i = nj.fetch_add(1, Ordering::Relaxed);
                        if i >= bc { break; }
                        let (start, end) = offs[i];
                        let chunk = &dt[start..end];
                        let r = BlockResult { idx: i, data: compress_block(chunk) };
                        if tx.send(r).is_err() { break; }
                    }
                });
            }
            drop(res_tx);

            let mut pending = vec![None::<Vec<u8>>; blocks_count];
            while next_idx < blocks_count {
                match res_rx.recv() {
                    Ok(r) => {
                        let compressed = match r.data {
                            Ok(v) => v,
                            Err(e) => {
                                *err.lock().unwrap() = Some(e);
                                break;
                            }
                        };
                        pending[r.idx] = Some(compressed);
                        while next_idx < blocks_count {
                            if let Some(data) = pending[next_idx].take() {
                                let bs = data.len() as u32;
                                let off = sizes_offset + next_idx * 4;
                                result[off..off + 4].copy_from_slice(&bs.to_le_bytes());
                                result.extend_from_slice(&data);
                                next_idx += 1;
                            } else { break; }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        if let Some(e) = err.into_inner().unwrap() {
            return Err(e);
        }
        if next_idx != blocks_count {
            return Err(anyhow::anyhow!("Compression incomplete: {} != {}", next_idx, blocks_count));
        }

        let compressed_size = result.len() as u64;
        let ratio = compressed_size as f64 / original_size as f64;

        Ok((result, CompressionStats {
            original_size, compressed_size, ratio,
            entropy_bits: entropy, blocks_count,
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

        if data.len() < 16 + blocks_count * 4 {
            return Err(anyhow::anyhow!("Truncated block size table"));
        }

        if blocks_count == 0 { return Ok(Vec::new()); }

        let mut boff: Vec<(usize, usize)> = Vec::with_capacity(blocks_count);
        let mut pos = 16 + blocks_count * 4;
        for i in 0..blocks_count {
            let sp = 16 + i * 4;
            let sz = u32::from_le_bytes([data[sp], data[sp+1], data[sp+2], data[sp+3]]) as usize;
            if pos + sz > data.len() { return Err(anyhow::anyhow!("Truncated block data")); }
            boff.push((pos, sz));
            pos += sz;
        }

        let nw = self.num_workers.min(blocks_count);
        let (res_tx, res_rx) = sync_channel::<BlockResult>(nw * 2);
        let next_job = AtomicUsize::new(0);
        let err = std::sync::Mutex::new(None::<anyhow::Error>);

        let nj = &next_job;
        let bo = &boff;
        let dt = data;
        let bc = blocks_count;

        let mut result = Vec::with_capacity(original_size);
        let mut next_idx = 0usize;

        std::thread::scope(|s| {
            for _ in 0..nw {
                let tx = res_tx.clone();
                s.spawn(move || {
                    loop {
                        let i = nj.fetch_add(1, Ordering::Relaxed);
                        if i >= bc { break; }
                        let (start, sz) = bo[i];
                        let bd = &dt[start..start + sz];
                        let dec = if v2 { decompress_block_v2(bd) } else { decompress_block_v1(bd) };
                        if tx.send(BlockResult { idx: i, data: dec }).is_err() { break; }
                    }
                });
            }
            drop(res_tx);

            let mut pending = vec![None::<Vec<u8>>; blocks_count];
            while next_idx < blocks_count {
                match res_rx.recv() {
                    Ok(r) => {
                        let d = match r.data {
                            Ok(v) => v,
                            Err(e) => {
                                *err.lock().unwrap() = Some(e);
                                break;
                            }
                        };
                        pending[r.idx] = Some(d);
                        while next_idx < blocks_count {
                            if let Some(data) = pending[next_idx].take() {
                                result.extend_from_slice(&data);
                                next_idx += 1;
                            } else { break; }
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        if let Some(e) = err.into_inner().unwrap() {
            return Err(e);
        }
        if next_idx != blocks_count {
            return Err(anyhow::anyhow!("Decompress incomplete: {} != {}", next_idx, blocks_count));
        }
        if result.len() != original_size {
            return Err(anyhow::anyhow!("Size mismatch: {} != {}", result.len(), original_size));
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
    if block.is_empty() { return Ok(vec![BLOCK_FLAG_STORE]); }

    if entropy >= ENTROPY_THRESHOLD_STORE {
        let mut r = Vec::with_capacity(1 + block.len());
        r.push(BLOCK_FLAG_STORE); r.extend_from_slice(block); return Ok(r);
    }

    if entropy >= ENTROPY_THRESHOLD_ZSTD {
        let c = zstd::encode_all(block, 1)?;
        if c.len() < block.len() {
            let mut r = Vec::with_capacity(1 + 4 + c.len());
            r.push(BLOCK_FLAG_ZSTD);
            r.extend_from_slice(&(block.len() as u32).to_le_bytes());
            r.extend_from_slice(&c); return Ok(r);
        }
        let mut r = Vec::with_capacity(1 + block.len());
        r.push(BLOCK_FLAG_STORE); r.extend_from_slice(block); return Ok(r);
    }

    try_bwt_or_zstd(block)
}

fn compress_block(block: &[u8]) -> Result<Vec<u8>> {
    if block.is_empty() { return Ok(vec![BLOCK_FLAG_STORE]); }
    let entropy = analyze_entropy(block);
    compress_block_with_entropy(block, entropy)
}

fn try_bwt_or_zstd(block: &[u8]) -> Result<Vec<u8>> {
    let zc9 = zstd::encode_all(block, 9)?;
    let zt9 = 1 + 4 + zc9.len();

    let bwt = bwt_encode(block)?;
    let pi = bwt.primary_index;
    let mt = mtf_encode(&bwt.transformed);
    let mt_len = mt.len();
    drop(bwt);

    let rle = rle0_encode(&mt);
    let st0 = SymbolStats::from_data(&rle);
    let enc0 = rans_encode_block(&rle, &st0);
    let sb0 = st0.serialize();
    let bt0 = 1 + 4 + 4 + 4 + sb0.len() + enc0.len();
    drop(rle);
    drop(mt);

    use std::io::Write;
    let mut enc = zstd::stream::Encoder::new(Vec::new(), 19)
        .map_err(|e| anyhow::anyhow!("zstd init: {}", e))?;
    enc.window_log(27).map_err(|e| anyhow::anyhow!("zstd window_log: {}", e))?;
    enc.write_all(block).map_err(|e| anyhow::anyhow!("zstd write: {}", e))?;
    let zc19 = enc.finish().map_err(|e| anyhow::anyhow!("zstd fin: {}", e))?;
    let zt19 = 1 + 4 + zc19.len();

    let best = if zt19 < bt0.min(zt9) { zt19 }
               else if bt0 < zt9 { bt0 }
               else { zt9 };

    if best == zt19 && zt19 < block.len() {
        let mut r = Vec::with_capacity(zt19);
        r.push(BLOCK_FLAG_ZSTD_L19);
        r.extend_from_slice(&(block.len() as u32).to_le_bytes());
        r.extend_from_slice(&zc19); return Ok(r);
    }

    if best == bt0 && bt0 < block.len() {
        let mut r = Vec::with_capacity(bt0);
        r.push(BLOCK_FLAG_BWT);
        r.extend_from_slice(&pi.to_le_bytes());
        r.extend_from_slice(&(block.len() as u32).to_le_bytes());
        r.extend_from_slice(&(mt_len as u32).to_le_bytes());
        r.extend_from_slice(&sb0); r.extend_from_slice(&enc0); return Ok(r);
    }

    if zt9 < block.len() {
        let mut r = Vec::with_capacity(zt9);
        r.push(BLOCK_FLAG_ZSTD);
        r.extend_from_slice(&(block.len() as u32).to_le_bytes());
        r.extend_from_slice(&zc9); return Ok(r);
    }

    let mut r = Vec::with_capacity(1 + block.len());
    r.push(BLOCK_FLAG_STORE); r.extend_from_slice(block); Ok(r)
}

fn decompress_block_v2(block: &[u8]) -> Result<Vec<u8>> {
    if block.is_empty() { return Err(anyhow::anyhow!("Empty block")); }
    match block[0] {
        BLOCK_FLAG_STORE => Ok(block[1..].to_vec()),
        BLOCK_FLAG_ZSTD | BLOCK_FLAG_ZSTD_L19 | BLOCK_FLAG_ZSTD_FULL => {
            if block.len() < 5 { return Err(anyhow::anyhow!("Truncated zstd block")); }
            let ol = u32::from_le_bytes([block[1], block[2], block[3], block[4]]) as usize;
            let mut d = zstd::decode_all(&block[5..])?; d.truncate(ol); Ok(d)
        }
        BLOCK_FLAG_BWT => {
            if block.len() < 13 { return Err(anyhow::anyhow!("Truncated BWT block")); }
            let pi = u32::from_le_bytes([block[1], block[2], block[3], block[4]]);
            let ol = u32::from_le_bytes([block[5], block[6], block[7], block[8]]) as usize;
            let rl = u32::from_le_bytes([block[9], block[10], block[11], block[12]]) as usize;
            let (st, ss) = SymbolStats::deserialize(&block[13..])?;
            let enc = &block[13 + ss..];
            let rle = rans_decode_block(enc, &st, rl)?;
            let mt = rle0_decode(&rle, ol);
            drop(rle);
            let bwt = mtf_decode(&mt);
            drop(mt);
            let orig = bwt_decode(&bwt, pi)?;
            if orig.len() != ol { return Err(anyhow::anyhow!("Size mismatch")); }
            Ok(orig)
        }
        _ => Err(anyhow::anyhow!("Unknown block type: {}", block[0])),
    }
}

fn decompress_block_v1(block: &[u8]) -> Result<Vec<u8>> {
    if block.len() < 12 { return Err(anyhow::anyhow!("Block too small")); }
    let pi = u32::from_le_bytes([block[0], block[1], block[2], block[3]]);
    let ol = u32::from_le_bytes([block[4], block[5], block[6], block[7]]) as usize;
    let rl = u32::from_le_bytes([block[8], block[9], block[10], block[11]]) as usize;
    let (st, ss) = SymbolStats::deserialize(&block[12..])?;
    let enc = &block[12 + ss..];
    let rle = rans_decode_block(enc, &st, rl)?;
    let mt = rle0_decode(&rle, ol);
    drop(rle);
    let bwt = mtf_decode(&mt);
    drop(mt);
    let orig = bwt_decode(&bwt, pi)?;
    if orig.len() != ol { return Err(anyhow::anyhow!("Size mismatch")); }
    Ok(orig)
}

pub fn compress_high_performance(data: &[u8]) -> Result<(Vec<u8>, CompressionStats)> {
    let c = HybridCompressor::new();
    let (bwt_result, stats) = c.compress(data)?;

    if bwt_result.len() > data.len() * 35 / 100 {
        use std::io::Write;
        let mut enc = match zstd::stream::Encoder::new(Vec::new(), 15) {
            Ok(e) => e,
            Err(_) => return Ok((bwt_result, stats)),
        };
        let _ = enc.window_log(27);
        if enc.write_all(data).is_err() {
            return Ok((bwt_result, stats));
        }
        let zstd_full = match enc.finish() {
            Ok(v) => v,
            Err(_) => return Ok((bwt_result, stats)),
        };

        let zstd_total = 25 + zstd_full.len();
        if zstd_total < bwt_result.len() {
            let block_data_size = 1 + 4 + zstd_full.len();
            let mut result = Vec::with_capacity(zstd_total);
            result.extend_from_slice(b"RBW2");
            result.extend_from_slice(&1u32.to_le_bytes());
            result.extend_from_slice(&(data.len() as u64).to_le_bytes());
            result.extend_from_slice(&(block_data_size as u32).to_le_bytes());
            result.push(BLOCK_FLAG_ZSTD_FULL);
            result.extend_from_slice(&(data.len() as u32).to_le_bytes());
            result.extend_from_slice(&zstd_full);

            let cs = result.len() as u64;
            return Ok((result, CompressionStats {
                original_size: data.len() as u64,
                compressed_size: cs,
                ratio: cs as f64 / data.len() as f64,
                entropy_bits: stats.entropy_bits,
                blocks_count: 1,
            }));
        }
    }

    Ok((bwt_result, stats))
}

pub fn decompress_high_performance(data: &[u8]) -> Result<Vec<u8>> {
    let c = HybridCompressor::new(); c.decompress(data)
}
