fn main() {
    let logical_size = 50;
    let scale_x = 1.11;
    
    let scaled_width = (logical_size as f64 * scale_x).round() as usize;
    
    let mut transition_cols = Vec::new();
    for lx in 1..logical_size {
        let px = (lx as f64 * scale_x).round() as usize;
        transition_cols.push(px);
    }
    
    let est_scale_x = 1.0; // From start_marker_w / 3.0
    let min_dist = (est_scale_x * 0.8).floor() as usize;
    let min_dist = if min_dist < 1 { 1 } else { min_dist };
    
    let mut estimated_logical_w = 1;
    let mut last_transition_px = 0;
    for px in 1..scaled_width {
        if transition_cols.contains(&px) {
            if px - last_transition_px >= min_dist {
                estimated_logical_w += 1;
                last_transition_px = px;
            }
        }
    }
    
    println!("Estimated logical size: {}", estimated_logical_w);
}
