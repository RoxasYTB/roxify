use anyhow::{anyhow, Result};
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use wgpu::*;
use wgpu::util::DeviceExt;

const ENTROPY_SHADER: &str = include_str!("shaders/entropy.wgsl");
const MTF_SHADER: &str = include_str!("shaders/mtf.wgsl");
const RLE_SHADER: &str = include_str!("shaders/rle.wgsl");

const GPU_MIN_DATA_SIZE: usize = 16384;

static GPU: OnceLock<Option<GpuContext>> = OnceLock::new();
static GPU_FAILED: AtomicBool = AtomicBool::new(false);

pub fn gpu_instance() -> Option<&'static GpuContext> {
    if GPU_FAILED.load(Ordering::Relaxed) { return None; }
    GPU.get_or_init(|| {
        let wrapper = std::panic::AssertUnwindSafe(|| pollster::block_on(GpuContext::new()));
        match std::panic::catch_unwind(wrapper) {
            Ok(ctx) => ctx,
            Err(_) => {
                GPU_FAILED.store(true, Ordering::Relaxed);
                eprintln!("[roxify] GPU init panicked, falling back to CPU");
                None
            }
        }
    }).as_ref()
}

fn gpu_safe_call<F: FnOnce(&GpuContext) -> Result<T>, T>(f: F) -> Option<T> {
    let ctx = gpu_instance()?;
    let wrapper = std::panic::AssertUnwindSafe(move || f(ctx));
    match std::panic::catch_unwind(wrapper) {
        Ok(Ok(v)) => Some(v),
        _ => {
            GPU_FAILED.store(true, Ordering::Relaxed);
            None
        }
    }
}

pub fn gpu_available() -> bool {
    gpu_instance().is_some()
}

pub fn init_gpu() -> Option<&'static GpuContext> {
    gpu_instance()
}

pub fn gpu_entropy(data: &[u8]) -> Option<f32> {
    if data.len() < GPU_MIN_DATA_SIZE { return None; }
    gpu_safe_call(|ctx| ctx.compute_entropy(data))
}

pub fn gpu_histogram(data: &[u8]) -> Option<[u32; 256]> {
    if data.len() < GPU_MIN_DATA_SIZE { return None; }
    gpu_safe_call(|ctx| ctx.compute_histogram(data))
}

pub fn gpu_mtf_encode(data: &[u8]) -> Option<Vec<u8>> {
    if data.len() < GPU_MIN_DATA_SIZE { return None; }
    gpu_safe_call(|ctx| ctx.mtf_encode(data))
}

struct GpuDevice {
    device: Device,
    queue: Queue,
    adapter_info: String,
    max_buffer_size: u64,
}

struct PipelineSet {
    entropy: ComputePipeline,
    entropy_bgl: BindGroupLayout,
    mtf: ComputePipeline,
    mtf_bgl: BindGroupLayout,
}

pub struct GpuContext {
    gpu: GpuDevice,
    pipelines: PipelineSet,
    lock: Mutex<()>,
}

