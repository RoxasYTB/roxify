pub fn mtf_encode(data: &[u8]) -> Vec<u8> {
    let mut table = [0u8; 256];
    let mut inverse = [0u8; 256];
    for i in 0..256u16 {
        table[i as usize] = i as u8;
        inverse[i as usize] = i as u8;
    }
    let mut output = Vec::with_capacity(data.len());

    for &byte in data {
        let pos = unsafe { *inverse.get_unchecked(byte as usize) } as usize;
        output.push(pos as u8);
        if pos > 0 {
            for j in (1..=pos).rev() {
                let prev = unsafe { *table.get_unchecked(j - 1) };
                unsafe { *table.get_unchecked_mut(j) = prev; }
                unsafe { *inverse.get_unchecked_mut(prev as usize) = j as u8; }
            }
            table[0] = byte;
            inverse[byte as usize] = 0;
        }
    }

    output
}

pub fn mtf_decode(data: &[u8]) -> Vec<u8> {
    let mut table = [0u8; 256];
    for i in 0..256u16 {
        table[i as usize] = i as u8;
    }
    let mut output = Vec::with_capacity(data.len());

    for &idx in data {
        let pos = idx as usize;
        let byte = unsafe { *table.get_unchecked(pos) };
        output.push(byte);
        if pos > 0 {
            table.copy_within(0..pos, 1);
            table[0] = byte;
        }
    }

    output
}

pub fn rle0_encode(data: &[u8]) -> Vec<u8> {
    const MAX_RUN: u32 = 0x3FFFFF;
    let mut output = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        if data[i] == 0 {
            let mut total_run = 0u32;
            while i < data.len() && data[i] == 0 {
                total_run += 1;
                i += 1;
            }
            while total_run > 0 {
                let run = total_run.min(MAX_RUN);
                total_run -= run;
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
            let new_len = output.len() + run as usize;
            output.resize(new_len, 0);
        } else {
            output.push(data[i]);
            i += 1;
        }
    }

    output
}
