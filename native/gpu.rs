use anyhow::{anyhow, Result};
use parking_lot::RwLock;
use std::sync::Arc;
use wgpu::*;
use wgpu::util::DeviceExt;

pub struct GpuDevice {
    device: Device,
    queue: Queue,
    supported: bool,
    adapter_info: String,
}

pub struct GpuContext {
    inner: Arc<RwLock<Option<GpuDevice>>>,
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

        let device_info = if let Some(adapter) = adapter {
            match adapter.request_device(&DeviceDescriptor {
                label: Some("roxify-compute"),
                required_features: Features::empty(),
                required_limits: Limits::default(),
            }, None).await {
                Ok((device, queue)) => {
                    let info = adapter.get_info();
                    Some(GpuDevice {
                        device,
                        queue,
                        supported: true,
                        adapter_info: format!("{:?}", info.driver),
                    })
                }
                Err(_) => None,
            }
        } else {
            None
        };

        GpuContext {
            inner: Arc::new(RwLock::new(device_info)),
        }
    }

    pub fn is_available(&self) -> bool {
        self.inner.read().is_some()
    }

    pub fn get_adapter_info(&self) -> Option<String> {
        self.inner.read().as_ref().map(|d| d.adapter_info.clone())
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
