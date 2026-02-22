#[cfg(test)]
mod tests {
    use image::{RgbaImage, Rgba, imageops};
    use rand::Rng;

    #[test]
    fn test_internal_transitions() {
        let logical_size = 50;
        let mut img = RgbaImage::new(logical_size, logical_size);
        let mut rng = rand::thread_rng();
        for y in 0..logical_size {
            for x in 0..logical_size {
                img.put_pixel(x, y, Rgba([rng.gen(), rng.gen(), rng.gen(), 255]));
            }
        }
        
        let scale_x = 5.865853935599068;
        let scaled_width = (logical_size as f64 * scale_x).round() as u32;
        let scaled_payload = imageops::resize(&img, scaled_width, 50, imageops::FilterType::Nearest);
        
        let phys_w = scaled_width;
        println!("phys_w = {}", phys_w);
        
        for candidate_w in 45..55 {
            let mut internal_transitions = 0;
            for i in 0..candidate_w {
                let start_x = (i as f64 * phys_w as f64 / candidate_w as f64).round() as u32;
                let end_x = ((i + 1) as f64 * phys_w as f64 / candidate_w as f64).round() as u32;
                
                for y in 0..50 {
                    let mut last_color = scaled_payload.get_pixel(start_x, y);
                    for x in start_x+1..end_x {
                        let color = scaled_payload.get_pixel(x, y);
                        if color[0] != last_color[0] || color[1] != last_color[1] || color[2] != last_color[2] {
                            internal_transitions += 1;
                            last_color = color;
                        }
                    }
                }
            }
            println!("W = {}, internal_transitions = {}", candidate_w, internal_transitions);
        }
    }
}
