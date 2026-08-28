//! Caminho de apresentação single-window baseado em `winit` e `wgpu`.
//!
//! O loop de rede RDP é executado em um worker dedicado. O event loop da UI
//! apenas encaminha a entrada, consome notificações de regiões alteradas e faz
//! uploads curtos para a textura da GPU.

use std::sync::{Arc, TryLockError};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use ironrdp::pdu::geometry::InclusiveRectangle;
use ironrdp::session::{image::DecodedImage, ActiveStage};
use winit::application::ApplicationHandler;
use winit::dpi::PhysicalSize;
use winit::event::{DeviceEvent, DeviceId, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Fullscreen, Window, WindowId};

use crate::mvp_runtime::UpgradedFramed;
use crate::rdp_worker::{RdpWorker, RdpWorkerEvent, SharedDecodedImage};
use crate::viewer_gpu::{DirtyRect, GpuPresenter};
use crate::viewer_metrics::{Snapshot, ViewerMetrics};
use crate::viewer_winit_input::{DisplayMapping, WinitInputState};

const FRAME_INTERVAL: Duration = Duration::from_millis(1_000 / 60);
const METRICS_REPORT_INTERVAL: Duration = Duration::from_secs(10);

/// Executa um viewer RDP em uma única janela acelerada por GPU.
///
/// A conexão e o `ActiveStage` já devem estar prontos. Isto permite que o
/// chamador reutilize o mesmo handshake sem misturar detalhes de UI ao
/// protocolo.
#[allow(clippy::too_many_arguments)]
pub fn run_single_window(
    host: String,
    port: u16,
    fullscreen: bool,
    buffer_width: u32,
    buffer_height: u32,
    display_width: u32,
    display_height: u32,
    image: DecodedImage,
    active_stage: ActiveStage,
    framed: UpgradedFramed,
) -> Result<()> {
    if buffer_width == 0 || buffer_height == 0 {
        bail!("RDP framebuffer dimensions cannot be zero");
    }
    if display_width == 0 || display_height == 0 {
        bail!("viewer display dimensions cannot be zero");
    }

    let event_loop = EventLoop::new().context("create winit event loop")?;
    let worker =
        RdpWorker::start(active_stage, framed, image).context("start RDP network worker")?;
    let mut app = SingleWindowApp::new(
        format!("Internal RDP - {host}:{port}"),
        fullscreen,
        buffer_width,
        buffer_height,
        display_width,
        display_height,
        worker,
    );
    let run_result = event_loop.run_app(&mut app).context("run winit viewer");
    app.shutdown();
    run_result?;

    if let Some(error) = app.error {
        Err(error)
    } else {
        Ok(())
    }
}

struct SingleWindowApp {
    title: String,
    fullscreen: bool,
    buffer_width: u32,
    buffer_height: u32,
    display_width: u32,
    display_height: u32,
    worker: RdpWorker,
    shared_image: SharedDecodedImage,
    window: Option<Arc<Window>>,
    presenter: Option<GpuPresenter>,
    input: WinitInputState,
    pending_dirty_rects: Vec<DirtyRect>,
    first_upload: bool,
    next_tick: Instant,
    metrics: ViewerMetrics,
    last_metrics_report: Instant,
    shutdown_complete: bool,
    error: Option<anyhow::Error>,
}

impl SingleWindowApp {
    #[allow(clippy::too_many_arguments)]
    fn new(
        title: String,
        fullscreen: bool,
        buffer_width: u32,
        buffer_height: u32,
        display_width: u32,
        display_height: u32,
        worker: RdpWorker,
    ) -> Self {
        let shared_image = worker.shared_image();
        Self {
            title,
            fullscreen,
            buffer_width,
            buffer_height,
            display_width,
            display_height,
            worker,
            shared_image,
            window: None,
            presenter: None,
            input: WinitInputState::new(DisplayMapping::new(
                display_width,
                display_height,
                buffer_width,
                buffer_height,
            )),
            pending_dirty_rects: Vec::new(),
            first_upload: true,
            next_tick: Instant::now(),
            metrics: ViewerMetrics::default(),
            last_metrics_report: Instant::now(),
            shutdown_complete: false,
            error: None,
        }
    }

    fn record_error(&mut self, error: anyhow::Error) {
        if self.error.is_none() {
            self.error = Some(error);
        }
    }

