use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use std::sync::Arc;
use wgpu::*;
use wgpu::util::DeviceExt;

const ENTROPY_SHADER: &str = include_str!("shaders/entropy.wgsl");

pub struct GpuDevice {
    device: Device,
    queue: Queue,
    adapter_info: String,
    max_buffer_size: u64,
}

pub struct GpuContext {
    inner: Arc<RwLock<Option<GpuDevice>>>,
    entropy_pipeline: Arc<RwLock<Option<ComputePipeline>>>,
    entropy_bgl: Arc<RwLock<Option<BindGroupLayout>>>,
}

impl GpuContext {
    pub async fn new() -> Self {
        let instance = Instance::new(InstanceDescriptor {
            backends: Backends::all(),
            ..Default::default()
        });

        let adapter = instance.request_adapter(&RequestAdapterOptions {
            power_preference: PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        }).await;

        let ctx = GpuContext {
            inner: Arc::new(RwLock::new(None)),
            entropy_pipeline: Arc::new(RwLock::new(None)),
            entropy_bgl: Arc::new(RwLock::new(None)),
        };

        if let Some(adapter) = adapter {
            let limits = adapter.limits();
            match adapter.request_device(&DeviceDescriptor {
                label: Some("roxify-compute"),
                required_features: Features::empty(),
                required_limits: Limits {
                    max_storage_buffer_binding_size: limits.max_storage_buffer_binding_size,
                    max_buffer_size: limits.max_buffer_size,
                    ..Limits::default()
                },
            }, None).await {
                Ok((device, queue)) => {
                    let info = adapter.get_info();
                    let max_buf = limits.max_buffer_size;

                    let shader_module = device.create_shader_module(ShaderModuleDescriptor {
                        label: Some("entropy-shader"),
                        source: ShaderSource::Wgsl(std::borrow::Cow::Borrowed(ENTROPY_SHADER)),
                    });

                    let bind_group_layout = device.create_bind_group_layout(&BindGroupLayoutDescriptor {
                        label: Some("entropy-bgl"),
                        entries: &[
                            BindGroupLayoutEntry {
                                binding: 0,
                                visibility: ShaderStages::COMPUTE,
                                ty: BindingType::Buffer {
                                    ty: BufferBindingType::Storage { read_only: true },
                                    has_dynamic_offset: false,
                                    min_binding_size: None,
                                },
                                count: None,
                            },
                            BindGroupLayoutEntry {
                                binding: 1,
                                visibility: ShaderStages::COMPUTE,
                                ty: BindingType::Buffer {
                                    ty: BufferBindingType::Storage { read_only: false },
                                    has_dynamic_offset: false,
                                    min_binding_size: None,
                                },
                                count: None,
                            },
                            BindGroupLayoutEntry {
                                binding: 2,
                                visibility: ShaderStages::COMPUTE,
                                ty: BindingType::Buffer {
                                    ty: BufferBindingType::Uniform,
                                    has_dynamic_offset: false,
                                    min_binding_size: None,
                                },
                                count: None,
                            },
                        ],
                    });

                    let pipeline_layout = device.create_pipeline_layout(&PipelineLayoutDescriptor {
                        label: Some("entropy-pl"),
                        bind_group_layouts: &[&bind_group_layout],
                        push_constant_ranges: &[],
                    });

                    let pipeline = device.create_compute_pipeline(&ComputePipelineDescriptor {
                        label: Some("entropy-pipeline"),
                        layout: Some(&pipeline_layout),
                        module: &shader_module,
                        entry_point: "main",
                    });

                    *ctx.entropy_pipeline.write() = Some(pipeline);
                    *ctx.entropy_bgl.write() = Some(bind_group_layout);
                    *ctx.inner.write() = Some(GpuDevice {
                        device,
                        queue,
                        adapter_info: format!("{} ({:?})", info.name, info.backend),
                        max_buffer_size: max_buf,
                    });
                }
                Err(_) => {}
            }
        }

        ctx
    }

    pub fn is_available(&self) -> bool {
        self.inner.read().is_some()
    }

