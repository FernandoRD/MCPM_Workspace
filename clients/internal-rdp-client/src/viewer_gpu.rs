//! Apresentação acelerada por GPU para o framebuffer RGBA do viewer.
//!
//! Este módulo não conhece o protocolo RDP: recebe o buffer RGBA completo e
//! transfere somente os retângulos que mudaram para uma textura da GPU.

use anyhow::{anyhow, bail, Context, Result};
use std::sync::Arc;
use winit::window::Window;

/// Retângulo de pixels em coordenadas da imagem de origem.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DirtyRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl DirtyRect {
    pub const fn new(x: u32, y: u32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    fn is_empty(self) -> bool {
        self.width == 0 || self.height == 0
    }
}

/// Renderiza uma textura RGBA escalonada para preencher uma janela `winit`.
pub struct GpuPresenter {
    surface: wgpu::Surface<'static>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
    bind_group_layout: wgpu::BindGroupLayout,
    texture: wgpu::Texture,
    bind_group: wgpu::BindGroup,
    texture_size: (u32, u32),
}

impl GpuPresenter {
    /// Cria o apresentador associado à janela. A `Arc` permite que a surface
    /// retenha com segurança o handle nativo da janela durante toda sua vida.
    pub fn new(window: Arc<Window>) -> Result<Self> {
        pollster::block_on(Self::new_async(window))
    }

    pub async fn new_async(window: Arc<Window>) -> Result<Self> {
        let instance = wgpu::Instance::default();
        let surface = instance
            .create_surface(Arc::clone(&window))
            .context("creating WGPU surface")?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .context("finding a compatible GPU adapter")?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("RDP viewer device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: wgpu::Limits::downlevel_defaults(),
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .context("creating WGPU device")?;

        let capabilities = surface.get_capabilities(&adapter);
        let format = capabilities
            .formats
            .iter()
            .copied()
            .find(wgpu::TextureFormat::is_srgb)
            .or_else(|| capabilities.formats.first().copied())
            .ok_or_else(|| anyhow!("surface has no supported texture format"))?;
        let size = window.inner_size();
        let config = wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: capabilities
                .present_modes
                .contains(&wgpu::PresentMode::Mailbox)
                .then_some(wgpu::PresentMode::Mailbox)
                .unwrap_or(wgpu::PresentMode::Fifo),
            alpha_mode: capabilities.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&device, &config);

        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("RDP fullscreen shader"),
            source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let bind_group_layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("RDP texture bind group layout"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        multisampled: false,
                        view_dimension: wgpu::TextureViewDimension::D2,
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("RDP pipeline layout"),
            bind_group_layouts: &[&bind_group_layout],
            push_constant_ranges: &[],
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("RDP fullscreen pipeline"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::REPLACE),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: Default::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("RDP linear sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let texture = create_texture(&device, 1, 1);
        let bind_group = create_bind_group(&device, &bind_group_layout, &texture, &sampler);
        Ok(Self {
            surface,
            device,
            queue,
            config,
            pipeline,
            sampler,
            bind_group_layout,
            texture,
            bind_group,
            texture_size: (1, 1),
        })
    }

    /// Reconfigura a surface após um redimensionamento da janela.
    pub fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        self.surface.configure(&self.device, &self.config);
    }

    /// Transfere os retângulos alterados de uma imagem RGBA inteira para a GPU.
    pub fn upload_dirty_rects(
        &mut self,
        rgba: &[u8],
        full_width: u32,
        full_height: u32,
        dirty_rects: &[DirtyRect],
    ) -> Result<()> {
        let required = usize::try_from(full_width)
            .unwrap_or(usize::MAX)
            .checked_mul(usize::try_from(full_height).unwrap_or(usize::MAX))
            .and_then(|pixels| pixels.checked_mul(4))
            .ok_or_else(|| anyhow!("RGBA image dimensions overflow"))?;
        if rgba.len() < required {
            bail!(
                "RGBA buffer has {} bytes; needs at least {required}",
                rgba.len()
            );
        }
        if full_width == 0 || full_height == 0 {
            bail!("RGBA image dimensions cannot be zero");
        }
        if self.texture_size != (full_width, full_height) {
            self.texture = create_texture(&self.device, full_width, full_height);
            self.bind_group = create_bind_group(
                &self.device,
                &self.bind_group_layout,
                &self.texture,
                &self.sampler,
            );
            self.texture_size = (full_width, full_height);
        }
        for rect in dirty_rects.iter().copied().filter(|rect| !rect.is_empty()) {
            if rect
                .x
                .checked_add(rect.width)
                .is_none_or(|right| right > full_width)
                || rect
                    .y
                    .checked_add(rect.height)
                    .is_none_or(|bottom| bottom > full_height)
            {
                bail!("dirty rectangle {rect:?} is outside {full_width}x{full_height}");
            }
            self.upload_rect(rgba, full_width, rect);
        }
        Ok(())
    }

    fn upload_rect(&self, rgba: &[u8], full_width: u32, rect: DirtyRect) {
        let source_stride = full_width as usize * 4;
        let row_bytes = rect.width as usize * 4;
        // Queue::write_texture accepts unaligned rows, but this compact copy is
        // necessary because the source rectangle generally has a larger stride.
        let mut pixels = Vec::with_capacity(row_bytes * rect.height as usize);
        for row in rect.y as usize..(rect.y + rect.height) as usize {
            let start = row * source_stride + rect.x as usize * 4;
            pixels.extend_from_slice(&rgba[start..start + row_bytes]);
        }
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: rect.x,
                    y: rect.y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            &pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row_bytes as u32),
                rows_per_image: Some(rect.height),
            },
            wgpu::Extent3d {
                width: rect.width,
                height: rect.height,
                depth_or_array_layers: 1,
            },
        );
    }

    /// Desenha a última imagem transferida. Em caso de surface perdida, ela é
    /// reconfigurada e a chamada seguinte pode redesenhar normalmente.
    pub fn render(&mut self) -> Result<()> {
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(());
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(()),
            Err(error) => return Err(error).context("acquiring surface texture"),
        };
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("RDP render encoder"),
            });
        {
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("RDP fullscreen pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &self.bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        self.queue.submit(Some(encoder.finish()));
        frame.present();
        Ok(())
    }
}

fn create_texture(device: &wgpu::Device, width: u32, height: u32) -> wgpu::Texture {
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some("RDP framebuffer texture"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    })
}

fn create_bind_group(
    device: &wgpu::Device,
    layout: &wgpu::BindGroupLayout,
    texture: &wgpu::Texture,
    sampler: &wgpu::Sampler,
) -> wgpu::BindGroup {
    let view = texture.create_view(&Default::default());
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("RDP texture bind group"),
        layout,
        entries: &[
            wgpu::BindGroupEntry {
                binding: 0,
                resource: wgpu::BindingResource::TextureView(&view),
            },
            wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(sampler),
            },
        ],
    })
}

const SHADER: &str = r#"
@group(0) @binding(0) var frame_texture: texture_2d<f32>;
@group(0) @binding(1) var frame_sampler: sampler;

struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> };
@vertex fn vs_main(@builtin(vertex_index) i: u32) -> VertexOutput {
    var positions = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
    var uvs = array<vec2<f32>, 3>(vec2(0.0, 1.0), vec2(2.0, 1.0), vec2(0.0, -1.0));
    return VertexOutput(vec4(positions[i], 0.0, 1.0), uvs[i]);
}
@fragment fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> { return textureSample(frame_texture, frame_sampler, in.uv); }
"#;