    fn stop_with_error(&mut self, event_loop: &ActiveEventLoop, error: anyhow::Error) {
        self.record_error(error);
        self.shutdown();
        event_loop.exit();
    }

    fn shutdown(&mut self) {
        if self.shutdown_complete {
            return;
        }
        self.shutdown_complete = true;

        if let Err(error) = self.worker.shutdown() {
            self.record_error(error.context("shut down RDP network worker"));
        }
    }

    fn update_display_mapping(&mut self, size: PhysicalSize<u32>) {
        if size.width == 0 || size.height == 0 {
            return;
        }
        self.display_width = size.width;
        self.display_height = size.height;
        self.input.mapping = DisplayMapping::new(
            self.display_width,
            self.display_height,
            self.buffer_width,
            self.buffer_height,
        );
    }

    fn tick(&mut self) -> Result<()> {
        let mut worker_stopped = false;
        for event in self.worker.try_drain_updates() {
            match event {
                RdpWorkerEvent::Update(update) => {
                    self.metrics.record_decode_time(
                        update.active_stage_process_duration + update.input_process_duration,
                    );
                    self.metrics
                        .record_network_read_time(update.pdu_read_duration);
                    self.metrics
                        .record_rdp_processing_time(update.active_stage_process_duration);
                    self.metrics
                        .record_response_write_time(update.response_write_duration);
                    for _ in 0..update.frames_processed {
                        self.metrics.record_frame_received();
                    }
                    for region in update.dirty_regions {
                        push_dirty_rect(
                            &mut self.pending_dirty_rects,
                            region,
                            self.buffer_width,
                            self.buffer_height,
                        );
                    }
                }
                RdpWorkerEvent::Error(message) => {
                    return Err(anyhow!("RDP network worker failed: {message}"));
                }
                RdpWorkerEvent::Stopped => worker_stopped = true,
            }
        }
        if worker_stopped {
            return Err(anyhow!("RDP network worker stopped unexpectedly"));
        }

        if self.first_upload {
            self.pending_dirty_rects.clear();
            self.pending_dirty_rects.push(DirtyRect::new(
                0,
                0,
                self.buffer_width,
                self.buffer_height,
            ));
            self.first_upload = false;
        }

        if !self.pending_dirty_rects.is_empty() {
            let upload_started = Instant::now();
            let uploaded_pixels = self
                .pending_dirty_rects
                .iter()
                .map(|rect| u64::from(rect.width) * u64::from(rect.height))
                .sum();
            // Never block the UI behind a read/decode in the network worker.
            // The dirty regions remain queued and will be uploaded on a later tick.
            let image = match self.shared_image.try_lock() {
                Ok(image) => image,
                Err(TryLockError::WouldBlock) => return Ok(()),
                Err(TryLockError::Poisoned(_)) => bail!("decoded image lock poisoned"),
            };
            let presenter = self
                .presenter
                .as_mut()
                .context("GPU presenter is not initialized")?;
            presenter
                .upload_dirty_rects(
                    image.data(),
                    self.buffer_width,
                    self.buffer_height,
                    &self.pending_dirty_rects,
                )
                .context("upload RDP dirty regions to GPU")?;
            drop(image);
            self.pending_dirty_rects.clear();
            self.metrics
                .record_conversion(uploaded_pixels * 4, uploaded_pixels);
            self.metrics
                .record_conversion_time(upload_started.elapsed());
            if let Some(window) = &self.window {
                window.request_redraw();
            }
        }

        Ok(())
    }

    fn maybe_report_metrics(&mut self) {
        if self.last_metrics_report.elapsed() >= METRICS_REPORT_INTERVAL {
            report_metrics(self.metrics.reset());
            self.last_metrics_report = Instant::now();
        }
    }
}

