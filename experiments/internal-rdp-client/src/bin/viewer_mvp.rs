use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use internal_rdp_client::mvp_runtime::{
    connect_with_password, drain_active_stage, SessionPerformanceConfig, SessionProfile,
};
use internal_rdp_client::viewer_input::{collect_window_input, MouseInputState};
use internal_rdp_client::viewer_renderer::{merge_dirty_region, ViewerBuffer};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::ActiveStage;
use minifb::{Window, WindowOptions};

const VIEWER_TARGET_FPS: usize = 120;
const ACTIVE_READ_TIMEOUT_MS: u64 = 2;
const MAX_DRAINED_FRAMES_PER_TICK: usize = 64;
const IDLE_PUMP_INTERVAL_MS: u64 = 125;

const HELP: &str = "\
USAGE:
  cargo run --manifest-path experiments/internal-rdp-client/Cargo.toml --bin viewer_mvp -- \\
    --host <HOST> --username <USERNAME> --password <PASSWORD> [--port <PORT>] [--domain <DOMAIN>] [--width <PX>] [--height <PX>] [--color-depth <15|16|24|32>] [--no-lossy] [--show-wallpaper] [--full-window-drag] [--menu-animations] [--theming] [--cursor-shadow] [--cursor-settings] [--font-smoothing] [--desktop-composition]
";

fn main() -> anyhow::Result<()> {
    match parse_args()? {
        Action::ShowHelp => {
            println!("{HELP}");
            Ok(())
        }
        Action::Run {
            host,
            port,
            username,
            password,
            domain,
            width,
            height,
            color_depth,
            lossy_compression,
            performance,
        } => run(
            host,
            port,
            username,
            password,
            domain,
            width,
            height,
            color_depth,
            lossy_compression,
            performance,
        ),
    }
}

#[derive(Debug)]
enum Action {
    ShowHelp,
    Run {
        host: String,
        port: u16,
        username: String,
        password: String,
        domain: Option<String>,
        width: u16,
        height: u16,
        color_depth: u32,
        lossy_compression: bool,
        performance: SessionPerformanceConfig,
    },
}

fn parse_args() -> anyhow::Result<Action> {
    let mut args = std::env::args().skip(1);

    if std::env::args().any(|arg| arg == "--help" || arg == "-h") {
        return Ok(Action::ShowHelp);
    }

    let mut host = None;
    let mut port = 3389u16;
    let mut username = None;
    let mut password = None;
    let mut domain = None;
    let mut width = 1280u16;
    let mut height = 720u16;
    let mut color_depth = 16u32;
    let mut lossy_compression = true;
    let mut performance = SessionPerformanceConfig::default();

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--host" => host = Some(next_value(&mut args, "--host")?),
            "--port" => port = next_value(&mut args, "--port")?.parse().context("invalid --port value")?,
            "--username" | "-u" => username = Some(next_value(&mut args, "--username")?),
            "--password" | "-p" => password = Some(next_value(&mut args, "--password")?),
            "--domain" | "-d" => domain = Some(next_value(&mut args, "--domain")?),
            "--width" => width = next_value(&mut args, "--width")?.parse().context("invalid --width value")?,
            "--height" => height = next_value(&mut args, "--height")?.parse().context("invalid --height value")?,
            "--color-depth" => {
                color_depth = next_value(&mut args, "--color-depth")?
                    .parse()
                    .context("invalid --color-depth value")?
            }
            "--no-lossy" => lossy_compression = false,
            "--show-wallpaper" => performance.wallpaper = true,
            "--full-window-drag" => performance.full_window_drag = true,
            "--menu-animations" => performance.menu_animations = true,
            "--theming" => performance.theming = true,
            "--cursor-shadow" => performance.cursor_shadow = true,
            "--cursor-settings" => performance.cursor_settings = true,
            "--font-smoothing" => performance.font_smoothing = true,
            "--desktop-composition" => performance.desktop_composition = true,
            other => bail!("unknown argument: {other}"),
        }
    }

    validate_color_depth(color_depth)?;

    Ok(Action::Run {
        host: host.context("missing --host")?,
        port,
        username: username.context("missing --username")?,
        password: password.context("missing --password")?,
        domain,
        width,
        height,
        color_depth,
        lossy_compression,
        performance,
    })
}

fn next_value(args: &mut impl Iterator<Item = String>, flag: &str) -> anyhow::Result<String> {
    args.next().with_context(|| format!("missing value for {flag}"))
}

fn run(
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: u16,
    height: u16,
    color_depth: u32,
    lossy_compression: bool,
    performance: SessionPerformanceConfig,
) -> anyhow::Result<()> {
    let profile = SessionProfile {
        desktop_width: width,
        desktop_height: height,
        color_depth,
        lossy_compression,
        performance,
    };

    let (connection_result, mut framed) = connect_with_password(
        host.clone(),
        port,
        username,
        password,
        domain,
        profile,
        Duration::from_secs(5),
        Duration::from_millis(ACTIVE_READ_TIMEOUT_MS),
    )
    .with_context(|| format!("connect to {host}:{port}"))?;

    let width = usize::from(connection_result.desktop_size.width);
    let height = usize::from(connection_result.desktop_size.height);
    let mut image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    let mut active_stage = ActiveStage::new(connection_result);
    let mut window = Window::new(
        &format!("Internal RDP MVP - {host}:{port}"),
        width,
        height,
        WindowOptions::default(),
    )
    .context("create viewer window")?;
    window.set_target_fps(VIEWER_TARGET_FPS);
    window.set_cursor_visibility(false);

    let mut buffer = ViewerBuffer::new(width, height);
    let mut last_redraw = Instant::now();
    let mut mouse_state = MouseInputState::default();

    while window.is_open() {
        let input_events = collect_window_input(&window, width, height, &mut mouse_state);
        let input_dirty_region = if input_events.is_empty() {
            None
        } else {
            let outputs = active_stage.process_fastpath_input(&mut image, &input_events)?;
            internal_rdp_client::mvp_runtime::apply_active_stage_outputs(&mut framed, outputs)?
        };

        let frame_dirty_region = drain_active_stage(
            &mut active_stage,
            &mut framed,
            &mut image,
            MAX_DRAINED_FRAMES_PER_TICK,
        )?
        .dirty_region;
        let dirty_region = merge_dirty_region(input_dirty_region, frame_dirty_region);

        if buffer.apply_rgba_update(image.data(), dirty_region.as_ref()) {
            window
                .update_with_buffer(buffer.pixels(), width, height)
                .context("update viewer window")?;
            last_redraw = Instant::now();
        } else if last_redraw.elapsed() >= Duration::from_millis(IDLE_PUMP_INTERVAL_MS) {
            window.update();
            last_redraw = Instant::now();
        } else {
            window.update();
        }
    }

    if let Ok(outputs) = active_stage.graceful_shutdown() {
        let _ = internal_rdp_client::mvp_runtime::apply_active_stage_outputs(&mut framed, outputs);
    }

    Ok(())
}

fn validate_color_depth(color_depth: u32) -> anyhow::Result<()> {
    match color_depth {
        15 | 16 | 24 | 32 => Ok(()),
        _ => bail!("unsupported --color-depth value: {color_depth}; expected 15, 16, 24, or 32"),
    }
}
