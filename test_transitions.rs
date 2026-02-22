fn color_dist(a: [u8; 4], b: [u8; 4]) -> i32 {
    (a[0] as i32 - b[0] as i32).abs() +
    (a[1] as i32 - b[1] as i32).abs() +
    (a[2] as i32 - b[2] as i32).abs()
}

fn main() {
    let logical_size = 50;
    let scale_x = 1.11;
    
    let mut logical_row = Vec::new();
    for i in 0..logical_size {
        logical_row.push([(i * 5) as u8, (i * 5) as u8, (i * 5) as u8, 255]);
    }
    
    let scaled_width = (logical_size as f64 * scale_x).round() as usize;
    let mut physical_row = vec![[0, 0, 0, 255]; scaled_width];
    
    for lx in 0..logical_size {
        let start_px = (lx as f64 * scale_x).round() as usize;
        let end_px = ((lx + 1) as f64 * scale_x).round() as usize;
        for px in start_px..end_px {
            if px < scaled_width {
                physical_row[px] = logical_row[lx];
            }
        }
    }
    
    let mut transitions = 0;
    for px in 1..scaled_width {
        if color_dist(physical_row[px], physical_row[px - 1]) > 0 {
            transitions += 1;
        }
    }
    
    println!("Logical size: {}", logical_size);
    println!("Scaled width: {}", scaled_width);
    println!("Transitions: {}", transitions);
    println!("Estimated logical size: {}", transitions + 1);
}