impl ApplicationHandler for SingleWindowApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }

        let mut attributes = Window::default_attributes()
            .with_title(self.title.clone())
            .with_inner_size(PhysicalSize::new(self.display_width, self.display_height))
            .with_resizable(!self.fullscreen);
        if self.fullscreen {
            attributes = attributes.with_fullscreen(Some(Fullscreen::Borderless(None)));
        }

        let window = match event_loop.create_window(attributes) {
            Ok(window) => Arc::new(window),
            Err(error) => {
                self.stop_with_error(
                    event_loop,
                    anyhow::Error::new(error).context("create viewer window"),
                );
                return;
            }
        };
        // The internal viewer does not yet paint the RDP pointer shape itself.
        // Hiding the system cursor therefore leaves Windows users without any
        // visible pointer as soon as it enters the remote desktop. Keep the
        // native cursor on Windows until remote-pointer rendering exists.
        window.set_cursor_visible(!cfg!(target_os = "windows"));
        self.update_display_mapping(window.inner_size());

        match GpuPresenter::new(Arc::clone(&window)) {
            Ok(presenter) => {
                self.presenter = Some(presenter);
                self.window = Some(window);
                self.next_tick = Instant::now();
                event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_tick));
            }
            Err(error) => {
                self.stop_with_error(event_loop, error.context("initialize GPU presenter"))
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        if self
            .window
            .as_ref()
            .is_none_or(|window| window.id() != window_id)
        {
            return;
        }

        match event {
            WindowEvent::CloseRequested => {
                self.shutdown();
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                self.update_display_mapping(size);
                if let Some(presenter) = &mut self.presenter {
                    presenter.resize(size.width, size.height);
                }
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => {
                if let Some(presenter) = &mut self.presenter {
                    let presentation_started = Instant::now();
                    if let Err(error) = presenter.render().context("render RDP frame") {
                        self.stop_with_error(event_loop, error);
                    } else {
                        self.metrics
                            .record_presentation_time(presentation_started.elapsed());
                        self.metrics.record_frame_rendered();
                        self.metrics.record_window_update();
                    }
                }
            }
            event => {
                let input = self.input.handle_window_event(&event);
                if let Err(error) = self.worker.send_input(input) {
                    self.stop_with_error(
                        event_loop,
                        error.context("queue RDP input for network worker"),
                    );
                }
            }
        }
    }

    fn device_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _device_id: DeviceId,
        _event: DeviceEvent,
    ) {
        // `CursorMoved` already delivers absolute coordinates for this window.
        // Processing raw device motion as well duplicates mouse packets on
        // Windows, which can build a queue ahead of keyboard events.
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let now = Instant::now();
        if now < self.next_tick {
            event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_tick));
            return;
        }
        if let Err(error) = self.tick() {
            self.stop_with_error(event_loop, error.context("advance RDP session"));
            return;
        }

        self.next_tick = now + FRAME_INTERVAL;
        self.maybe_report_metrics();
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_tick));
    }

    fn exiting(&mut self, _event_loop: &ActiveEventLoop) {
        self.shutdown();
        report_metrics(self.metrics.reset());
    }
}

fn report_metrics(metrics: Snapshot) {
    eprintln!(
        "[viewer][metrics] renderer=wgpu received={} rendered={} window_updates={} pixels={} bytes={} decode_ms={} read_ms={} process_ms={} write_ms={} upload_ms={} present_ms={}",
        metrics.frames_received,
        metrics.frames_rendered,
        metrics.window_updates,
        metrics.pixels_converted,
        metrics.bytes_converted,
        metrics.decode_time.as_millis(),
        metrics.network_read_time.as_millis(),
        metrics.rdp_processing_time.as_millis(),
        metrics.response_write_time.as_millis(),
        metrics.conversion_time.as_millis(),
        metrics.presentation_time.as_millis(),
    );
}

fn push_dirty_rect(
    dirty_rects: &mut Vec<DirtyRect>,
    region: InclusiveRectangle,
    buffer_width: u32,
    buffer_height: u32,
) {
    if buffer_width == 0 || buffer_height == 0 {
        return;
    }

    let left = u32::from(region.left).min(buffer_width - 1);
    let top = u32::from(region.top).min(buffer_height - 1);
    let right = u32::from(region.right).min(buffer_width - 1);
    let bottom = u32::from(region.bottom).min(buffer_height - 1);
    if left > right || top > bottom {
        return;
    }
    dirty_rects.push(DirtyRect::new(
        left,
        top,
        right - left + 1,
        bottom - top + 1,
    ));
}

#[cfg(test)]
mod tests {
    use super::push_dirty_rect;
    use crate::viewer_gpu::DirtyRect;
    use ironrdp::pdu::geometry::InclusiveRectangle;

    #[test]
    fn dirty_region_is_inclusive_and_clamped_to_framebuffer() {
        let mut rects = Vec::new();
        push_dirty_rect(
            &mut rects,
            InclusiveRectangle {
                left: 8,
                top: 9,
                right: 50,
                bottom: 50,
            },
            10,
            11,
        );
        assert_eq!(rects, vec![DirtyRect::new(8, 9, 2, 2)]);
    }
}
