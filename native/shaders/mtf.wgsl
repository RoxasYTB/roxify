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

fn write_byte(idx: u32, val: u32) {
    let word_idx = idx / 4u;
    let byte_off = (idx % 4u) * 8u;
    let mask = ~(0xFFu << byte_off);
    let old = atomicLoad(&output_atomic[word_idx]);
    let new_val = (old & mask) | (val << byte_off);
    atomicStore(&output_atomic[word_idx], new_val);
}

@group(0) @binding(3) var<storage, read_write> output_atomic: array<atomic<u32>>;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let chunk_id = gid.x;
    if chunk_id >= params.num_chunks {
        return;
    }

    let start = chunk_id * params.chunk_size;
    let end = min(start + params.chunk_size, params.total_len);

    var table: array<u32, 256>;
    for (var i = 0u; i < 256u; i++) {
        table[i] = i;
    }

    for (var i = start; i < end; i++) {
        let byte_val = read_byte(i);
        var pos = 0u;
        for (var j = 0u; j < 256u; j++) {
            if table[j] == byte_val {
                pos = j;
                break;
            }
        }

        let out_word_idx = i / 4u;
        let out_byte_off = (i % 4u) * 8u;
        let existing = output_data[out_word_idx];
        output_data[out_word_idx] = (existing & ~(0xFFu << out_byte_off)) | (pos << out_byte_off);

        if pos > 0u {
            let val = table[pos];
            for (var j = pos; j > 0u; j--) {
                table[j] = table[j - 1u];
            }
            table[0u] = val;
        }
    }
}
