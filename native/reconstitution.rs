use image::{Rgba, RgbaImage};
use std::cmp::min;

fn color_dist(a: [u8; 4], b: [u8; 4]) -> i32 {
    (a[0] as i32 - b[0] as i32).abs() +
    (a[1] as i32 - b[1] as i32).abs() +
    (a[2] as i32 - b[2] as i32).abs()
}

fn is_color(p: [u8; 4], target: [u8; 3]) -> bool {
    color_dist(p, [target[0], target[1], target[2], 255]) < 50
}

fn transition_count(pixels: &[[u8; 4]]) -> u32 {
    let mut count = 0u32;
    for i in 1..pixels.len() {
        if color_dist(pixels[i], pixels[i - 1]) > 0 {
            count += 1;
        }
    }
    count
}

fn count_transitions_h(get_pixel: &impl Fn(u32, u32) -> [u8; 4], sx: u32, ex: u32, y: u32) -> u32 {
    let row: Vec<[u8; 4]> = (sx..ex).map(|x| get_pixel(x, y)).collect();
    transition_count(&row)
}

fn count_transitions_v(get_pixel: &impl Fn(u32, u32) -> [u8; 4], x: u32, sy: u32, ey: u32) -> u32 {
    let col: Vec<[u8; 4]> = (sy..ey).map(|y| get_pixel(x, y)).collect();
    transition_count(&col)
}

fn median(v: &mut Vec<u32>) -> u32 {
    if v.is_empty() { return 0; }
    v.sort_unstable();
    v[v.len() / 2]
}

// Compte les transitions INTRA-blocs en utilisant le découpage NN de la crate image
// Formule: pixel physique x → bloc logique floor((x + 0.5) × lw / pw)
// Pour le vrai lw, = 0 (chaque bloc NN a une seule couleur)
fn intra_block_transitions_h(
    get_pixel: &impl Fn(u32, u32) -> [u8; 4],
    sx: u32, ex: u32, y: u32, candidate: u32,
) -> u32 {
    let pw = (ex - sx) as f32;
    let lw = candidate as f32;
    let ratio = lw / pw;
    let row: Vec<[u8; 4]> = (sx..ex).map(|x| get_pixel(x, y)).collect();
    let mut count = 0u32;
    for i in 1..row.len() {
        let lx_prev = ((i as f32 - 0.5) * ratio) as u32;
        let lx_curr = ((i as f32 + 0.5) * ratio) as u32;
        if lx_prev == lx_curr && color_dist(row[i], row[i - 1]) > 0 {
            count += 1;
        }
    }
    count
}

fn intra_block_transitions_v(
    get_pixel: &impl Fn(u32, u32) -> [u8; 4],
    x: u32, sy: u32, ey: u32, candidate: u32,
) -> u32 {
    let ph = (ey - sy) as f32;
    let lh = candidate as f32;
    let ratio = lh / ph;
    let col: Vec<[u8; 4]> = (sy..ey).map(|y| get_pixel(x, y)).collect();
    let mut count = 0u32;
    for i in 1..col.len() {
        let ly_prev = ((i as f32 - 0.5) * ratio) as u32;
        let ly_curr = ((i as f32 + 0.5) * ratio) as u32;
        if ly_prev == ly_curr && color_dist(col[i], col[i - 1]) > 0 {
            count += 1;
        }
    }
    count
}

