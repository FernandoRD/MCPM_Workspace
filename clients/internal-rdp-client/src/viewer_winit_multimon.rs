//! Apresentação fullscreen multimonitor baseada em `winit` e `wgpu`.
//!
//! Cada janela mantém uma cópia RGBA somente do monitor que apresenta. Assim,
//! uma região suja do framebuffer virtual é recortada, copiada para a fatia
//! local e enviada ao [`GpuPresenter`] nas coordenadas locais. Isso mantém a
//! API do presenter independente do layout de monitores e evita uploads do
//! desktop virtual inteiro para cada surface.

use std::collections::HashMap;
use std::sync::{Arc, TryLockError};
use std::time::{Duration, Instant};

use anyhow::{anyhow, bail, Context, Result};
use ironrdp::pdu::geometry::InclusiveRectangle;
use ironrdp::pdu::input::fast_path::FastPathInputEvent;
use ironrdp::session::{image::DecodedImage, ActiveStage};
use winit::application::ApplicationHandler;
use winit::dpi::{PhysicalPosition, PhysicalSize};
use winit::event::{DeviceEvent, DeviceId, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Fullscreen, Window, WindowId};

use crate::mvp_runtime::{MonitorLayout, UpgradedFramed};
use crate::rdp_worker::{RdpWorker, RdpWorkerEvent, SharedDecodedImage};
use crate::viewer_gpu::{DirtyRect, GpuPresenter};
use crate::viewer_metrics::{Snapshot, ViewerMetrics};
use crate::viewer_winit_input::{DisplayMapping, WinitInputState};

const FRAME_INTERVAL: Duration = Duration::from_millis(1_000 / 60);
const METRICS_REPORT_INTERVAL: Duration = Duration::from_secs(10);

/// Executa uma janela fullscreen por monitor do desktop remoto.
///
/// O posicionamento é uma solicitação *best effort*: compositores Wayland
/// podem ignorá-lo. O fullscreen borderless ainda permite que cada janela use
/// o monitor escolhido pelo compositor/gerenciador de janelas.
#[allow(clippy::too_many_arguments)]
pub fn run_multi_window(
    host: String,
    port: u16,
    desktop_width: u32,
    desktop_height: u32,
    monitors: Vec<MonitorLayout>,
    image: DecodedImage,
    active_stage: ActiveStage,
    framed: UpgradedFramed,
) -> Result<()> {
    if desktop_width == 0 || desktop_height == 0 {
        bail!("RDP desktop dimensions cannot be zero");
    }
    if monitors.is_empty() {
        bail!("multimonitor viewer requires at least one monitor layout");
    }

    let event_loop = EventLoop::new().context("create winit event loop")?;
    let worker =
        RdpWorker::start(active_stage, framed, image).context("start RDP network worker")?;
    let mut app = MultiMonitorApp::new(
        host,
        port,
        desktop_width,
        desktop_height,
        monitors,
        worker,
    );
    let run_result = event_loop
        .run_app(&mut app)
        .context("run winit multimonitor viewer");
    app.shutdown();
    run_result?;
    app.error.map_or(Ok(()), Err)
}

struct MonitorWindow {
    window: Arc<Window>,
    presenter: GpuPresenter,
    input: WinitInputState,
    /// Cópia local do monitor, em RGBA, para usar a API de upload local do
    /// presenter. Não é uma conversão de formato e só recebe regiões alteradas.
    rgba: Vec<u8>,
    remote_x: u32,
    remote_y: u32,
    remote_width: u32,
    remote_height: u32,
}

impl MonitorWindow {
    fn mapping(&self, window_size: PhysicalSize<u32>) -> DisplayMapping {
        DisplayMapping::new(
            window_size.width.max(1),
            window_size.height.max(1),
            self.remote_width,
            self.remote_height,
        )
        .with_offset(
            self.remote_x.min(i32::MAX as u32) as i32,
            self.remote_y.min(i32::MAX as u32) as i32,
        )
    }
}

struct MultiMonitorApp {
    host: String,
    port: u16,
    desktop_width: u32,
    desktop_height: u32,
    layouts: Vec<MonitorLayout>,
    worker: RdpWorker,
    shared_image: SharedDecodedImage,
    windows: HashMap<WindowId, MonitorWindow>,
    last_input_window: Option<WindowId>,
    pending_input: Vec<FastPathInputEvent>,
    pending_dirty_rects: Vec<DirtyRect>,
    first_upload: bool,
    next_tick: Instant,
    metrics: ViewerMetrics,
    last_metrics_report: Instant,
    shutdown_complete: bool,
    error: Option<anyhow::Error>,
}

