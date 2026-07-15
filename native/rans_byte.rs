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

    pub fn normalize(raw: [u32; 256]) -> Self {
        let total: u64 = raw.iter().map(|&f| f as u64).sum();
        if total == 0 {
            let mut freqs = [0u32; 256];
            freqs[0] = PROB_SCALE;
            let mut cum = [0u32; 257];
            cum[1] = PROB_SCALE;
            cum[2..].fill(PROB_SCALE);
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

#[inline(always)]
fn rans_enc_put(state: &mut u32, buf: &mut Vec<u8>, start: u32, freq: u32) {
    let x_max = ((RANS_BYTE_L >> PROB_BITS) << 8) * freq;
    let mut x = *state;
    while x >= x_max {
        buf.push((x & 0xFF) as u8);
        x >>= 8;
    }
    *state = ((x / freq) << PROB_BITS) + (x % freq) + start;
}

#[inline(always)]
fn rans_dec_renorm(state: &mut u32, data: &[u8], pos: &mut usize) {
    while *state < RANS_BYTE_L && *pos < data.len() {
        *state = (*state << 8) | (data[*pos] as u32);
        *pos += 1;
    }
}

fn write_state(out: &mut Vec<u8>, state: u32) {
    out.push((state >> 24) as u8);
    out.push(((state >> 16) & 0xFF) as u8);
    out.push(((state >> 8) & 0xFF) as u8);
    out.push((state & 0xFF) as u8);
}

fn read_state(data: &[u8], pos: &mut usize) -> u32 {
    let s = (data[*pos] as u32) << 24
        | (data[*pos + 1] as u32) << 16
        | (data[*pos + 2] as u32) << 8
        | (data[*pos + 3] as u32);
    *pos += 4;
    s
}

pub fn rans_encode_block(data: &[u8], stats: &SymbolStats) -> Vec<u8> {
    if data.is_empty() {
        return Vec::new();
    }

    if data.len() < 16 {
        return rans_encode_single(data, stats);
    }

    if data.len() < 64 {
        return rans_encode_2stream(data, stats);
    }

    rans_encode_4stream(data, stats)
}

fn rans_encode_single(data: &[u8], stats: &SymbolStats) -> Vec<u8> {
    let mut state: u32 = RANS_BYTE_L;
    let mut rev_bytes: Vec<u8> = Vec::with_capacity(data.len() + 16);

    for &byte in data.iter().rev() {
        let s = byte as usize;
        rans_enc_put(&mut state, &mut rev_bytes, stats.cum_freqs[s], stats.freqs[s]);
    }

    let mut output = Vec::with_capacity(5 + rev_bytes.len());
    output.push(0);
    write_state(&mut output, state);

    for &b in rev_bytes.iter().rev() {
        output.push(b);
    }
    output
}

fn rans_encode_2stream(data: &[u8], stats: &SymbolStats) -> Vec<u8> {
    let mut s0: u32 = RANS_BYTE_L;
    let mut s1: u32 = RANS_BYTE_L;
    let mut rev_bytes: Vec<u8> = Vec::with_capacity(data.len() + 32);

    let len = data.len();
    let even_start = if len.is_multiple_of(2) { len } else { len - 1 };

    if !len.is_multiple_of(2) {
        let sym = data[len - 1] as usize;
        rans_enc_put(&mut s1, &mut rev_bytes, stats.cum_freqs[sym], stats.freqs[sym]);
    }

    let mut i = even_start;
    while i >= 2 {
        i -= 2;
        let sym1 = data[i + 1] as usize;
        rans_enc_put(&mut s1, &mut rev_bytes, stats.cum_freqs[sym1], stats.freqs[sym1]);
        let sym0 = data[i] as usize;
        rans_enc_put(&mut s0, &mut rev_bytes, stats.cum_freqs[sym0], stats.freqs[sym0]);
    }

    let mut output = Vec::with_capacity(9 + rev_bytes.len());
    output.push(1);
    write_state(&mut output, s0);
    write_state(&mut output, s1);

    for &b in rev_bytes.iter().rev() {
        output.push(b);
    }
    output
}

fn rans_encode_4stream(data: &[u8], stats: &SymbolStats) -> Vec<u8> {
    let mut s = [RANS_BYTE_L; 4];
    let mut streams: [Vec<u8>; 4] = [
        Vec::with_capacity(data.len() / 4 + 16),
        Vec::with_capacity(data.len() / 4 + 16),
        Vec::with_capacity(data.len() / 4 + 16),
        Vec::with_capacity(data.len() / 4 + 16),
    ];

    for (i, &byte) in data.iter().enumerate() {
        let stream = i & 3;
        let sym = byte as usize;
        rans_enc_put(&mut s[stream], &mut streams[stream], stats.cum_freqs[sym], stats.freqs[sym]);
    }

    let sizes: [u32; 4] = [
        streams[0].len() as u32,
        streams[1].len() as u32,
        streams[2].len() as u32,
        streams[3].len() as u32,
    ];
    let total_rev: usize = sizes.iter().sum::<u32>() as usize;
    let mut output = Vec::with_capacity(1 + 16 + 16 + total_rev);
    output.push(2);

    for i in 0..4 {
        write_state(&mut output, s[i]);
    }
    for i in 0..4 {
        output.extend_from_slice(&sizes[i].to_le_bytes());
    }
    for i in 0..4 {
        for &b in streams[i].iter().rev() {
            output.push(b);
        }
    }

    output
}

#[derive(Clone, Debug)]
pub struct Order1Stats {
    pub contexts: [SymbolStats; 256],
}

impl Order1Stats {
    pub fn from_data(data: &[u8]) -> Self {
        let mut raw: [[u32; 256]; 256] = [[0u32; 256]; 256];
        let mut prev: usize = 0;
        for &byte in data {
            raw[prev][byte as usize] += 1;
            prev = byte as usize;
        }
        let mut contexts: [SymbolStats; 256] = unsafe { std::mem::zeroed() };
        for c in 0..256usize {
            let total: u64 = raw[c].iter().map(|&f| f as u64).sum();
            if total == 0 {

                let freqs = [16u32; 256];
                let mut cum_freqs = [0u32; 257];
                for i in 0..256 { cum_freqs[i + 1] = cum_freqs[i] + freqs[i]; }
                contexts[c] = SymbolStats { freqs, cum_freqs };
            } else {
                contexts[c] = SymbolStats::normalize(raw[c]);
            }
        }
        Order1Stats { contexts }
    }

    pub fn serialize(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(4096);
        for c in 0..256usize {
            let total: u64 = self.contexts[c].freqs.iter().map(|&f| f as u64).sum();
            if total == 0 { continue; }
            out.push(c as u8);
            let mut entries: Vec<(u8, u16)> = Vec::new();
            for s in 0..256 {
                if self.contexts[c].freqs[s] > 0 {
                    entries.push((s as u8, self.contexts[c].freqs[s] as u16));
                }
            }
            out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
            for (sym, freq) in &entries {
                out.push(*sym);
                out.extend_from_slice(&freq.to_le_bytes());
            }
        }
        out
    }

    pub fn deserialize(data: &[u8]) -> Result<(Self, usize)> {
        let mut pos = 0usize;
        let mut contexts: [SymbolStats; 256] = unsafe { std::mem::zeroed() };
        while pos < data.len() {
            if pos >= data.len() { break; }
            let c = data[pos] as usize;
            pos += 1;
            if pos + 2 > data.len() { break; }
            let count = u16::from_le_bytes([data[pos], data[pos + 1]]) as usize;
            pos += 2;
            let needed = pos + count * 3;
            if needed > data.len() { return Err(anyhow::anyhow!("Truncated order1 stats")); }
            let mut freqs = [0u32; 256];
            for _ in 0..count {
                let sym = data[pos] as usize;
                let freq = u16::from_le_bytes([data[pos + 1], data[pos + 2]]) as u32;
                freqs[sym] = freq;
                pos += 3;
            }
            let mut cum_freqs = [0u32; 257];
            for i in 0..256 { cum_freqs[i + 1] = cum_freqs[i] + freqs[i]; }
            contexts[c] = SymbolStats { freqs, cum_freqs };
        }
        Ok((Order1Stats { contexts }, pos))
    }
}

pub fn rans_encode_block_o1(data: &[u8], stats: &Order1Stats) -> Vec<u8> {
    if data.is_empty() { return Vec::new(); }
    let mut state: u32 = RANS_BYTE_L;
    let mut rev_bytes: Vec<u8> = Vec::with_capacity(data.len() + 16);

    for i in (0..data.len()).rev() {
        let prev = if i > 0 { data[i - 1] as usize } else { 0 };
        let sym = data[i] as usize;
        let ctx = &stats.contexts[prev];
        rans_enc_put(&mut state, &mut rev_bytes, ctx.cum_freqs[sym], ctx.freqs[sym]);
    }

    let mut output = Vec::with_capacity(5 + rev_bytes.len());
    output.push(0);
    write_state(&mut output, state);
    for &b in rev_bytes.iter().rev() { output.push(b); }
    output
}

pub fn rans_decode_block_o1(encoded: &[u8], stats: &Order1Stats, output_len: usize) -> Result<Vec<u8>> {
    if encoded.is_empty() { return Err(anyhow::anyhow!("Data too short")); }

    let mut cum2syms: Vec<[u8; PROB_SCALE as usize]> = Vec::with_capacity(256);
    for c in 0..256 {
        let mut table = [0u8; PROB_SCALE as usize];
        let ctx = &stats.contexts[c];
        for s in 0..256usize {
            let start = ctx.cum_freqs[s] as usize;
            let end = ctx.cum_freqs[s + 1] as usize;
            if end > start { table[start..end].fill(s as u8); }
        }
        cum2syms.push(table);
    }

    let mut pos = 0usize;
    if pos + 4 > encoded.len() { return Err(anyhow::anyhow!("Data too short for state")); }
    let mut state = read_state(encoded, &mut pos);
    let mut output = Vec::with_capacity(output_len);
    let mask = PROB_SCALE - 1;
    let mut prev: u8 = 0;

    for _ in 0..output_len {
        let slot = state & mask;
        let sym = cum2syms[prev as usize][slot as usize];
        output.push(sym);
        let ctx = &stats.contexts[prev as usize];
        let freq = ctx.freqs[sym as usize];
        let start = ctx.cum_freqs[sym as usize];
        state = freq * (state >> PROB_BITS) + slot - start;
        rans_dec_renorm(&mut state, encoded, &mut pos);
        prev = sym;
    }

    Ok(output)
}

pub fn rans_decode_block(encoded: &[u8], stats: &SymbolStats, output_len: usize) -> Result<Vec<u8>> {
    if encoded.is_empty() {
        return Err(anyhow::anyhow!("Data too short"));
    }

    let mut cum2sym = [0u8; PROB_SCALE as usize];
    for s in 0..256usize {
        let start = stats.cum_freqs[s] as usize;
        let end = stats.cum_freqs[s + 1] as usize;
        if end > start {
            cum2sym[start..end].fill(s as u8);
        }
    }

    let mode = encoded[0];
    let mut pos = 1usize;

    match mode {
        2 if output_len >= 16 => {
            return rans_decode_4stream(encoded, &cum2sym, stats, output_len, &mut pos);
        }
        1 if output_len >= 8 => {
            return rans_decode_2stream(encoded, &cum2sym, stats, output_len, &mut pos);
        }
        _ => {}
    }

    if pos + 4 > encoded.len() {
        return Err(anyhow::anyhow!("Data too short"));
    }
    let mut state = read_state(encoded, &mut pos);
    let mut output = Vec::with_capacity(output_len);
    let mask = PROB_SCALE - 1;

    for _ in 0..output_len {
        let slot = state & mask;
        let sym = cum2sym[slot as usize];
        output.push(sym);

        let freq = stats.freqs[sym as usize];
        let start = stats.cum_freqs[sym as usize];
        state = freq * (state >> PROB_BITS) + slot - start;

        rans_dec_renorm(&mut state, encoded, &mut pos);
    }

    Ok(output)
}

fn rans_decode_2stream(
    encoded: &[u8],
    cum2sym: &[u8; PROB_SCALE as usize],
    stats: &SymbolStats,
    output_len: usize,
    pos: &mut usize,
) -> Result<Vec<u8>> {
    if *pos + 8 > encoded.len() {
        return Err(anyhow::anyhow!("Data too short for interleaved"));
    }
    let mut s0 = read_state(encoded, pos);
    let mut s1 = read_state(encoded, pos);
    let mut output = Vec::with_capacity(output_len);
    let mask = PROB_SCALE - 1;

    let pairs = output_len / 2;
    for _ in 0..pairs {
        let slot0 = s0 & mask;
        let sym0 = cum2sym[slot0 as usize];
        output.push(sym0);
        let freq0 = stats.freqs[sym0 as usize];
        let start0 = stats.cum_freqs[sym0 as usize];
        s0 = freq0 * (s0 >> PROB_BITS) + slot0 - start0;
        rans_dec_renorm(&mut s0, encoded, pos);

        let slot1 = s1 & mask;
        let sym1 = cum2sym[slot1 as usize];
        output.push(sym1);
        let freq1 = stats.freqs[sym1 as usize];
        let start1 = stats.cum_freqs[sym1 as usize];
        s1 = freq1 * (s1 >> PROB_BITS) + slot1 - start1;
        rans_dec_renorm(&mut s1, encoded, pos);
    }

    if !output_len.is_multiple_of(2) {
        let slot = s1 & mask;
        let sym = cum2sym[slot as usize];
        output.push(sym);
    }

    Ok(output)
}

fn rans_decode_4stream(
    encoded: &[u8],
    cum2sym: &[u8; PROB_SCALE as usize],
    stats: &SymbolStats,
    output_len: usize,
    pos: &mut usize,
) -> Result<Vec<u8>> {
    if *pos + 16 + 16 > encoded.len() {
        return Err(anyhow::anyhow!("Data too short for 4-stream"));
    }

    let mut s = [0u32; 4];
    for i in 0..4 {
        s[i] = read_state(encoded, pos);
    }

    let mut stream_pos = [0usize; 5];
    stream_pos[0] = *pos + 16;
    for i in 0..4 {
        let sz = u32::from_le_bytes([
            encoded[*pos], encoded[*pos + 1],
            encoded[*pos + 2], encoded[*pos + 3],
        ]) as usize;
        *pos += 4;
        stream_pos[i + 1] = stream_pos[i] + sz;
    }

    if stream_pos[4] > encoded.len() {
        return Err(anyhow::anyhow!("Truncated 4-stream data"));
    }

    let mut output = Vec::with_capacity(output_len);
    let mask = PROB_SCALE - 1;

    for i in 0..output_len {
        let stream = i & 3;
        let slot = s[stream] & mask;
        let sym = cum2sym[slot as usize];
        output.push(sym);

        let freq = stats.freqs[sym as usize];
        let start = stats.cum_freqs[sym as usize];
        s[stream] = freq * (s[stream] >> PROB_BITS) + slot - start;

        while s[stream] < RANS_BYTE_L && stream_pos[stream] < stream_pos[stream + 1] {
            s[stream] = (s[stream] << 8) | (encoded[stream_pos[stream]] as u32);
            stream_pos[stream] += 1;
        }
    }

    Ok(output)
}
