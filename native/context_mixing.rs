pub fn analyze_entropy(data: &[u8]) -> f32 {
    let mut freq = [0u32; 256];
    for &byte in data {
        freq[byte as usize] += 1;
    }

    let total = data.len() as f32;
    if total == 0.0 {
        return 0.0;
    }

    let inv_total = 1.0 / total;
    let mut entropy = 0.0f32;
    for &f in &freq {
        if f > 0 {
            let p = f as f32 * inv_total;
            entropy -= p * p.log2();
        }
    }
    entropy
}
