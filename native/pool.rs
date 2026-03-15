use anyhow::Result;
use parking_lot::RwLock;
use std::sync::Arc;

pub struct ReusableBuffer {
    data: Vec<u8>,
    capacity: usize,
}

impl ReusableBuffer {
    pub fn new(capacity: usize) -> Self {
        ReusableBuffer {
            data: vec![0u8; capacity],
            capacity,
        }
    }

    pub fn as_mut_slice(&mut self) -> &mut [u8] {
        &mut self.data
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.data
    }

    pub fn resize(&mut self, new_size: usize) -> Result<()> {
        if new_size > self.capacity {
            return Err(anyhow::anyhow!("Buffer overflow: {} > {}", new_size, self.capacity));
        }
        self.data.truncate(new_size);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.data.clear();
    }
}

pub struct BufferPool {
    buffers: Arc<RwLock<Vec<Arc<RwLock<ReusableBuffer>>>>>,
    default_capacity: usize,
}

impl BufferPool {
    pub fn new(pool_size: usize, capacity: usize) -> Self {
        let mut buffers = Vec::with_capacity(pool_size);
        for _ in 0..pool_size {
            buffers.push(Arc::new(RwLock::new(ReusableBuffer::new(capacity))));
        }

        BufferPool {
            buffers: Arc::new(RwLock::new(buffers)),
            default_capacity: capacity,
        }
    }

    pub fn acquire(&self) -> Arc<RwLock<ReusableBuffer>> {
        let mut pool = self.buffers.write();
        if let Some(buf) = pool.pop() {
            buf
        } else {
            Arc::new(RwLock::new(ReusableBuffer::new(self.default_capacity)))
        }
    }

    pub fn release(&self, buf: Arc<RwLock<ReusableBuffer>>) {
        buf.write().clear();
        let mut pool = self.buffers.write();
        if pool.len() < 16 {
            pool.push(buf);
        }
    }
}

pub struct ZeroCopyBuffer {
    ptr: *const u8,
    len: usize,
    owned: bool,
}

impl ZeroCopyBuffer {
    pub fn from_slice(data: &[u8]) -> Self {
        ZeroCopyBuffer {
            ptr: data.as_ptr(),
            len: data.len(),
            owned: false,
        }
    }

    pub fn as_slice(&self) -> &[u8] {
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }

    pub fn len(&self) -> usize {
        self.len
    }

    pub fn is_empty(&self) -> bool {
        self.len == 0
    }
}
