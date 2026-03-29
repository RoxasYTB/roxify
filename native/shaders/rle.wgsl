@group(0) @binding(0) var<storage, read> input_data: array<u32>;
@group(0) @binding(1) var<storage, read_write> output_data: array<atomic<u32>>;
@group(0) @binding(2) var<storage, read_write> output_counts: array<atomic<u32>>;
@group(0) @binding(3) var<uniform> params: RleParams;

struct RleParams {
    chunk_size: u32,
    num_chunks: u32,
    total_len: u32,
    _pad: u32,
}

fn read_byte(idx: u32) -> u32 {
    let word = input_data[idx / 4u];
    return (word >> ((idx % 4u) * 8u)) & 0xFFu;
}

@compute @workgroup_size(256)
fn count_zeros(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if idx >= params.total_len {
        return;
    }
    if read_byte(idx) == 0u {
        atomicAdd(&output_counts[0], 1u);
    }
}
