mod bwt;
mod mtf;
mod rans_byte;
mod context_mixing;
mod pool;
mod hybrid;

fn main() {
    println!("Testing small inputs through full pipeline...");

    for size in [1, 2, 3, 4, 5, 6, 10, 100] {
        let data: Vec<u8> = (0..size).map(|i| (i % 256) as u8).collect();
        print!("Size {}: ", size);

        match hybrid::compress_high_performance(&data) {
            Ok((compressed, _stats)) => {
                match hybrid::decompress_high_performance(&compressed) {
                    Ok(decompressed) => {
                        if decompressed == data {
                            println!("OK (compressed {} -> {} bytes)", size, compressed.len());
                        } else {
                            println!("MISMATCH!");
                        }
                    }
                    Err(e) => println!("DECOMPRESS ERROR: {}", e),
                }
            }
            Err(e) => println!("COMPRESS ERROR: {}", e),
        }
    }
}
