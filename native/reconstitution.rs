use image::{GenericImageView, Rgba, RgbaImage};
use std::cmp::{max, min};

pub fn crop_and_reconstitute(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(png_data)
        .map_err(|e| format!("Failed to load PNG: {}", e))?;

    let (width, height) = img.dimensions();
    let doubled_width = width * 2;
    let doubled_height = height * 2;

    let doubled = img.resize_exact(
        doubled_width,
        doubled_height,
        image::imageops::FilterType::Nearest,
    );

    let doubled_rgba = doubled.to_rgba8();

    fn get_pixel(img: &RgbaImage, x: u32, y: u32) -> [u8; 4] {
        let p = img.get_pixel(x, y);
        [p[0], p[1], p[2], p[3]]
    }

    fn eq_rgb(a: [u8; 4], b: [u8; 4]) -> bool {
        a[0] == b[0] && a[1] == b[1] && a[2] == b[2]
    }

    fn find_pattern(
        img: &RgbaImage,
        start_x: i32,
        start_y: i32,
        dir_x: i32,
        dir_y: i32,
        pattern: [[u8; 3]; 2],
    ) -> Option<(i32, i32)> {
        let w = img.width() as i32;
        let h = img.height() as i32;

        let mut y = start_y;
        loop {
            if dir_y > 0 && y >= h {
                break;
            }
            if dir_y < 0 && y < 0 {
                break;
            }
            if dir_y == 0 && y != start_y {
                break;
            }

            let mut x = start_x;
            loop {
                if dir_x > 0 && x >= w {
                    break;
                }
                if dir_x < 0 && x < 0 {
                    break;
                }
                if dir_x == 0 && x != start_x {
                    break;
                }

                if x >= 0 && x < w && y >= 0 && y < h {
                    let p = get_pixel(img, x as u32, y as u32);
                    if p[0] == 255 && p[1] == 0 && p[2] == 0 {
                        let mut nx = x + dir_x;
                        while nx >= 0 && nx < w && eq_rgb(get_pixel(img, nx as u32, y as u32), p) {
                            nx += dir_x;
                        }

                        if nx >= 0 && nx < w {
                            let a = get_pixel(img, nx as u32, y as u32);
                            let mut nx2 = nx + dir_x;
                            while nx2 >= 0 && nx2 < w && eq_rgb(get_pixel(img, nx2 as u32, y as u32), a) {
                                nx2 += dir_x;
                            }

                            if nx2 >= 0 && nx2 < w {
                                let b = get_pixel(img, nx2 as u32, y as u32);
                                if a[0] == pattern[0][0]
                                    && a[1] == pattern[0][1]
                                    && a[2] == pattern[0][2]
                                    && b[0] == pattern[1][0]
                                    && b[1] == pattern[1][1]
                                    && b[2] == pattern[1][2]
                                {
                                    return Some((x, y));
                                }
                            }
                        }
                    }
                }

                if dir_x == 0 {
                    break;
                }
                x += dir_x;
            }

            if dir_y == 0 {
                break;
            }
            y += dir_y;
        }

        None
    }

    let start_point = find_pattern(&doubled_rgba, 0, 0, 1, 1, [[0, 255, 0], [0, 0, 255]])
        .ok_or_else(|| "Start pattern not found".to_string())?;

    let end_point = find_pattern(
        &doubled_rgba,
        doubled_width as i32 - 1,
        doubled_height as i32 - 1,
        -1,
        -1,
        [[0, 255, 0], [0, 0, 255]],
    )
    .ok_or_else(|| "End pattern not found".to_string())?;

    let sx1 = min(start_point.0, end_point.0);
    let sy1 = min(start_point.1, end_point.1);
    let sx2 = max(start_point.0, end_point.0);
    let sy2 = max(start_point.1, end_point.1);

    let crop_w = (sx2 - sx1 + 1) as u32;
    let crop_h = (sy2 - sy1 + 1) as u32;

    if crop_w == 0 || crop_h == 0 {
        return Err("Invalid crop dimensions".to_string());
    }

    let cropped = image::imageops::crop_imm(&doubled_rgba, sx1 as u32, sy1 as u32, crop_w, crop_h).to_image();

    let new_width = crop_w;
    let new_height = crop_h + 1;
    let mut out = RgbaImage::from_pixel(new_width, new_height, Rgba([0, 0, 0, 255]));

    for y in 0..crop_h {
        for x in 0..crop_w {
            let pixel = cropped.get_pixel(x, y);
            out.put_pixel(x, y, *pixel);
        }
    }

    for x in 0..new_width {
        out.put_pixel(x, crop_h - 1, Rgba([0, 0, 0, 255]));
        out.put_pixel(x, crop_h, Rgba([0, 0, 0, 255]));
    }

    if new_width >= 3 {
        let bgr_start = new_width - 3;
        let bgr = [[0, 0, 255], [0, 255, 0], [255, 0, 0]];
        for k in 0..3 {
            out.put_pixel(bgr_start + k, crop_h, Rgba([bgr[k as usize][0], bgr[k as usize][1], bgr[k as usize][2], 255]));
        }
    }

    let mut compressed_lines: Vec<Vec<[u8; 4]>> = Vec::new();
    for y in 0..new_height {
        let mut line = Vec::new();
        for x in 0..new_width {
            let p = out.get_pixel(x, y);
            line.push([p[0], p[1], p[2], p[3]]);
        }

        let is_all_black = line.iter().all(|p| p[0] == 0 && p[1] == 0 && p[2] == 0 && p[3] == 255);

        let is_duplicate = if compressed_lines.is_empty() {
            false
        } else {
            let last = compressed_lines.last().unwrap();
            line.iter().zip(last.iter()).all(|(a, b)| a == b)
        };

        if !is_all_black && !is_duplicate {
            compressed_lines.push(line);
        }
    }

    if compressed_lines.is_empty() {
        let fallback = RgbaImage::from_pixel(1, 1, Rgba([0, 0, 0, 255]));
        let mut output = Vec::new();
        fallback.write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Png)
            .map_err(|e| format!("Failed to encode PNG: {}", e))?;
        return Ok(output);
    }

    let final_height = compressed_lines.len() as u32;
    let mut final_width = new_width;
    let mut final_out = RgbaImage::from_pixel(final_width, final_height, Rgba([0, 0, 0, 255]));

    for y in 0..final_height {
        for x in 0..final_width {
            let p = compressed_lines[y as usize][x as usize];
            final_out.put_pixel(x, y, Rgba([p[0], p[1], p[2], p[3]]));
        }
    }

    if final_height >= 1 && final_width >= 3 {
        let last_y = final_height - 1;
        for k in 0..3 {
            final_out.put_pixel(final_width - 3 + k, last_y, Rgba([0, 0, 0, 255]));
        }
    }

    if final_width >= 2 {
        let mut kept = Vec::new();
        for x in 0..final_width {
            if kept.is_empty() {
                kept.push(x);
                continue;
            }

            let prev_x = *kept.last().unwrap();
            let mut same = true;
            for y in 0..final_height {
                let a = final_out.get_pixel(prev_x, y);
                let b = final_out.get_pixel(x, y);
                if a[0] != b[0] || a[1] != b[1] || a[2] != b[2] || a[3] != b[3] {
                    same = false;
                    break;
                }
            }

            if !same {
                kept.push(x);
            }
        }

        if kept.len() != final_width as usize {
            let new_final_width = kept.len() as u32;
            let mut new_out = RgbaImage::from_pixel(new_final_width, final_height, Rgba([0, 0, 0, 255]));

            for (nx, &sx) in kept.iter().enumerate() {
                for y in 0..final_height {
                    let pixel = final_out.get_pixel(sx, y);
                    new_out.put_pixel(nx as u32, y, *pixel);
                }
            }

            final_out = new_out;
            final_width = new_final_width;
        }
    }

    if final_height >= 2 && final_width >= 3 {
        let second_last_y = final_height - 2;
        let bgr_seq = [[0, 0, 255], [0, 255, 0], [255, 0, 0]];
        let mut has_bgr = true;
        for k in 0..3 {
            let p = final_out.get_pixel(final_width - 3 + k, second_last_y);
            if p[0] != bgr_seq[k as usize][0] || p[1] != bgr_seq[k as usize][1] || p[2] != bgr_seq[k as usize][2] {
                has_bgr = false;
                break;
            }
        }

        if has_bgr {
            for k in 0..3 {
                final_out.put_pixel(final_width - 3 + k, second_last_y, Rgba([0, 0, 0, 255]));
            }
        }
    }

    if final_height >= 1 && final_width >= 1 {
        let last_y_final = final_height - 1;
        let bgr_seq = [[0, 0, 255], [0, 255, 0], [255, 0, 0]];
        for k in 0..3 {
            let sx = final_width as i32 - 3 + k;
            if sx >= 0 {
                final_out.put_pixel(sx as u32, last_y_final, Rgba([bgr_seq[k as usize][0], bgr_seq[k as usize][1], bgr_seq[k as usize][2], 255]));
            }
        }
    }

    let mut output = Vec::new();
    final_out.write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(output)
}
