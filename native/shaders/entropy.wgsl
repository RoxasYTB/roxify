@group(0) @binding(0) var<storage, read> input_data: array<u32>;
@group(0) @binding(1) var<storage, read_write> histogram: array<atomic<u32>, 256>;
@group(0) @binding(2) var<uniform> params: Params;

struct Params {
    data_len: u32,
    _pad0: u32,
    _pad1: u32,
    _pad2: u32,
}

var<workgroup> local_hist: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>) {
    atomicStore(&local_hist[lid.x], 0u);
    workgroupBarrier();

    let stride = 256u * 256u;
    var idx = gid.x;
    while idx < params.data_len / 4u {
        let packed = input_data[idx];
        let b0 = packed & 0xFFu;
        let b1 = (packed >> 8u) & 0xFFu;
        let b2 = (packed >> 16u) & 0xFFu;
        let b3 = (packed >> 24u) & 0xFFu;
        atomicAdd(&local_hist[b0], 1u);
        atomicAdd(&local_hist[b1], 1u);
        atomicAdd(&local_hist[b2], 1u);
        atomicAdd(&local_hist[b3], 1u);
        idx += stride;
    }

    let remainder_start = (params.data_len / 4u) * 4u;
    if gid.x == 0u {
        for (var r = remainder_start; r < params.data_len; r++) {
            let word_idx = r / 4u;
            let byte_off = r % 4u;
            let packed = input_data[word_idx];
            let b = (packed >> (byte_off * 8u)) & 0xFFu;
            atomicAdd(&local_hist[b], 1u);
        }
    }

    workgroupBarrier();
    atomicAdd(&histogram[lid.x], atomicLoad(&local_hist[lid.x]));
}