impl MultiMonitorApp {
    #[allow(clippy::too_many_arguments)]
    fn new(
        host: String,
        port: u16,
        desktop_width: u32,
        desktop_height: u32,
        layouts: Vec<MonitorLayout>,
        worker: RdpWorker,
    ) -> Self {
        let shared_image = worker.shared_image();
        Self {
            host,
            port,
            desktop_width,
            desktop_height,
            layouts,
            worker,
            shared_image,
            windows: HashMap::new(),
            last_input_window: None,
            pending_input: Vec::new(),
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

    fn create_windows(&mut self, event_loop: &ActiveEventLoop) -> Result<()> {
        for (index, layout) in self.layouts.iter().enumerate() {
            let Some((width, height)) =
                effective_size(layout, self.desktop_width, self.desktop_height)
            else {
                eprintln!(
                    "[viewer] monitor[{index}] offset ({},{}) outside remote desktop ({}x{}); ignored",
                    layout.left, layout.top, self.desktop_width, self.desktop_height
                );
                continue;
            };
            let primary = if layout.is_primary { " [primary]" } else { "" };
            let title = format!(
                "Internal RDP - {}:{} — Monitor {} ({}×{}){}",
                self.host,
                self.port,
                index + 1,
                width,
                height,
                primary
            );
            let attributes = Window::default_attributes()
                .with_title(title)
                .with_inner_size(PhysicalSize::new(width, height))
                .with_position(PhysicalPosition::new(
                    layout.left.min(i32::MAX as u32) as i32,
                    layout.top.min(i32::MAX as u32) as i32,
                ))
                .with_resizable(false)
                .with_fullscreen(Some(Fullscreen::Borderless(None)));
            let window = Arc::new(
                event_loop
                    .create_window(attributes)
                    .with_context(|| format!("create viewer window for monitor {index}"))?,
            );
            window.set_cursor_visible(false);
            let presenter = GpuPresenter::new(Arc::clone(&window))
                .with_context(|| format!("initialize GPU presenter for monitor {index}"))?;
            let input = WinitInputState::new(
                DisplayMapping::new(width, height, width, height).with_offset(
                    layout.left.min(i32::MAX as u32) as i32,
                    layout.top.min(i32::MAX as u32) as i32,
                ),
            );
            let rgba_len = checked_rgba_len(width, height)?;
            let id = window.id();
            self.windows.insert(
                id,
                MonitorWindow {
                    window,
                    presenter,
                    input,
                    rgba: vec![0; rgba_len],
                    remote_x: layout.left,
                    remote_y: layout.top,
                    remote_width: width,
                    remote_height: height,
                },
            );
            eprintln!(
                "[viewer] wgpu window[{index}] created: {width}x{height} offset=({}, {})",
                layout.left, layout.top
            );
        }
        if self.windows.is_empty() {
            bail!("no monitor layout intersects the remote desktop");
        }
        Ok(())
    }

    fn tick(&mut self) -> Result<()> {
        if !self.pending_input.is_empty() {
            let events = std::mem::take(&mut self.pending_input);
            self.worker
                .send_input(events)
                .context("queue RDP input for network worker")?;
        }

        let mut worker_stopped = false;
        for event in self.worker.try_drain_updates() {
            match event {
                RdpWorkerEvent::Update(update) => {
                    self.metrics.record_decode_time(
                        update.active_stage_process_duration + update.input_process_duration,
                    );
                    self.metrics.record_network_read_time(update.pdu_read_duration);
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
                            self.desktop_width,
                            self.desktop_height,
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
                self.desktop_width,
                self.desktop_height,
            ));
            self.first_upload = false;
        }

        if self.pending_dirty_rects.is_empty() {
            return Ok(());
        }

        // Do not block the event loop while the network worker decodes a PDU.
        // Keep the lock only for the tight CPU copies into monitor-local buffers;
        // texture uploads and presentation happen after it is released.
        let image = match self.shared_image.try_lock() {
            Ok(image) => image,
            Err(TryLockError::WouldBlock) => return Ok(()),
            Err(TryLockError::Poisoned(_)) => bail!("decoded image lock poisoned"),
        };
        let rgba = image.data();
        let mut monitor_dirty = Vec::new();
        for monitor in self.windows.values_mut() {
            let mut local_dirty = Vec::new();
            for rect in self.pending_dirty_rects.iter().copied() {
                if let Some((global, local)) = clip_dirty_rect(rect, monitor) {
                    copy_global_rect_to_monitor(
                        rgba,
                        self.desktop_width,
                        &mut monitor.rgba,
                        monitor.remote_width,
                        global,
                        local,
                    )?;
                    local_dirty.push(local);
                }
            }
            if local_dirty.is_empty() {
                continue;
            }
            monitor_dirty.push((monitor.window.id(), local_dirty));
        }
        drop(image);
        self.pending_dirty_rects.clear();

        for (window_id, local_dirty) in monitor_dirty {
            let monitor = self
                .windows
                .get_mut(&window_id)
                .context("multimonitor window disappeared during upload")?;
            let upload_started = Instant::now();
            monitor
                .presenter
                .upload_dirty_rects(
                    &monitor.rgba,
                    monitor.remote_width,
                    monitor.remote_height,
                    &local_dirty,
                )
                .context("upload monitor dirty regions to GPU")?;
            let pixels = local_dirty.iter().fold(0u64, |sum, rect| {
                sum.saturating_add(u64::from(rect.width) * u64::from(rect.height))
            });
            self.metrics
                .record_conversion(pixels.saturating_mul(4), pixels);
            self.metrics
                .record_conversion_time(upload_started.elapsed());
            monitor.window.request_redraw();
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

impl ApplicationHandler for MultiMonitorApp {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if !self.windows.is_empty() {
            return;
        }
        if let Err(error) = self.create_windows(event_loop) {
            self.stop_with_error(event_loop, error);
            return;
        }
        self.next_tick = Instant::now();
        event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_tick));
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                self.shutdown();
                event_loop.exit();
            }
            WindowEvent::Resized(size) => {
                if let Some(monitor) = self.windows.get_mut(&window_id) {
                    monitor.presenter.resize(size.width, size.height);
                    monitor.input.mapping = monitor.mapping(size);
                    monitor.window.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => {
                if let Some(monitor) = self.windows.get_mut(&window_id) {
                    let presentation_started = Instant::now();
                    match monitor
                        .presenter
                        .render()
                        .context("render multimonitor RDP frame")
                    {
                        Ok(()) => {
                            self.metrics
                                .record_presentation_time(presentation_started.elapsed());
                            self.metrics.record_frame_rendered();
                            self.metrics.record_window_update();
                        }
                        Err(error) => self.stop_with_error(event_loop, error),
                    }
                }
            }
            WindowEvent::CursorEntered { .. } | WindowEvent::Focused(true) => {
                self.last_input_window = Some(window_id);
            }
            event => {
                if let Some(monitor) = self.windows.get_mut(&window_id) {
                    self.last_input_window = Some(window_id);
                    self.pending_input
                        .extend(monitor.input.handle_window_event(&event));
                }
            }
        }
    }

    fn device_event(
        &mut self,
        _event_loop: &ActiveEventLoop,
        _device_id: DeviceId,
        event: DeviceEvent,
    ) {
        if let Some(monitor) = self
            .last_input_window
            .and_then(|id| self.windows.get_mut(&id))
        {
            self.pending_input
                .extend(monitor.input.handle_device_event(&event));
        }
    }

    fn about_to_wait(&mut self, event_loop: &ActiveEventLoop) {
        let now = Instant::now();
        if now < self.next_tick {
            event_loop.set_control_flow(ControlFlow::WaitUntil(self.next_tick));
            return;
        }
        if let Err(error) = self.tick() {
            self.stop_with_error(
                event_loop,
                error.context("advance multimonitor RDP session"),
            );
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

fn effective_size(
    layout: &MonitorLayout,
    desktop_width: u32,
    desktop_height: u32,
) -> Option<(u32, u32)> {
    if layout.left >= desktop_width
        || layout.top >= desktop_height
        || layout.width == 0
        || layout.height == 0
    {
        return None;
    }
    Some((
        layout.width.min(desktop_width - layout.left),
        layout.height.min(desktop_height - layout.top),
    ))
}

fn checked_rgba_len(width: u32, height: u32) -> Result<usize> {
    usize::try_from(width)
        .ok()
        .and_then(|width| {
            usize::try_from(height)
                .ok()
                .and_then(|height| width.checked_mul(height))
        })
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or_else(|| anyhow!("RGBA monitor dimensions overflow"))
}

/// Retorna a interseção global e o retângulo equivalente na textura local.
fn clip_dirty_rect(global: DirtyRect, monitor: &MonitorWindow) -> Option<(DirtyRect, DirtyRect)> {
    let right = global.x.checked_add(global.width)?;
    let bottom = global.y.checked_add(global.height)?;
    let monitor_right = monitor.remote_x.checked_add(monitor.remote_width)?;
    let monitor_bottom = monitor.remote_y.checked_add(monitor.remote_height)?;
    let left = global.x.max(monitor.remote_x);
    let top = global.y.max(monitor.remote_y);
    let right = right.min(monitor_right);
    let bottom = bottom.min(monitor_bottom);
    if left >= right || top >= bottom {
        return None;
    }
    let clipped = DirtyRect::new(left, top, right - left, bottom - top);
    Some((
        clipped,
        DirtyRect::new(
            left - monitor.remote_x,
            top - monitor.remote_y,
            clipped.width,
            clipped.height,
        ),
    ))
}

fn copy_global_rect_to_monitor(
    global_rgba: &[u8],
    desktop_width: u32,
    monitor_rgba: &mut [u8],
    monitor_width: u32,
    global: DirtyRect,
    local: DirtyRect,
) -> Result<()> {
    let source_stride = usize::try_from(desktop_width)
        .context("desktop stride")?
        .checked_mul(4)
        .ok_or_else(|| anyhow!("desktop stride overflow"))?;
    let destination_stride = usize::try_from(monitor_width)
        .context("monitor stride")?
        .checked_mul(4)
        .ok_or_else(|| anyhow!("monitor stride overflow"))?;
    let row_bytes = usize::try_from(global.width)
        .context("dirty width")?
        .checked_mul(4)
        .ok_or_else(|| anyhow!("dirty row width overflow"))?;
    for row in 0..global.height {
        let source_start = usize::try_from(global.y + row)
            .context("source y")?
            .checked_mul(source_stride)
            .and_then(|offset| offset.checked_add(usize::try_from(global.x).ok()?.checked_mul(4)?))
            .ok_or_else(|| anyhow!("source offset overflow"))?;
        let destination_start = usize::try_from(local.y + row)
            .context("destination y")?
            .checked_mul(destination_stride)
            .and_then(|offset| offset.checked_add(usize::try_from(local.x).ok()?.checked_mul(4)?))
            .ok_or_else(|| anyhow!("destination offset overflow"))?;
        let source_end = source_start
            .checked_add(row_bytes)
            .ok_or_else(|| anyhow!("source end overflow"))?;
        let destination_end = destination_start
            .checked_add(row_bytes)
            .ok_or_else(|| anyhow!("destination end overflow"))?;
        let source = global_rgba
            .get(source_start..source_end)
            .ok_or_else(|| anyhow!("source dirty rect is outside RDP image"))?;
        let destination = monitor_rgba
            .get_mut(destination_start..destination_end)
            .ok_or_else(|| anyhow!("destination dirty rect is outside monitor image"))?;
        destination.copy_from_slice(source);
    }
    Ok(())
}

fn push_dirty_rect(
    dirty_rects: &mut Vec<DirtyRect>,
    region: InclusiveRectangle,
    desktop_width: u32,
    desktop_height: u32,
) {
    if desktop_width == 0 || desktop_height == 0 {
        return;
    }
    let left = u32::from(region.left).min(desktop_width - 1);
    let top = u32::from(region.top).min(desktop_height - 1);
    let right = u32::from(region.right).min(desktop_width - 1);
    let bottom = u32::from(region.bottom).min(desktop_height - 1);
    if left <= right && top <= bottom {
        dirty_rects.push(DirtyRect::new(
            left,
            top,
            right - left + 1,
            bottom - top + 1,
        ));
    }
}

fn report_metrics(metrics: Snapshot) {
    eprintln!(
        "[viewer][metrics] renderer=wgpu-multimon received={} rendered={} window_updates={} pixels={} bytes={} decode_ms={} read_ms={} process_ms={} write_ms={} upload_ms={} present_ms={}",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effective_size_clips_to_desktop() {
        let layout = MonitorLayout {
            left: 8,
            top: 9,
            width: 10,
            height: 10,
            is_primary: false,
            scale_factor: 100,
        };
        assert_eq!(effective_size(&layout, 12, 14), Some((4, 5)));
    }

    #[test]
    fn copies_a_clipped_source_rectangle() {
        let global: Vec<u8> = (0..(4 * 3 * 4)).map(|value| value as u8).collect();
        let mut local = vec![0; 2 * 2 * 4];
        copy_global_rect_to_monitor(
            &global,
            4,
            &mut local,
            2,
            DirtyRect::new(1, 1, 2, 2),
            DirtyRect::new(0, 0, 2, 2),
        )
        .unwrap();
        let expected = [
            &global[(1 * 4 + 1) * 4..(1 * 4 + 3) * 4],
            &global[(2 * 4 + 1) * 4..(2 * 4 + 3) * 4],
        ]
        .concat();
        assert_eq!(local, expected);
    }
}
