use anyhow::Result;

const PROB_BITS: u32 = 12;
const PROB_SCALE: u32 = 1 << PROB_BITS;
const RANS_BYTE_L: u32 = 1 << 23;

#[derive(Clone, Debug)]
pub struct SymbolStats {
    pub freqs: [u32; 256],
    pub cum_freqs: [u32; 257],
}

impl SymbolStats {
    pub fn from_data(data: &[u8]) -> Self {
        let mut raw = [0u32; 256];
        for &b in data {
            raw[b as usize] += 1;
        }
        Self::normalize(raw)
    }

    fn normalize(raw: [u32; 256]) -> Self {
        let total: u64 = raw.iter().map(|&f| f as u64).sum();
        if total == 0 {
            let mut freqs = [0u32; 256];
            freqs[0] = PROB_SCALE;
            let mut cum = [0u32; 257];
            cum[1] = PROB_SCALE;
            for i in 2..257 { cum[i] = PROB_SCALE; }
            return SymbolStats { freqs, cum_freqs: cum };
        }

        let mut freqs = [0u32; 256];
        let mut assigned = 0u32;
        let mut max_idx = 0usize;
        let mut max_raw = 0u32;

        for i in 0..256 {
            if raw[i] > 0 {
                freqs[i] = ((raw[i] as u64 * PROB_SCALE as u64) / total).max(1) as u32;
                assigned += freqs[i];
                if raw[i] > max_raw {
                    max_raw = raw[i];
                    max_idx = i;
                }
            }
        }

        if assigned > PROB_SCALE {
            let excess = assigned - PROB_SCALE;
            freqs[max_idx] = freqs[max_idx].saturating_sub(excess);
            if freqs[max_idx] == 0 { freqs[max_idx] = 1; }
        } else if assigned < PROB_SCALE {
            freqs[max_idx] += PROB_SCALE - assigned;
        }

        let mut cum_freqs = [0u32; 257];
        for i in 0..256 {
            cum_freqs[i + 1] = cum_freqs[i] + freqs[i];
        }

        SymbolStats { freqs, cum_freqs }
    }

    pub fn serialize(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(512);
        let mut entries: Vec<(u8, u16)> = Vec::new();
        for i in 0..256 {
            if self.freqs[i] > 0 {
                entries.push((i as u8, self.freqs[i] as u16));
            }
        }
        out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for (sym, freq) in &entries {
            out.push(*sym);
            out.extend_from_slice(&freq.to_le_bytes());
        }
        out
    }

    pub fn deserialize(data: &[u8]) -> Result<(Self, usize)> {
        if data.len() < 2 {
            return Err(anyhow::anyhow!("Stats too short"));
        }
        let count = u16::from_le_bytes([data[0], data[1]]) as usize;
        let needed = 2 + count * 3;
        if data.len() < needed {
            return Err(anyhow::anyhow!("Truncated stats"));
        }

        let mut freqs = [0u32; 256];
        let mut pos = 2;
        for _ in 0..count {
            let sym = data[pos] as usize;
            let freq = u16::from_le_bytes([data[pos + 1], data[pos + 2]]) as u32;
            freqs[sym] = freq;
            pos += 3;
        }

        let mut cum_freqs = [0u32; 257];
        for i in 0..256 {
            cum_freqs[i + 1] = cum_freqs[i] + freqs[i];
        }

        Ok((SymbolStats { freqs, cum_freqs }, needed))
    }
}

fn rans_enc_put(state: &mut u32, buf: &mut Vec<u8>, start: u32, freq: u32) {
    let x = *state;
    let x_max = ((RANS_BYTE_L >> PROB_BITS) << 8) * freq;
    let mut x = x;
    while x >= x_max {
        buf.push((x & 0xFF) as u8);
        x >>= 8;
    }
    *state = ((x / freq) << PROB_BITS) + (x % freq) + start;
}

fn rans_dec_init(data: &[u8], pos: &mut usize) -> u32 {
    let s = (data[*pos] as u32) << 24
        | (data[*pos + 1] as u32) << 16
        | (data[*pos + 2] as u32) << 8
        | (data[*pos + 3] as u32);
    *pos += 4;
    s
}

fn rans_dec_renorm(state: &mut u32, data: &[u8], pos: &mut usize) {
    while *state < RANS_BYTE_L && *pos < data.len() {
        *state = (*state << 8) | (data[*pos] as u32);
        *pos += 1;
    }
}

pub fn rans_encode_block(data: &[u8], stats: &SymbolStats) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }

    let mut state: u32 = RANS_BYTE_L;
    let mut rev_bytes: Vec<u8> = Vec::with_capacity(data.len() + 16);

    for &byte in data.iter().rev() {
        let s = byte as usize;
        rans_enc_put(&mut state, &mut rev_bytes, stats.cum_freqs[s], stats.freqs[s]);
    }

    let mut output = Vec::with_capacity(4 + rev_bytes.len());
    output.push((state >> 24) as u8);
    output.push(((state >> 16) & 0xFF) as u8);
    output.push(((state >> 8) & 0xFF) as u8);
    output.push((state & 0xFF) as u8);

    for &b in rev_bytes.iter().rev() {
        output.push(b);
    }
    output
}

pub fn rans_decode_block(encoded: &[u8], stats: &SymbolStats, output_len: usize) -> Result<Vec<u8>> {
    if encoded.len() < 4 {
        return Err(anyhow::anyhow!("Data too short"));
    }

    let mut cum2sym = vec![0u8; PROB_SCALE as usize];
    for s in 0..256usize {
        for slot in (stats.cum_freqs[s] as usize)..(stats.cum_freqs[s + 1] as usize) {
            cum2sym[slot] = s as u8;
        }
    }

    let mut pos = 0usize;
    let mut state = rans_dec_init(encoded, &mut pos);
    let mut output = Vec::with_capacity(output_len);

    for _ in 0..output_len {
        let slot = state & (PROB_SCALE - 1);
        let sym = cum2sym[slot as usize];
        output.push(sym);

        let freq = stats.freqs[sym as usize];
        let start = stats.cum_freqs[sym as usize];
        state = freq * (state >> PROB_BITS) + slot - start;

        rans_dec_renorm(&mut state, encoded, &mut pos);
    }

    Ok(output)
}
