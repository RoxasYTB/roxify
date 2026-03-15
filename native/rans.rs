use anyhow::Result;

const RANS_L: u32 = 1 << 31;
const RANS_M: u32 = 1 << 16;

#[derive(Clone, Debug)]
pub struct Symbol {
    pub start: u32,
    pub freq: u32,
    pub scale_bits: u32,
}

pub struct RansEncoder {
    state: u32,
    output: Vec<u8>,
    symbols: Vec<Symbol>,
}

impl RansEncoder {
    pub fn new(symbols: Vec<Symbol>) -> Self {
        RansEncoder {
            state: RANS_L,
            output: Vec::new(),
            symbols,
        }
    }

    pub fn encode(&mut self, symbol_idx: usize) -> Result<()> {
        if symbol_idx >= self.symbols.len() {
            return Err(anyhow::anyhow!("Symbol index out of bounds"));
        }

        let sym = &self.symbols[symbol_idx];

        while self.state >= (sym.freq << 16) {
            self.output.push((self.state & 0xFF) as u8);
            self.state >>= 8;
        }

        let x = ((self.state / sym.freq) << sym.scale_bits) + sym.start;
        let y = self.state % sym.freq;
        self.state = x + y;

        Ok(())
    }

    pub fn finish(mut self) -> Vec<u8> {
        while self.state > 0 {
            self.output.push((self.state & 0xFF) as u8);
            self.state >>= 8;
        }
        self.output.reverse();
        self.output
    }
}

pub struct RansDecoder {
    state: u32,
    data: Vec<u8>,
    pos: usize,
    symbols: Vec<Symbol>,
}

impl RansDecoder {
    pub fn new(data: Vec<u8>, symbols: Vec<Symbol>) -> Self {
        let mut decoder = RansDecoder {
            state: RANS_L,
            data,
            pos: 0,
            symbols,
        };
        decoder.refill();
        decoder
    }

    fn refill(&mut self) {
        while self.state < RANS_L && self.pos < self.data.len() {
            self.state = (self.state << 8) | (self.data[self.pos] as u32);
            self.pos += 1;
        }
    }

    pub fn decode(&mut self) -> Result<usize> {
        let x = self.state & 0xFFFF;

        let mut sym_idx = 0;
        for (i, sym) in self.symbols.iter().enumerate() {
            if x >= sym.start && x < sym.start + sym.freq {
                sym_idx = i;
                break;
            }
        }

        let sym = &self.symbols[sym_idx];
        let q = self.state / sym.freq;
        let r = self.state % sym.freq;

        self.state = (q << sym.scale_bits) + (r + sym.start);
        self.refill();

        Ok(sym_idx)
    }

    pub fn is_finished(&self) -> bool {
        self.state == RANS_L && self.pos >= self.data.len()
    }
}

pub fn build_symbols_from_frequencies(freqs: &[u32]) -> Vec<Symbol> {
    let total: u32 = freqs.iter().sum();
    if total == 0 {
        return Vec::new();
    }

    let scale_bits = 16 - (total.leading_zeros() - 16);
    let mut symbols = Vec::new();
    let mut start = 0u32;

    for freq in freqs {
        if *freq > 0 {
            let scaled = ((*freq as u64) << scale_bits) / (total as u64);
            symbols.push(Symbol {
                start,
                freq: *freq,
                scale_bits,
            });
            start += scaled as u32;
        }
    }

    symbols
}

pub fn estimate_entropy(freqs: &[u32]) -> f64 {
    let total: u32 = freqs.iter().sum();
    if total == 0 {
        return 0.0;
    }

    let total_f = total as f64;
    freqs
        .iter()
        .filter(|&&f| f > 0)
        .map(|&f| {
            let p = (f as f64) / total_f;
            -p * p.log2()
        })
        .sum()
}
