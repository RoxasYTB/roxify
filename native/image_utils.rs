use image::{ImageBuffer, Rgb, RgbImage, ImageFormat, DynamicImage};
use std::io::Cursor;

pub fn sharp_resize(
    input: &[u8],
    width: u32,
    height: u32,
    kernel: &str,
) -> Result<Vec<u8>, String> {
    let img = image::load_from_memory(input)
        .map_err(|e| format!("Failed to load image: {}", e))?;

    let filter = match kernel {
        "nearest" => image::imageops::FilterType::Nearest,
        "bilinear" | "linear" => image::imageops::FilterType::Triangle,
        "cubic" | "bicubic" => image::imageops::FilterType::CatmullRom,
        "lanczos" | "lanczos3" => image::imageops::FilterType::Lanczos3,
        _ => image::imageops::FilterType::Nearest,
    };

    let resized = img.resize_exact(width, height, filter);

    let mut output = Vec::new();
    resized.write_to(&mut Cursor::new(&mut output), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(output)
}

pub fn sharp_raw_pixels(input: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    let img = image::load_from_memory(input)
        .map_err(|e| format!("Failed to load image: {}", e))?;

    let rgb = img.to_rgb8();
    let width = rgb.width();
    let height = rgb.height();
    let raw = rgb.into_raw();

    Ok((raw, width, height))
}

pub fn sharp_metadata(input: &[u8]) -> Result<(u32, u32, String), String> {
    let img = image::load_from_memory(input)
        .map_err(|e| format!("Failed to load image: {}", e))?;

    let width = img.width();
    let height = img.height();
    let format = match img {
        DynamicImage::ImageLuma8(_) => "gray",
        DynamicImage::ImageRgb8(_) => "rgb",
        DynamicImage::ImageRgba8(_) => "rgba",
        _ => "unknown",
    };

    Ok((width, height, format.to_string()))
}

pub fn rgb_to_png(rgb: &[u8], width: u32, height: u32) -> Result<Vec<u8>, String> {
    let img: RgbImage = ImageBuffer::from_raw(width, height, rgb.to_vec())
        .ok_or("Failed to create image from raw RGB data")?;

    let mut output = Vec::new();
    img.write_to(&mut Cursor::new(&mut output), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(output)
}

pub fn png_to_rgb(png: &[u8]) -> Result<(Vec<u8>, u32, u32), String> {
    sharp_raw_pixels(png)
}
