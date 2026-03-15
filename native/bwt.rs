use anyhow::Result;
use rayon::prelude::*;

pub struct BwtResult {
    pub transformed: Vec<u8>,
    pub primary_index: u32,
}

pub fn bwt_encode(data: &[u8]) -> Result<BwtResult> {
    if data.is_empty() {
        return Ok(BwtResult {
            transformed: Vec::new(),
            primary_index: 0,
        });
    }

    let n = data.len();
    let mut rotations: Vec<usize> = (0..n).collect();

    rotations.par_sort_by(|&a, &b| {
        for i in 0..n {
            let ca = data[(a + i) % n];
            let cb = data[(b + i) % n];
            if ca != cb {
                return ca.cmp(&cb);
            }
        }
        std::cmp::Ordering::Equal
    });

    let mut transformed = Vec::with_capacity(n);
    let mut primary_index = 0u32;

    for (idx, &rot) in rotations.iter().enumerate() {
        if rot == 0 {
            primary_index = idx as u32;
        }
        transformed.push(data[(rot + n - 1) % n]);
    }

    Ok(BwtResult {
        transformed,
        primary_index,
    })
}

pub fn bwt_decode(data: &[u8], primary_index: u32) -> Result<Vec<u8>> {
    if data.is_empty() {
        return Ok(Vec::new());
    }

    let n = data.len();
    let primary_idx = primary_index as usize;

    if primary_idx >= n {
        return Err(anyhow::anyhow!("Invalid primary index"));
    }

    let mut counts = vec![0usize; 256];
    for &byte in data {
        counts[byte as usize] += 1;
    }

    let mut cumsum = vec![0usize; 256];
    let mut sum = 0;
    for i in 0..256 {
        cumsum[i] = sum;
        sum += counts[i];
    }

    let mut next = vec![0usize; n];
    let mut counts = vec![0usize; 256];

    for i in 0..n {
        let byte = data[i] as usize;
        let pos = cumsum[byte] + counts[byte];
        next[pos] = i;
        counts[byte] += 1;
    }

    let mut result = Vec::with_capacity(n);
    let mut idx = primary_idx;

    for _ in 0..n {
        result.push(data[idx]);
        idx = next[idx];
    }

    Ok(result)
}

pub fn bwt_encode_streaming(block_size: usize, data: &[u8]) -> Result<Vec<(BwtResult, usize)>> {
    data.par_chunks(block_size)
        .enumerate()
        .map(|(i, chunk)| {
            let result = bwt_encode(chunk)?;
            Ok((result, i * block_size))
        })
        .collect()
}
