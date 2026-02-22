use rand::Rng;

fn main() {
    let mut rng = rand::thread_rng();
    let logical_size = 50;
    let scale_x = 1.11;
    
    let scaled_width = (logical_size as f64 * scale_x).round() as usize;
    
    let mut physical_row = vec![0; scaled_width];
    for lx in 0..logical_size {
        let color = rng.gen_range(0..256);
        let start_px = (lx as f64 * scale_x).round() as usize;
        let end_px = ((lx + 1) as f64 * scale_x).round() as usize;
        for px in start_px..end_px {
            if px < scaled_width {
                physical_row[px] = color;
            }
        }
    }
    
    let mut transitions = 0;
    for px in 1..scaled_width {
        if physical_row[px] != physical_row[px - 1] {
            transitions += 1;
        }
    }
    
    println!("Estimated logical size: {}", transitions + 1);
}
