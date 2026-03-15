use parking_lot::Mutex;
use std::sync::Arc;

pub struct ProgressBar {
    total: u64,
    current: Arc<Mutex<u64>>,
    message: Arc<Mutex<String>>,
}

impl ProgressBar {
    pub fn new(total: u64) -> Self {
        Self {
            total,
            current: Arc::new(Mutex::new(0)),
            message: Arc::new(Mutex::new(String::new())),
        }
    }

    pub fn inc(&self, delta: u64) {
        let mut current = self.current.lock();
        *current += delta;
    }

    pub fn set(&self, value: u64) {
        let mut current = self.current.lock();
        *current = value;
    }

    pub fn set_message(&self, msg: String) {
        let mut message = self.message.lock();
        *message = msg;
    }

    pub fn get_progress(&self) -> (u64, u64) {
        let current = *self.current.lock();
        (current, self.total)
    }

    pub fn finish(&self) {
        let mut current = self.current.lock();
        *current = self.total;
    }
}
