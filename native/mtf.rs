pub fn mtf_encode(data: &[u8]) -> Vec<u8> {
    let mut table = [0u8; 256];
    for i in 0..256 {
        table[i] = i as u8;
    }
    let mut output = Vec::with_capacity(data.len());

    for &byte in data {
        let pos = unsafe { table.iter().position(|&b| b == byte).unwrap_unchecked() };
        output.push(pos as u8);
        if pos > 0 {
            let val = table[pos];
            table.copy_within(0..pos, 1);
            table[0] = val;
        }
    }

    output
}

pub fn mtf_decode(data: &[u8]) -> Vec<u8> {
    let mut table = [0u8; 256];
    for i in 0..256 {
        table[i] = i as u8;
    }
    let mut output = Vec::with_capacity(data.len());

    for &idx in data {
        let pos = idx as usize;
        let byte = table[pos];
        output.push(byte);
        if pos > 0 {
            let val = table[pos];
            table.copy_within(0..pos, 1);
            table[0] = val;
        }
    }

    output
}

pub fn rle0_encode(data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        if data[i] == 0 {
            let mut run = 0u32;
            while i < data.len() && data[i] == 0 {
                run += 1;
                i += 1;
            }
            output.push(0);
            if run <= 127 {
                output.push(run as u8);
            } else if run <= 16383 {
                output.push(0x80 | ((run >> 8) as u8));
                output.push((run & 0xFF) as u8);
            } else {
                output.push(0xC0 | ((run >> 16) as u8));
                output.push(((run >> 8) & 0xFF) as u8);
                output.push((run & 0xFF) as u8);
            }
        } else {
            output.push(data[i]);
            i += 1;
        }
    }

    output
}

pub fn rle0_decode(data: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(data.len() * 2);
    let mut i = 0;

    while i < data.len() {
        if data[i] == 0 {
            i += 1;
            if i >= data.len() {
                break;
            }
            let run;
            if data[i] & 0xC0 == 0xC0 {
                let hi = (data[i] & 0x3F) as u32;
                run = (hi << 16) | ((data[i + 1] as u32) << 8) | (data[i + 2] as u32);
                i += 3;
            } else if data[i] & 0x80 != 0 {
                let hi = (data[i] & 0x7F) as u32;
                run = (hi << 8) | (data[i + 1] as u32);
                i += 2;
            } else {
                run = data[i] as u32;
                i += 1;
            }
            for _ in 0..run {
                output.push(0);
            }
        } else {
            output.push(data[i]);
            i += 1;
        }
    }

    output
}
