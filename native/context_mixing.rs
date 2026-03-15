use rayon::prelude::*;

#[derive(Clone, Copy, Debug)]
pub struct ProbabilityEstimate {
    pub p0: u32,
    pub p1: u32,
    pub total: u32,
}

impl ProbabilityEstimate {
    pub fn entropy_bits(&self) -> f32 {
        if self.total == 0 {
            return 0.0;
        }
        let p0 = (self.p0 as f32) / (self.total as f32);
        let p1 = (self.p1 as f32) / (self.total as f32);

        let mut bits = 0.0;
        if p0 > 0.0 {
            bits -= p0 * p0.log2();
        }
        if p1 > 0.0 {
            bits -= p1 * p1.log2();
        }
        bits
    }
}

pub struct ContextMixer {
    contexts_order0: Vec<ProbabilityEstimate>,
    contexts_order1: Vec<[ProbabilityEstimate; 256]>,
    contexts_order2: Vec<[[ProbabilityEstimate; 256]; 256]>,
}

impl ContextMixer {
    pub fn new() -> Self {
        ContextMixer {
            contexts_order0: vec![ProbabilityEstimate { p0: 1, p1: 1, total: 2 }; 1],
            contexts_order1: vec![
                [ProbabilityEstimate { p0: 1, p1: 1, total: 2 }; 256];
                256
            ],
            contexts_order2: vec![
                [[ProbabilityEstimate { p0: 1, p1: 1, total: 2 }; 256]; 256];
                256
            ],
        }
    }

    pub fn predict_order0(&self) -> ProbabilityEstimate {
        self.contexts_order0[0]
    }

    pub fn predict_order1(&self, context1: u8) -> ProbabilityEstimate {
        self.contexts_order1[context1 as usize][0]
    }

    pub fn predict_order2(&self, context1: u8, context2: u8) -> ProbabilityEstimate {
        self.contexts_order2[context1 as usize][context2 as usize][0]
    }

    pub fn update_order0(&mut self, bit: bool) {
        let ctx = &mut self.contexts_order0[0];
        if bit {
            ctx.p1 += 1;
        } else {
            ctx.p0 += 1;
        }
        ctx.total += 1;
    }

    pub fn update_order1(&mut self, context1: u8, bit: bool) {
        let ctx = &mut self.contexts_order1[context1 as usize][0];
        if bit {
            ctx.p1 += 1;
        } else {
            ctx.p0 += 1;
        }
        ctx.total += 1;
    }

    pub fn update_order2(&mut self, context1: u8, context2: u8, bit: bool) {
        let ctx = &mut self.contexts_order2[context1 as usize][context2 as usize][0];
        if bit {
            ctx.p1 += 1;
        } else {
            ctx.p0 += 1;
        }
        ctx.total += 1;
    }
}

pub fn analyze_entropy(data: &[u8]) -> f32 {
    let freq: Vec<u32> = {
        let mut f = vec![0u32; 256];
        for &byte in data {
            f[byte as usize] += 1;
        }
        f
    };

    let total: u32 = freq.iter().sum();
    if total == 0 {
        return 0.0;
    }

    freq.par_iter()
        .filter(|&&f| f > 0)
        .map(|&f| {
            let p = (f as f32) / (total as f32);
            -p * p.log2()
        })
        .sum()
}

pub fn estimate_compression_gain(original: &[u8], entropy_bits: f32) -> f64 {
    let theoretical_min = (original.len() as f64) * (entropy_bits as f64) / 8.0;
    let ratio = theoretical_min / (original.len() as f64);
    (1.0 - ratio) * 100.0
}
