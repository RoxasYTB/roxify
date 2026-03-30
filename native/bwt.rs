use anyhow::Result;
use libsais::bwt::Bwt;
use libsais::typestate::OwnedBuffer;
use libsais::{BwtConstruction, ThreadCount};

pub struct BwtResult {
    pub transformed: Vec<u8>,
    pub primary_index: u32,
}

pub fn bwt_encode(data: &[u8]) -> Result<BwtResult> {
    let n = data.len();
    if n == 0 {
        return Ok(BwtResult { transformed: Vec::new(), primary_index: 0 });
    }

    let bwt_result = BwtConstruction::for_text(data)
        .with_owned_temporary_array_buffer32()
        .multi_threaded(ThreadCount::openmp_default())
        .run()
        .map_err(|e| anyhow::anyhow!("libsais BWT: {:?}", e))?;

    let primary_index = bwt_result.primary_index() as u32;
    let transformed = bwt_result.bwt().to_vec();

    Ok(BwtResult { transformed, primary_index })
}

pub fn bwt_decode(bwt_data: &[u8], primary_index: u32) -> Result<Vec<u8>> {
    if bwt_data.is_empty() {
        return Ok(Vec::new());
    }

    let bwt_obj: Bwt<'static, u8, OwnedBuffer> =
        unsafe { Bwt::from_parts(bwt_data.to_vec(), primary_index as usize) };

    let text = bwt_obj
        .unbwt()
        .with_owned_temporary_array_buffer32()
        .multi_threaded(ThreadCount::openmp_default())
        .run()
        .map_err(|e| anyhow::anyhow!("libsais UnBWT: {:?}", e))?;

    Ok(text.as_slice().to_vec())
}