pub fn crop_and_reconstitute(png_data: &[u8]) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(png_data).unwrap();
    let rgba = img.to_rgba8();
    let width = rgba.width();
    let height = rgba.height();

    let get_pixel = |x: u32, y: u32| -> [u8; 4] {
        let p = rgba.get_pixel(x, y);
        [p[0], p[1], p[2], p[3]]
    };

    // (sx, sy, total_marker_w, marker_h)
    let mut start_infos: Vec<(u32, u32, u32, u32)> = Vec::new();
    for y in 0..height {
        let mut x = 0;
        while x < width {
            if is_color(get_pixel(x, y), [255, 0, 0]) {
                let sx = x;
                let mut rx = x;
                while rx < width && is_color(get_pixel(rx, y), [255, 0, 0]) { rx += 1; }
                let w_r = rx - sx;
                if w_r > 0 {
                    let mut gx = rx;
                    while gx < width && is_color(get_pixel(gx, y), [0, 255, 0]) { gx += 1; }
                    let w_g = gx - rx;
                    let ratio_g = w_g as f64 / w_r as f64;
                    if w_g > 0 && ratio_g > 0.3 && ratio_g < 3.0 {
                        let mut bx = gx;
                        while bx < width && is_color(get_pixel(bx, y), [0, 0, 255]) { bx += 1; }
                        let w_b = bx - gx;
                        let ratio_b = w_b as f64 / w_r as f64;
                        if w_b > 0 && ratio_b > 0.3 && ratio_b < 3.0 {
                            let mut ry = y;
                            while ry < height && is_color(get_pixel(sx, ry), [255, 0, 0]) { ry += 1; }
                            let h_r = ry - y;
                            start_infos.push((sx, y, w_r + w_g + w_b, h_r));
                        }
                    }
                }
                x = rx;
            } else { x += 1; }
        }
    }

    // (ex, ey, total_marker_w, marker_h)
    let mut end_infos: Vec<(u32, u32, u32, u32)> = Vec::new();
    for y in (0..height).rev() {
        let mut x = width as i32 - 1;
        while x >= 0 {
            if is_color(get_pixel(x as u32, y), [255, 0, 0]) {
                let ex = x as u32 + 1;
                let mut rx = x;
                while rx >= 0 && is_color(get_pixel(rx as u32, y), [255, 0, 0]) { rx -= 1; }
                let w_r = (x - rx) as u32;
                if w_r > 0 {
                    let mut gx = rx;
                    while gx >= 0 && is_color(get_pixel(gx as u32, y), [0, 255, 0]) { gx -= 1; }
                    let w_g = (rx - gx) as u32;
                    let ratio_g = w_g as f64 / w_r as f64;
                    if w_g > 0 && ratio_g > 0.3 && ratio_g < 3.0 {
                        let mut bx = gx;
                        while bx >= 0 && is_color(get_pixel(bx as u32, y), [0, 0, 255]) { bx -= 1; }
                        let w_b = (gx - bx) as u32;
                        let ratio_b = w_b as f64 / w_r as f64;
                        if w_b > 0 && ratio_b > 0.3 && ratio_b < 3.0 {
                            let red_col = x as u32;
                            let mut ry = y as i32;
                            while ry >= 0 && is_color(get_pixel(red_col, ry as u32), [255, 0, 0]) { ry -= 1; }
                            let h_r = (y as i32 - ry) as u32;
                            end_infos.push((ex, y + 1, w_b + w_g + w_r, h_r));
                        }
                    }
                }
                x = rx;
            } else { x -= 1; }
        }
    }

    // Déduplique les marqueurs proches : garde pour chaque cluster (même ex, ey à ±marker_w)
    // le plus grand. On trie par taille décroissante et on supprime les doublons proches.
    start_infos.sort_by(|a, b| (b.2 * b.3).cmp(&(a.2 * a.3)));
    let mut deduped_starts: Vec<(u32, u32, u32, u32)> = Vec::new();
    for s in &start_infos {
        let is_dup = deduped_starts.iter().any(|d: &(u32, u32, u32, u32)| {
            (s.0 as i64 - d.0 as i64).abs() <= d.2 as i64 &&
            (s.1 as i64 - d.1 as i64).abs() <= d.2 as i64
        });
        if !is_dup { deduped_starts.push(*s); }
        if deduped_starts.len() >= 8 { break; }
    }

    end_infos.sort_by(|a, b| {
        let sa = a.2 * a.3;
        let sb = b.2 * b.3;
        sb.cmp(&sa).then(b.1.cmp(&a.1))
    });
    let mut deduped_ends: Vec<(u32, u32, u32, u32)> = Vec::new();
    for e in &end_infos {
        let is_dup = deduped_ends.iter().any(|d: &(u32, u32, u32, u32)| {
            (e.0 as i64 - d.0 as i64).abs() <= d.2 as i64 &&
            (e.1 as i64 - d.1 as i64).abs() <= d.2 as i64
        });
        if !is_dup { deduped_ends.push(*e); }
        if deduped_ends.len() >= 8 { break; }
    }


    let mut best_logical_w = 0u32;
    let mut best_logical_h = 0u32;
    // Score: (size_err_permille, inverse_area) — lower is better
    let mut best_score = (u64::MAX, u64::MAX);
    let mut best_sx = 0u32;
    let mut best_sy = 0u32;
    let mut best_ex = 0u32;
    let mut best_ey = 0u32;

    for &(sx, sy, start_marker_w, _) in &deduped_starts {
        for &(ex_raw, ey_raw, end_marker_w, _) in &deduped_ends {
            if ex_raw <= sx || ey_raw <= sy { continue; }

            // Tester also ex-1 / ey-1 pour compenser pixels parasites de fond au bord du marqueur
            for ex_adj in 0u32..=1u32 {
            for ey_adj in 0u32..=1u32 {
            let ex = if ex_raw > sx + ex_adj { ex_raw - ex_adj } else { continue };
            let ey = if ey_raw > sy + ey_adj { ey_raw - ey_adj } else { continue };

            let phys_w = ex - sx;
            let phys_h = ey - sy;
            if phys_w < 3 || phys_h < 3 || phys_w > 1800 || phys_h > 1800 { continue; }


            // Estimation depuis les marqueurs (start_marker_w ≈ 3 × scale_x, end_marker_w ≈ 3 × scale_x)
            // Prend la moyenne pour réduire l'erreur d'arrondi
            let est_scale_x = (start_marker_w as f64 + end_marker_w as f64) / 6.0;
            let est_lw_f = phys_w as f64 / est_scale_x;
            // start_marker_h ≈ scale_y (marqueur occupe 1px logique → scale_y pixels physiques)
            let start_h = start_infos.iter().find(|s| s.0 == sx && s.1 == sy).map(|s| s.3).unwrap_or(0);
            let end_h = end_infos.iter().find(|e| e.0 == ex + ex_adj && e.1 == ey + ey_adj).map(|e| e.3).unwrap_or(0);
            let est_lh_f = if start_h > 0 || end_h > 0 {
                let scale_y_est = if start_h > 0 && end_h > 0 {
                    (start_h as f64 + end_h as f64) / 2.0
                } else if start_h > 0 { start_h as f64 } else { end_h as f64 };
                phys_h as f64 / scale_y_est
            } else {
                phys_h as f64 / est_scale_x  // fallback: assume scale_y ≈ scale_x
            };

            // Comptage de transitions: source fiable pour lw et lh
            // On scanne toute la zone [sx,ex) mais en ignorant les 2 premières et 2 dernières transitions
            // (celles-ci peuvent être parasites si un pixel de fond s'est glissé dans la zone)
            // La vraie valeur théorique est lw-1 transitions (N blocs logiques → N-1 frontières)

            let n_lines = 13u32;
            let mut h_counts: Vec<u32> = (1..=n_lines).filter_map(|j| {
                let y = sy + phys_h * (j * 7 / (n_lines + 1) + 1) / 8;
                if y >= ey { return None; }
                Some(count_transitions_h(&get_pixel, sx, ex, y))
            }).collect();
            let mut v_counts: Vec<u32> = (1..=n_lines).filter_map(|j| {
                let x = sx + phys_w * (j * 7 / (n_lines + 1) + 1) / 8;
                if x >= ex { return None; }
                Some(count_transitions_v(&get_pixel, x, sy, ey))
            }).collect();
            let h_med = median(&mut h_counts) as f64;
            let v_med = median(&mut v_counts) as f64;
            // Transitions dans zone [sx,ex) = lw-1 (correct) ou lw (1 pixel de fond extra)
            // On teste les deux comme candidats
            let lw_trans_lo = h_med;
            let lw_trans_hi = h_med + 1.0;
            let lh_trans_lo = v_med;
            let lh_trans_hi = v_med + 1.0;
            let lw_cand_lo = lw_trans_lo.round() as u32;
            let lw_cand_hi = lw_trans_hi.round() as u32;
            let lh_cand_lo = lh_trans_lo.round() as u32;
            let lh_cand_hi = lh_trans_hi.round() as u32;


            // Vérifie cohérence grossière
            let lw_diff_lo = (lw_cand_lo as f64 - est_lw_f).abs();
            let lw_diff_hi = (lw_cand_hi as f64 - est_lw_f).abs();
            if lw_diff_lo > est_lw_f * 0.25 + 3.0 && lw_diff_hi > est_lw_f * 0.25 + 3.0 { continue; }

            let n_scan = 7u32;
            let lw = if lw_cand_lo == lw_cand_hi {
                lw_cand_hi
            } else {
                let score_lo: u32 = (1..=n_scan).filter_map(|j| {
                    let y = sy + phys_h * j / (n_scan + 1);
                    if y >= ey { return None; }
                    Some(intra_block_transitions_h(&get_pixel, sx, ex, y, lw_cand_lo))
                }).sum();
                let score_hi: u32 = (1..=n_scan).filter_map(|j| {
                    let y = sy + phys_h * j / (n_scan + 1);
                    if y >= ey { return None; }
                    Some(intra_block_transitions_h(&get_pixel, sx, ex, y, lw_cand_hi))
                }).sum();

                if score_lo < score_hi { lw_cand_lo } else { lw_cand_hi }
            };

            // Pour lh: tester {lh_cand_lo, lh_cand_hi, lh_cand_hi+1} car v_med peut être
            // sous-estimé de 1 (pixels marqueurs dans les colonnes scannées réduisent les transitions)
            // Tie-break par proximité à est_lh_f quand les scores intra sont égaux
            let lh_candidates: Vec<u32> = {
                let mut c = vec![lh_cand_lo, lh_cand_hi, lh_cand_hi + 1];
                c.sort_unstable();
                c.dedup();
                c
            };
            let lh = {
                let mut best_cand = lh_cand_hi;
                let mut best_intra = u32::MAX;
                let mut best_dist = f64::MAX;
                for &cand in &lh_candidates {
                    if cand < 3 { continue; }
                    let score: u32 = (1..=n_scan).filter_map(|j| {
                        let x = sx + phys_w * j / (n_scan + 1);
                        if x >= ex { return None; }
                        Some(intra_block_transitions_v(&get_pixel, x, sy, ey, cand))
                    }).sum();
                    let dist = (cand as f64 - est_lh_f).abs();
                    if score < best_intra || (score == best_intra && dist < best_dist) {
                        best_intra = score;
                        best_dist = dist;
                        best_cand = cand;
                    }
                }
                best_cand
            };

            // Cohérence des marqueurs avec le lw sélectionné
            let lw_size_err = {
                let scx = phys_w as f64 / lw as f64;
                let emw = 3.0 * scx;
                let e1 = ((start_marker_w as f64 - emw).abs() / emw * 1000.0) as u64;
                let e2 = ((end_marker_w   as f64 - emw).abs() / emw * 1000.0) as u64;
                e1 + e2
            };

            // Filtre taille min logique
            if lw < 3 || lh < 3 { continue; }

            let size_err = lw_size_err;
            if size_err > 500 { continue; }

            // Filtre final : l'intra-block score pour le lw sélectionné doit être faible
            // (pour une vraie paire avec l'image NN-scalée, = 0; pour une zone de fond aléatoire, >> 0)
            let intra_final: u32 = (1..=n_scan).filter_map(|j| {
                let y = sy + phys_h * j / (n_scan + 1);
                if y >= ey { return None; }
                Some(intra_block_transitions_h(&get_pixel, sx, ex, y, lw))
            }).sum();
            // Filtre : la zone encodée NN a des blocs monochromes → intra très bas
            // Zone de fond aléatoire → intra ≈ lw × n_scan × 0.99 >> 0
            // Seuil : lw/8 × n_scan pour permettre ≈ lw/8 pixels parasites
            let intra_threshold = (lw as u32 / 8 + 1) * n_scan;

            if intra_final > intra_threshold { continue; }

            // Favori : pas d'ajustement de bord, puis plus grande zone, puis plus petit size_err
            let area = phys_w as u64 * phys_h as u64;
            let adj_penalty = (ex_adj + ey_adj) as u64 * 1000;
            let score = (size_err + adj_penalty, u64::MAX - area);

            if score < best_score {

                best_score = score;
                best_logical_w = lw;
                best_logical_h = lh;
                best_sx = sx;
                best_sy = sy;
                best_ex = ex;
                best_ey = ey;
            }
            } // end ey_adj
            } // end ex_adj
        }
    }

    if best_score == (u64::MAX, u64::MAX) {
        return Err("No valid markers found".to_string());
    }

    let sx = best_sx;
    let sy = best_sy;
    let ex = best_ex;
    let ey = best_ey;
    let phys_w = ex - sx;
    let phys_h = ey - sy;
    let scale_x = phys_w as f64 / best_logical_w as f64;
    let scale_y = phys_h as f64 / best_logical_h as f64;

    let mut out = RgbaImage::from_pixel(best_logical_w, best_logical_h, Rgba([0, 0, 0, 255]));
    for ly in 0..best_logical_h {
        for lx in 0..best_logical_w {
            let px = (sx as f64 + (lx as f64 + 0.5) * scale_x) as u32;
            let py = (sy as f64 + (ly as f64 + 0.5) * scale_y) as u32;
            out.put_pixel(lx, ly, Rgba(get_pixel(min(px, width - 1), min(py, height - 1))));
        }
    }

    let mut output = Vec::new();
    out.write_to(&mut std::io::Cursor::new(&mut output), image::ImageFormat::Png).unwrap();
    Ok(output)
}

