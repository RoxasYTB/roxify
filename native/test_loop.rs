use image::{RgbaImage, Rgba, imageops};
use rand::Rng;

fn generate_mock_encoded_payload(size: u32) -> RgbaImage {
    let mut img = RgbaImage::new(size, size);
    let mut rng = rand::thread_rng();
    for y in 0..size {
        for x in 0..size {
            img.put_pixel(x, y, Rgba([rng.gen(), rng.gen(), rng.gen(), 255]));
        }
    }
    img.put_pixel(0, 0, Rgba([255, 0, 0, 255]));
    img.put_pixel(1, 0, Rgba([0, 255, 0, 255]));
    img.put_pixel(2, 0, Rgba([0, 0, 255, 255]));
    img.put_pixel(size - 3, size - 1, Rgba([0, 0, 255, 255]));
    img.put_pixel(size - 2, size - 1, Rgba([0, 255, 0, 255]));
    img.put_pixel(size - 1, size - 1, Rgba([255, 0, 0, 255]));
    img
}

fn main() {
    let mut rng = rand::thread_rng();
    let logical_size = 50;
    for i in 0..100 {
        let original_payload = generate_mock_encoded_payload(logical_size);
        let scale_x = rng.gen_range(1.1..15.9);
        let scale_y = rng.gen_range(1.1..15.9);
        let scaled_width = (logical_size as f64 * scale_x).round() as u32;
        let scaled_height = (logical_size as f64 * scale_y).round() as u32;
        let scaled_payload = imageops::resize(&original_payload, scaled_width, scaled_height, imageops::FilterType::Nearest);
        
        let bg_width = 2000;
        let bg_height = 2000;
        let mut complex_bg = RgbaImage::new(bg_width, bg_height);
        for p in complex_bg.pixels_mut() { *p = Rgba([rng.gen(), rng.gen(), rng.gen(), 255]); }
        
        let offset_x = rng.gen_range(50..(bg_width - scaled_width - 50)) as i64;
        let offset_y = rng.gen_range(50..(bg_height - scaled_height - 50)) as i64;
        imageops::overlay(&mut complex_bg, &scaled_payload, offset_x, offset_y);
        
        let mut input_png_bytes = Vec::new();
        complex_bg.write_to(&mut std::io::Cursor::new(&mut input_png_bytes), image::ImageFormat::Png).unwrap();
        
        let recovered_bytes = roxify_native::crop_and_reconstitute(&input_png_bytes).unwrap();
        let recovered_img = image::load_from_memory(&recovered_bytes).unwrap().to_rgba8();
        
        if recovered_img.width() != logical_size || recovered_img.height() != logical_size {
            println!("FAILED at iteration {}! scale_x={}, scale_y={}", i, scale_x, scale_y);
            std::process::exit(1);
        }
        println!("Iteration {} passed", i);
    }
    println!("ALL PASSED");
}
