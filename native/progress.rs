use parking_lot::Mutex;
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Debug)]
pub struct ProgressSnapshot {
    pub current: u64,
    pub total: u64,
    pub percentage: f64,
    pub elapsed_ms: u64,
    pub eta_ms: Option<u64>,
    pub speed_bytes_per_sec: f64,
    pub step: String,
}

struct ProgressInner {
    total: u64,
    current: u64,
    step: String,
    start: Instant,
}

pub struct ProgressBar {
    inner: Arc<Mutex<ProgressInner>>,
    callback: Arc<Mutex<Option<Box<dyn Fn(ProgressSnapshot) + Send>>>>,
}

impl ProgressBar {
    pub fn new(total: u64) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProgressInner {
                total,
                current: 0,
                step: String::new(),
                start: Instant::now(),
            })),
            callback: Arc::new(Mutex::new(None)),
        }
    }

    pub fn with_callback<F: Fn(ProgressSnapshot) + Send + 'static>(total: u64, cb: F) -> Self {
        Self {
            inner: Arc::new(Mutex::new(ProgressInner {
                total,
                current: 0,
                step: String::new(),
                start: Instant::now(),
            })),
            callback: Arc::new(Mutex::new(Some(Box::new(cb)))),
        }
    }

    pub fn inc(&self, delta: u64) {
        let snapshot = {
            let mut inner = self.inner.lock();
            inner.current += delta;
            self.snapshot_inner(&inner)
        };
        self.emit(snapshot);
    }

    pub fn set(&self, value: u64) {
        let snapshot = {
            let mut inner = self.inner.lock();
            inner.current = value;
            self.snapshot_inner(&inner)
        };
        self.emit(snapshot);
    }

    pub fn set_step(&self, step: &str) {
        let snapshot = {
            let mut inner = self.inner.lock();
            inner.step = step.to_string();
            self.snapshot_inner(&inner)
        };
        self.emit(snapshot);
    }

    pub fn snapshot(&self) -> ProgressSnapshot {
        let inner = self.inner.lock();
        self.snapshot_inner(&inner)
    }

    fn snapshot_inner(&self, inner: &ProgressInner) -> ProgressSnapshot {
        let elapsed = inner.start.elapsed();
        let elapsed_ms = elapsed.as_millis() as u64;
        let percentage = if inner.total > 0 {
            (inner.current as f64 / inner.total as f64) * 100.0
        } else {
            0.0
        };

        let elapsed_secs = elapsed.as_secs_f64();
        let speed = if elapsed_secs > 0.01 {
            inner.current as f64 / elapsed_secs
        } else {
            0.0
        };

        let eta_ms = if speed > 0.0 && inner.current > 0 && inner.current < inner.total {
            let remaining = inner.total - inner.current;
            Some((remaining as f64 / speed * 1000.0) as u64)
        } else {
            None
        };

        ProgressSnapshot {
            current: inner.current,
            total: inner.total,
            percentage,
            elapsed_ms,
            eta_ms,
            speed_bytes_per_sec: speed,
            step: inner.step.clone(),
        }
    }

    fn emit(&self, snapshot: ProgressSnapshot) {
        if let Some(ref cb) = *self.callback.lock() {
            cb(snapshot);
        }
    }

    pub fn finish(&self) {
        let snapshot = {
            let mut inner = self.inner.lock();
            inner.current = inner.total;
            self.snapshot_inner(&inner)
        };
        self.emit(snapshot);
    }

    pub fn get_progress(&self) -> (u64, u64) {
        let inner = self.inner.lock();
        (inner.current, inner.total)
    }

    pub fn set_message(&self, msg: String) {
        self.set_step(&msg);
    }
}
