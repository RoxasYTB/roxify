@group(0) @binding(0) var<storage, read> input_data: array<u32>;
@group(0) @binding(1) var<storage, read_write> output_data: array<u32>;
@group(0) @binding(2) var<uniform> params: MtfParams;

struct MtfParams {
    chunk_size: u32,
    num_chunks: u32,
    total_len: u32,
    _pad: u32,
}

fn read_byte(idx: u32) -> u32 {
    let word = input_data[idx / 4u];
    return (word >> ((idx % 4u) * 8u)) & 0xFFu;
}

fn write_byte_packed(word_idx: u32, byte_off: u32, val: u32, current: u32) -> u32 {
    let shift = byte_off * 8u;
    return (current & ~(0xFFu << shift)) | (val << shift);
}

@compute @workgroup_size(256)
fn mtf_encode(@builtin(workgroup_id) wg_id: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
    let chunk_id = wg_id.x;
    if chunk_id >= params.num_chunks {
        return;
    }

    if lid.x > 0u {
        return;
    }

    let start = chunk_id * params.chunk_size;
    let end = min(start + params.chunk_size, params.total_len);

    var table: array<u32, 256>;
    for (var i = 0u; i < 256u; i++) {
        table[i] = i;
    }

    var current_word: u32 = 0u;
    var current_word_idx: u32 = start / 4u;

    for (var i = start; i < end; i++) {
        let byte_val = read_byte(i);
        var pos = 0u;
        for (var j = 0u; j < 256u; j++) {
            if table[j] == byte_val {
                pos = j;
                break;
            }
        }

        let word_idx = i / 4u;
        let byte_off = i % 4u;

        if word_idx != current_word_idx {
            output_data[current_word_idx] = current_word;
            current_word_idx = word_idx;
            current_word = 0u;
        }
        current_word = write_byte_packed(word_idx, byte_off, pos, current_word);

        if pos > 0u {
            let val = table[pos];
            for (var j = pos; j > 0u; j--) {
                table[j] = table[j - 1u];
            }
            table[0u] = val;
        }
    }
    output_data[current_word_idx] = current_word;
}
