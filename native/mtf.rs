pub fn mtf_encode(data: &[u8]) -> Vec<u8> {
    let mut table = core::array::from_fn::<u8, 256, _>(|i| i as u8);
    let mut inv = core::array::from_fn::<u8, 256, _>(|i| i as u8);
    let mut output = Vec::with_capacity(data.len());

    for &byte in data {
        let pos = inv[byte as usize] as usize;
        output.push(pos as u8);
        if pos > 0 {
            table.copy_within(0..pos, 1);
            table[0] = byte;
            for i in 1..=pos {
                let shifted = table[i];
                inv[shifted as usize] = i as u8;
            }
            inv[byte as usize] = 0;
        }
    }

    output
}

pub fn mtf_decode(data: &[u8]) -> Vec<u8> {
    let mut table = core::array::from_fn::<u8, 256, _>(|i| i as u8);
    let mut output = Vec::with_capacity(data.len());

    for &idx in data {
        let pos = idx as usize;
        let byte = table[pos];
        output.push(byte);
        if pos > 0 {
            table.copy_within(0..pos, 1);
            table[0] = byte;
        }
    }

    output
}

fn elias_gamma_value(n: u32) -> (u32, u32) {
    let bits = 32 - (n + 1).leading_zeros();
    (bits - 1, n + 1)
}

pub fn rle0_encode(data: &[u8]) -> Vec<u8> {
    let mut bw = BitWriter::new();
    let mut i = 0;

    while i < data.len() {
        if data[i] == 0 {
            let mut run = 0u32;
            while i < data.len() && data[i] == 0 {
                run += 1;
                i += 1;
            }
            bw.write_bit(0);
            let (prefix, body) = elias_gamma_value(run);
            bw.write_bits(0, prefix);
            bw.write_bits(body, prefix + 1);
        } else {
            bw.write_bit(1);
            bw.write_byte(data[i]);
            i += 1;
        }
    }

    bw.finish()
}

pub fn rle0_decode(data: &[u8], expected_len: usize) -> Vec<u8> {
    let mut br = BitReader::new(data);
    let mut output = Vec::with_capacity(expected_len);

    while output.len() < expected_len {
        if br.read_bit() == 0 {
            let mut leading_zeros = 0u32;
            while br.read_bit() == 0 { leading_zeros += 1; }
            let mut n = 1u32;
            for _ in 0..leading_zeros {
                n = (n << 1) | br.read_bit() as u32;
            }
            let run = n - 1;
            output.resize(output.len() + run as usize, 0);
        } else {
            output.push(br.read_byte());
        }
    }

    output
}

struct BitWriter {
    buf: Vec<u8>,
    current: u8,
    bit_pos: u8,
}

impl BitWriter {
    fn new() -> Self {
        BitWriter { buf: Vec::new(), current: 0, bit_pos: 0 }
    }

    fn write_bit(&mut self, bit: u8) {
        self.current = (self.current << 1) | (bit & 1);
        self.bit_pos += 1;
        if self.bit_pos == 8 {
            self.buf.push(self.current);
            self.current = 0;
            self.bit_pos = 0;
        }
    }

    fn write_bits(&mut self, value: u32, n_bits: u32) {
        for i in (0..n_bits).rev() {
            self.write_bit(((value >> i) & 1) as u8);
        }
    }

    fn write_byte(&mut self, byte: u8) {
        if self.bit_pos == 0 {
            self.buf.push(byte);
        } else {
            self.write_bits(byte as u32, 8);
        }
    }

    fn finish(mut self) -> Vec<u8> {
        if self.bit_pos > 0 {
            self.current <<= 8 - self.bit_pos;
            self.buf.push(self.current);
        }
        self.buf
    }
}

struct BitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_pos: u8,
    bits_left: usize,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        let bits_left = data.len() * 8;
        BitReader { data, byte_pos: 0, bit_pos: 0, bits_left }
    }

    fn read_bit(&mut self) -> u8 {
        if self.bits_left == 0 { return 0; }
        let bit = (self.data[self.byte_pos] >> (7 - self.bit_pos)) & 1;
        self.bit_pos += 1;
        self.bits_left -= 1;
        if self.bit_pos == 8 {
            self.bit_pos = 0;
            self.byte_pos += 1;
        }
        bit
    }

    fn read_byte(&mut self) -> u8 {
        let mut byte = 0u8;
        if self.bit_pos == 0 && self.bits_left >= 8 {
            byte = self.data[self.byte_pos];
            self.byte_pos += 1;
            self.bits_left -= 8;
        } else {
            for _ in 0..8 {
                byte = (byte << 1) | self.read_bit();
            }
        }
        byte
    }
}