#[cfg(test)]
mod tests {
    use image::{RgbaImage, Rgba, imageops};
    use rand::Rng;
    use super::*;

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

    #[test]
    fn test_extreme_deformation_and_background() {
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
            let recovered_bytes = crop_and_reconstitute(&input_png_bytes).unwrap();
            let recovered_img = image::load_from_memory(&recovered_bytes).unwrap().to_rgba8();
            assert_eq!(recovered_img.height(), logical_size, "Failed at iteration {} with scale_x={}, scale_y={}", i, scale_x, scale_y);
            assert_eq!(recovered_img.width(), logical_size, "Failed at iteration {} with scale_x={}, scale_y={}", i, scale_x, scale_y);
        }
    }
}

#[cfg(test)]
mod test_transitions {
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

    #[test]
    fn test_intra_block_formula() {
        let logical_size = 50u32;
        let mut img = RgbaImage::new(logical_size, logical_size);
        let mut rng = rand::thread_rng();
        for y in 0..logical_size {
            for x in 0..logical_size {
                img.put_pixel(x, y, Rgba([rng.gen(), rng.gen(), rng.gen(), 255]));
            }
        }
        let mut had_failure = false;
        for scale_x_10 in 11..=159u32 {
            let scale_x = scale_x_10 as f64 / 10.0;
            let pw = (logical_size as f64 * scale_x).round() as u32;
            let scaled = imageops::resize(&img, pw, logical_size, imageops::FilterType::Nearest);
            let get_pixel = |x: u32, y: u32| -> [u8; 4] {
                let p = scaled.get_pixel(x, y);
                [p[0], p[1], p[2], p[3]]
            };
            let intra_50 = super::intra_block_transitions_h(&get_pixel, 0, pw, 0, 50);
            if intra_50 > 0 {
                println!("FAIL: scale_x={scale_x:.1} pw={pw} lw=50: intra={intra_50}");
                had_failure = true;
            }
        }
        assert!(!had_failure, "Some scale_x values gave intra > 0 for true lw=50");
    }


}