fn create_storage_bgl_entry(binding: u32, read_only: bool) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn create_uniform_bgl_entry(binding: u32) -> BindGroupLayoutEntry {
    BindGroupLayoutEntry {
        binding,
        visibility: ShaderStages::COMPUTE,
        ty: BindingType::Buffer {
            ty: BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

impl GpuContext {
    async fn new() -> Option<GpuContext> {
        let instance = Instance::new(InstanceDescriptor {
            backends: Backends::all(),
            ..Default::default()
        });

        let adapter = instance.request_adapter(&RequestAdapterOptions {
            power_preference: PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        }).await?;

        let limits = adapter.limits();
        let (device, queue) = adapter.request_device(&DeviceDescriptor {
            label: Some("roxify-compute"),
            required_features: Features::empty(),
            required_limits: Limits {
                max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
                max_buffer_size: limits.max_buffer_size,
                ..Limits::default()
            },
        }, None).await.ok()?;

        let info = adapter.get_info();
        let max_buf = limits.max_buffer_size;

        let entropy_module = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("entropy-shader"),
            source: ShaderSource::Wgsl(std::borrow::Cow::Borrowed(ENTROPY_SHADER)),
        });

        let entropy_bgl = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("entropy-bgl"),
            entries: &[
                create_storage_bgl_entry(0, true),
                create_storage_bgl_entry(1, false),
                create_uniform_bgl_entry(2),
            ],
        });

        let entropy = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("entropy-pipeline"),
            layout: Some(&device.create_pipeline_layout(&PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[&entropy_bgl],
                push_constant_ranges: &[],
            })),
            module: &entropy_module,
            entry_point: "main",
        });

        let mtf_module = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("mtf-shader"),
            source: ShaderSource::Wgsl(std::borrow::Cow::Borrowed(MTF_SHADER)),
        });

        let mtf_bgl = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
            label: Some("mtf-bgl"),
            entries: &[
                create_storage_bgl_entry(0, true),
                create_storage_bgl_entry(1, false),
                create_uniform_bgl_entry(2),
            ],
        });

        let mtf = device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("mtf-pipeline"),
            layout: Some(&device.create_pipeline_layout(&PipelineLayoutDescriptor {
                label: None,
                bind_group_layouts: &[&mtf_bgl],
                push_constant_ranges: &[],
            })),
            module: &mtf_module,
            entry_point: "mtf_encode",
        });

        let _rle_module = device.create_shader_module(ShaderModuleDescriptor {
            label: Some("rle-shader"),
            source: ShaderSource::Wgsl(std::borrow::Cow::Borrowed(RLE_SHADER)),
        });

        let ctx = GpuContext {
            gpu: GpuDevice {
                device,
                queue,
                adapter_info: format!("{} ({:?})", info.name, info.backend),
                max_buffer_size: max_buf,
            },
            pipelines: PipelineSet {
                entropy,
                entropy_bgl,
                mtf,
                mtf_bgl,
            },
            lock: Mutex::new(()),
        };

        if !ctx.self_test() {
            eprintln!("[roxify] GPU self-test failed, falling back to CPU");
            return None;
        }

        Some(ctx)
    }

    pub fn is_available(&self) -> bool {
        true
    }

    fn self_test(&self) -> bool {
        let test_data: Vec<u8> = (0..1_048_576).map(|i| (i % 256) as u8).collect();
        let hist = match self.compute_histogram(&test_data) {
            Ok(h) => h,
            Err(_) => return false,
        };
        let expected_count = (1_048_576 / 256) as u32;
        if !hist.iter().all(|&c| c == expected_count) {
            return false;
        }

        let small: Vec<u8> = (0..65536).map(|i| (i % 256) as u8).collect();
        let mtf_result = match self.mtf_encode(&small) {
            Ok(v) => v,
            Err(_) => return false,
        };
        mtf_result.len() == small.len()
    }

    pub fn get_adapter_info(&self) -> String {
        self.gpu.adapter_info.clone()
    }

    fn map_read_buffer(&self, staging: &Buffer) -> Result<Vec<u8>> {
        let slice = staging.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(MapMode::Read, move |result| { let _ = tx.send(result); });
        self.gpu.device.poll(Maintain::Wait);
        rx.recv().map_err(|_| anyhow!("GPU map failed"))??;
        let view = slice.get_mapped_range();
        Ok(view.to_vec())
    }

    fn pad_to_4(data: &[u8]) -> Vec<u8> {
        let padded_len = ((data.len() + 3) / 4) * 4;
        let mut padded = Vec::with_capacity(padded_len);
        padded.extend_from_slice(data);
        padded.resize(padded_len, 0);
        padded
    }

    pub fn compute_entropy(&self, data: &[u8]) -> Result<f32> {
        let hist = self.compute_histogram(data)?;
        let total = data.len() as f32;
        let inv_total = 1.0 / total;
        let mut entropy = 0.0f32;
        for &f in hist.iter() {
            if f > 0 {
                let p = f as f32 * inv_total;
                entropy -= p * p.log2();
            }
        }
        Ok(entropy)
    }

    pub fn compute_histogram(&self, data: &[u8]) -> Result<[u32; 256]> {
        let _guard = self.lock.lock().map_err(|_| anyhow!("GPU mutex poisoned"))?;
        let padded = Self::pad_to_4(data);

        let input_buffer = self.gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: &padded,
            usage: BufferUsages::STORAGE,
        });

        let histogram_buffer = self.gpu.device.create_buffer(&BufferDescriptor {
            label: None,
            size: 256 * 4,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let params = [data.len() as u32, 0u32, 0u32, 0u32];
        let params_buffer = self.gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: bytemuck::cast_slice(&params),
            usage: BufferUsages::UNIFORM,
        });

        let bind_group = self.gpu.device.create_bind_group(&BindGroupDescriptor {
            label: None,
            layout: &self.pipelines.entropy_bgl,
            entries: &[
                BindGroupEntry { binding: 0, resource: input_buffer.as_entire_binding() },
                BindGroupEntry { binding: 1, resource: histogram_buffer.as_entire_binding() },
                BindGroupEntry { binding: 2, resource: params_buffer.as_entire_binding() },
            ],
        });

        let workgroups = ((padded.len() / 4) + 255) / 256;

        let staging = self.gpu.device.create_buffer(&BufferDescriptor {
            label: None,
            size: 256 * 4,
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut cmd = self.gpu.device.create_command_encoder(&CommandEncoderDescriptor { label: None });
        {
            let mut cpass = cmd.begin_compute_pass(&ComputePassDescriptor { label: None, timestamp_writes: None });
            cpass.set_pipeline(&self.pipelines.entropy);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(workgroups as u32, 1, 1);
        }
        cmd.copy_buffer_to_buffer(&histogram_buffer, 0, &staging, 0, 256 * 4);
        self.gpu.queue.submit(std::iter::once(cmd.finish()));

        let raw = self.map_read_buffer(&staging)?;
        let hist_slice: &[u32] = bytemuck::cast_slice(&raw);
        let mut result = [0u32; 256];
        result.copy_from_slice(hist_slice);
        Ok(result)
    }

    pub fn mtf_encode(&self, data: &[u8]) -> Result<Vec<u8>> {
        let _guard = self.lock.lock().map_err(|_| anyhow!("GPU mutex poisoned"))?;
        let chunk_size = 65536u32;
        let num_chunks = ((data.len() as u32) + chunk_size - 1) / chunk_size;

        let padded = Self::pad_to_4(data);
        let output_bytes = ((data.len() + 3) / 4) * 4;

        let input_buffer = self.gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: &padded,
            usage: BufferUsages::STORAGE,
        });

        let output_buffer = self.gpu.device.create_buffer(&BufferDescriptor {
            label: None,
            size: output_bytes as u64,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let params = [chunk_size, num_chunks, data.len() as u32, 0u32];
        let params_buffer = self.gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: bytemuck::cast_slice(&params),
            usage: BufferUsages::UNIFORM,
        });

        let bind_group = self.gpu.device.create_bind_group(&BindGroupDescriptor {
            label: None,
            layout: &self.pipelines.mtf_bgl,
            entries: &[
                BindGroupEntry { binding: 0, resource: input_buffer.as_entire_binding() },
                BindGroupEntry { binding: 1, resource: output_buffer.as_entire_binding() },
                BindGroupEntry { binding: 2, resource: params_buffer.as_entire_binding() },
            ],
        });

        let staging = self.gpu.device.create_buffer(&BufferDescriptor {
            label: None,
            size: output_bytes as u64,
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let mut cmd = self.gpu.device.create_command_encoder(&CommandEncoderDescriptor { label: None });
        {
            let mut cpass = cmd.begin_compute_pass(&ComputePassDescriptor { label: None, timestamp_writes: None });
            cpass.set_pipeline(&self.pipelines.mtf);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(num_chunks, 1, 1);
        }
        cmd.copy_buffer_to_buffer(&output_buffer, 0, &staging, 0, output_bytes as u64);
        self.gpu.queue.submit(std::iter::once(cmd.finish()));

        let raw = self.map_read_buffer(&staging)?;
        Ok(raw[..data.len()].to_vec())
    }
}