    pub fn get_adapter_info(&self) -> Option<String> {
        self.inner.read().as_ref().map(|d| d.adapter_info.clone())
    }

    pub fn max_buffer_size(&self) -> u64 {
        self.inner.read().as_ref().map(|d| d.max_buffer_size).unwrap_or(0)
    }

    pub fn compute_entropy(&self, data: &[u8]) -> Result<f32> {
        let gpu = self.inner.read();
        let gpu = gpu.as_ref().ok_or_else(|| anyhow!("No GPU"))?;
        let pipeline = self.entropy_pipeline.read();
        let pipeline = pipeline.as_ref().ok_or_else(|| anyhow!("No entropy pipeline"))?;
        let bgl = self.entropy_bgl.read();
        let bgl = bgl.as_ref().ok_or_else(|| anyhow!("No BGL"))?;

        let padded_len = ((data.len() + 3) / 4) * 4;
        let mut padded = Vec::with_capacity(padded_len);
        padded.extend_from_slice(data);
        padded.resize(padded_len, 0);

        let input_buffer = gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: Some("entropy-input"),
            contents: &padded,
            usage: BufferUsages::STORAGE,
        });

        let histogram_buffer = gpu.device.create_buffer(&BufferDescriptor {
            label: Some("entropy-hist"),
            size: 256 * 4,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let params = [data.len() as u32, 0u32, 0u32, 0u32];
        let params_buffer = gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: Some("entropy-params"),
            contents: bytemuck::cast_slice(&params),
            usage: BufferUsages::UNIFORM,
        });

        let staging_buffer = gpu.device.create_buffer(&BufferDescriptor {
            label: Some("entropy-staging"),
            size: 256 * 4,
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = gpu.device.create_bind_group(&BindGroupDescriptor {
            label: None,
            layout: bgl,
            entries: &[
                BindGroupEntry { binding: 0, resource: input_buffer.as_entire_binding() },
                BindGroupEntry { binding: 1, resource: histogram_buffer.as_entire_binding() },
                BindGroupEntry { binding: 2, resource: params_buffer.as_entire_binding() },
            ],
        });

        let workgroups = ((padded_len / 4) + 255) / 256;
        let mut cmd = gpu.device.create_command_encoder(&CommandEncoderDescriptor { label: None });
        {
            let mut cpass = cmd.begin_compute_pass(&ComputePassDescriptor { label: None, timestamp_writes: None });
            cpass.set_pipeline(pipeline);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(workgroups as u32, 1, 1);
        }
        cmd.copy_buffer_to_buffer(&histogram_buffer, 0, &staging_buffer, 0, 256 * 4);
        gpu.queue.submit(std::iter::once(cmd.finish()));

        let slice = staging_buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(MapMode::Read, move |result| { let _ = tx.send(result); });
        gpu.device.poll(Maintain::Wait);
        rx.recv().map_err(|_| anyhow!("GPU map failed"))??;

        let view = slice.get_mapped_range();
        let hist: &[u32] = bytemuck::cast_slice(&view);
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
        let gpu = self.inner.read();
        let gpu = gpu.as_ref().ok_or_else(|| anyhow!("No GPU"))?;
        let pipeline = self.entropy_pipeline.read();
        let pipeline = pipeline.as_ref().ok_or_else(|| anyhow!("No entropy pipeline"))?;
        let bgl = self.entropy_bgl.read();
        let bgl = bgl.as_ref().ok_or_else(|| anyhow!("No BGL"))?;

        let padded_len = ((data.len() + 3) / 4) * 4;
        let mut padded = Vec::with_capacity(padded_len);
        padded.extend_from_slice(data);
        padded.resize(padded_len, 0);

        let input_buffer = gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: &padded,
            usage: BufferUsages::STORAGE,
        });

        let histogram_buffer = gpu.device.create_buffer(&BufferDescriptor {
            label: None,
            size: 256 * 4,
            usage: BufferUsages::STORAGE | BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let params = [data.len() as u32, 0u32, 0u32, 0u32];
        let params_buffer = gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: bytemuck::cast_slice(&params),
            usage: BufferUsages::UNIFORM,
        });

        let staging_buffer = gpu.device.create_buffer(&BufferDescriptor {
            label: None,
            size: 256 * 4,
            usage: BufferUsages::MAP_READ | BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });

        let bind_group = gpu.device.create_bind_group(&BindGroupDescriptor {
            label: None,
            layout: bgl,
            entries: &[
                BindGroupEntry { binding: 0, resource: input_buffer.as_entire_binding() },
                BindGroupEntry { binding: 1, resource: histogram_buffer.as_entire_binding() },
                BindGroupEntry { binding: 2, resource: params_buffer.as_entire_binding() },
            ],
        });

        let workgroups = ((padded_len / 4) + 255) / 256;
        let mut cmd = gpu.device.create_command_encoder(&CommandEncoderDescriptor { label: None });
        {
            let mut cpass = cmd.begin_compute_pass(&ComputePassDescriptor { label: None, timestamp_writes: None });
            cpass.set_pipeline(pipeline);
            cpass.set_bind_group(0, &bind_group, &[]);
            cpass.dispatch_workgroups(workgroups as u32, 1, 1);
        }
        cmd.copy_buffer_to_buffer(&histogram_buffer, 0, &staging_buffer, 0, 256 * 4);
        gpu.queue.submit(std::iter::once(cmd.finish()));

        let slice = staging_buffer.slice(..);
        let (tx, rx) = std::sync::mpsc::channel();
        slice.map_async(MapMode::Read, move |result| { let _ = tx.send(result); });
        gpu.device.poll(Maintain::Wait);
        rx.recv().map_err(|_| anyhow!("GPU map failed"))??;

        let view = slice.get_mapped_range();
        let hist_slice: &[u32] = bytemuck::cast_slice(&view);
        let mut result = [0u32; 256];
        result.copy_from_slice(hist_slice);
        Ok(result)
    }

    pub async fn create_compute_pipeline(
        &self,
        shader_src: &str,
        entry_point: &str,
    ) -> Result<ComputePipeline> {
        let gpu = self.inner.read();
        let gpu = gpu.as_ref().ok_or_else(|| anyhow!("No GPU device available"))?;

        let shader_module = gpu.device.create_shader_module(ShaderModuleDescriptor {
            label: Some("compute-shader"),
            source: ShaderSource::Wgsl(std::borrow::Cow::Borrowed(shader_src)),
        });

        let pipeline_layout = gpu.device.create_pipeline_layout(&PipelineLayoutDescriptor {
            label: Some("compute-layout"),
            bind_group_layouts: &[],
            push_constant_ranges: &[],
        });

        Ok(gpu.device.create_compute_pipeline(&ComputePipelineDescriptor {
            label: Some("compute-pipeline"),
            layout: Some(&pipeline_layout),
            module: &shader_module,
            entry_point,
        }))
    }

    pub fn create_buffer_init(&self, data: &[u8], usage: BufferUsages) -> Result<Buffer> {
        let gpu = self.inner.read();
        let gpu = gpu.as_ref().ok_or_else(|| anyhow!("No GPU device available"))?;

        Ok(gpu.device.create_buffer_init(&util::BufferInitDescriptor {
            label: None,
            contents: data,
            usage,
        }))
    }
}

pub fn gpu_available() -> bool {
    pollster::block_on(async {
        let instance = Instance::new(InstanceDescriptor {
            backends: Backends::all(),
            ..Default::default()
        });
        instance.request_adapter(&RequestAdapterOptions {
            power_preference: PowerPreference::HighPerformance,
            compatible_surface: None,
            force_fallback_adapter: false,
        }).await.is_some()
    })
}

pub fn init_gpu() -> Option<GpuContext> {
    let ctx = pollster::block_on(GpuContext::new());
    if ctx.is_available() { Some(ctx) } else { None }
}

pub fn gpu_entropy(ctx: &GpuContext, data: &[u8]) -> Option<f32> {
    ctx.compute_entropy(data).ok()
}
