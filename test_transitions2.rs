fn color_dist(a: [u8; 4], b: [u8; 4]) -> i32 {
    (a[0] as i32 - b[0] as i32).abs() +
    (a[1] as i32 - b[1] as i32).abs() +
    (a[2] as i32 - b[2] as i32).abs()
}

fn main() {
    let logical_size = 50;
    let scale_x = 1.11;
    
    let scaled_width = (logical_size as f64 * scale_x).round() as usize;
    
    // Simulate transitions at specific columns
    let mut transition_cols = Vec::new();
    for lx in 1..logical_size {
        let px = (lx as f64 * scale_x).round() as usize;
        transition_cols.push(px);
    }
    
    println!("Expected transitions: {}", transition_cols.len());
    
    // Now let's see if we can recover logical_size just by knowing the transitions
    let mut estimated_logical_w = 1;
    let mut last_transition_px = 0;
    for px in 1..scaled_width {
        if transition_cols.contains(&px) {
            estimated_logical_w += 1;
            last_transition_px = px;
        }
    }
    
    println!("Estimated logical size: {}", estimated_logical_w);
}
