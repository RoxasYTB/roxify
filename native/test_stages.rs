mod bwt;
mod mtf;
mod rans_byte;
mod context_mixing;
mod pool;

fn main() {
    let data = b"banana";

    // Test BWT
    let bwt_result = bwt::bwt_encode(data).unwrap();
    println!("BWT of 'banana': {:?}", String::from_utf8_lossy(&bwt_result.transformed));
    println!("Primary index: {}", bwt_result.primary_index);

    let decoded = bwt::bwt_decode(&bwt_result.transformed, bwt_result.primary_index).unwrap();
    println!("BWT decode: {:?}", String::from_utf8_lossy(&decoded));
    assert_eq!(&decoded, data, "BWT round-trip failed");
    println!("BWT round-trip OK!\n");

    // Test MTF
    let mtf_enc = mtf::mtf_encode(data);
    println!("MTF of 'banana': {:?}", mtf_enc);
    let mtf_dec = mtf::mtf_decode(&mtf_enc);
    assert_eq!(mtf_dec, data, "MTF round-trip failed");
    println!("MTF round-trip OK!\n");

    // Test RLE0
    let test_rle = vec![0, 0, 0, 5, 0, 3, 0, 0, 0, 0, 0, 7];
    let rle_enc = mtf::rle0_encode(&test_rle);
    println!("RLE0 of {:?}: {:?}", test_rle, rle_enc);
    let rle_dec = mtf::rle0_decode(&rle_enc);
    println!("RLE0 decode: {:?}", rle_dec);
    assert_eq!(rle_dec, test_rle, "RLE0 round-trip failed");
    println!("RLE0 round-trip OK!\n");

    // Test rANS byte
    let test_data = b"abracadabra";
    let stats = rans_byte::SymbolStats::from_data(test_data);
    let encoded = rans_byte::rans_encode_block(test_data, &stats);
    println!("rANS encoded 'abracadabra': {} bytes -> {} bytes", test_data.len(), encoded.len());
    let decoded = rans_byte::rans_decode_block(&encoded, &stats, test_data.len()).unwrap();
    assert_eq!(&decoded, test_data, "rANS round-trip failed");
    println!("rANS round-trip OK!\n");

    // Test full pipeline on larger data
    let big_data: Vec<u8> = "Hello World! Testing the full BWT+MTF+RLE+rANS pipeline. ".repeat(20).into_bytes();
    let bwt_r = bwt::bwt_encode(&big_data).unwrap();
    let mtf_r = mtf::mtf_encode(&bwt_r.transformed);
    let rle_r = mtf::rle0_encode(&mtf_r);
    let stats = rans_byte::SymbolStats::from_data(&rle_r);
    let enc = rans_byte::rans_encode_block(&rle_r, &stats);

    println!("Full pipeline: {} -> BWT {} -> MTF {} -> RLE {} -> rANS {}",
        big_data.len(), bwt_r.transformed.len(), mtf_r.len(), rle_r.len(), enc.len());

    let dec_rle = rans_byte::rans_decode_block(&enc, &stats, rle_r.len()).unwrap();
    assert_eq!(dec_rle, rle_r, "rANS stage failed");

    let dec_mtf = mtf::rle0_decode(&dec_rle);
    assert_eq!(dec_mtf, mtf_r, "RLE0 stage failed");

    let dec_bwt = mtf::mtf_decode(&dec_mtf);
    assert_eq!(dec_bwt, bwt_r.transformed, "MTF stage failed");

    let dec_orig = bwt::bwt_decode(&dec_bwt, bwt_r.primary_index).unwrap();
    assert_eq!(dec_orig, big_data, "BWT stage failed");

    println!("Full pipeline round-trip OK!");
    println!("Ratio: {:.1}%", (enc.len() as f64 / big_data.len() as f64) * 100.0);
}
