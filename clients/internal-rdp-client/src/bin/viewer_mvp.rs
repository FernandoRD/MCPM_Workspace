use std::time::{Duration, Instant};
use std::path::PathBuf;

use anyhow::{Context, bail};
use internal_rdp_client::mvp_runtime::{
    connect_with_password, drain_active_stage, MonitorLayout, SessionProfile, UpgradedFramed,
};
use internal_rdp_client::settings_bridge::{
    apply_profile_preferences, default_settings_file_path, load_default_rdp_preferences,
    load_rdp_preferences, parse_bool_toggle, parse_negative_bool_toggle, PerformanceOverrides,
};
use internal_rdp_client::viewer_input::{collect_window_input, MouseInputState};
use internal_rdp_client::viewer_renderer::{merge_dirty_region, ViewerBuffer};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::ActiveStage;
use minifb::{Scale, ScaleMode, Window, WindowOptions};

const VIEWER_TARGET_FPS: usize = 120;
const ACTIVE_READ_TIMEOUT_MS: u64 = 2;
const MAX_DRAINED_FRAMES_PER_TICK: usize = 64;
const IDLE_PUMP_INTERVAL_MS: u64 = 125;

const HELP: &str = "\
USAGE:
  cargo run --manifest-path clients/internal-rdp-client/Cargo.toml --bin viewer_mvp -- \\
    --host <HOST> --username <USERNAME> --password <PASSWORD> [--port <PORT>] [--domain <DOMAIN>] [--settings-file <JSON|SSHVAULT>] [--fullscreen|--windowed] [--width <PX>] [--height <PX>] [--color-depth <15|16|24|32>] [--no-lossy] [--monitor <SPEC>...]

MONITOR (multimon mode):
  --monitor <left,top,width,height,primary,scale>
                              Declare one monitor. Repeat for each monitor (normalised coordinates).
                              When any --monitor is present the viewer creates one window per monitor
                              and renders bounding-box desktop slices. Example:
                                --monitor 0,0,1920,1080,true,100
                                --monitor 1920,0,1920,1080,false,100

SETTINGS FILE:
  --settings-file <PATH>      Load width, height, and internal-client visual preferences
                              from either a raw app settings JSON or an exported .sshvault backup.
                              If omitted, the viewer tries the mirrored app profile in the default
                              application data directory automatically.

VISUAL TOGGLES:
  --show-wallpaper | --hide-wallpaper
  --full-window-drag | --no-full-window-drag
  --menu-animations | --no-menu-animations
  --theming | --no-theming
  --cursor-shadow | --no-cursor-shadow
  --cursor-settings | --no-cursor-settings
  --font-smoothing | --no-font-smoothing
  --desktop-composition | --no-desktop-composition
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
            settings_file,
            fullscreen_override,
            width_override,
            height_override,
            color_depth,
            lossy_compression,
            performance_overrides,
            monitors,
        } => run(
            host,
            port,
            username,
            password,
            domain,
            settings_file,
            fullscreen_override,
            width_override,
            height_override,
            color_depth,
            lossy_compression,
            performance_overrides,
            monitors,
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
        settings_file: Option<PathBuf>,
        fullscreen_override: Option<bool>,
        width_override: Option<u16>,
        height_override: Option<u16>,
        color_depth: u32,
        lossy_compression: bool,
        performance_overrides: PerformanceOverrides,
        monitors: Vec<MonitorLayout>,
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
    let mut settings_file = None;
    let mut fullscreen_override = None;
    let mut width_override = None;
    let mut height_override = None;
    let mut color_depth = 16u32;
    let mut lossy_compression = true;
    let mut performance_overrides = PerformanceOverrides::default();
    let mut monitors: Vec<MonitorLayout> = Vec::new();

    while let Some(flag) = args.next() {
        if parse_bool_toggle(&mut performance_overrides, flag.as_str(), true)? {
            continue;
        }

        if parse_negative_bool_toggle(&mut performance_overrides, flag.as_str())? {
            continue;
        }

        match flag.as_str() {
            "--host" => host = Some(next_value(&mut args, "--host")?),
            "--port" => port = next_value(&mut args, "--port")?.parse().context("invalid --port value")?,
            "--username" | "-u" => username = Some(next_value(&mut args, "--username")?),
            "--password" | "-p" => password = Some(next_value(&mut args, "--password")?),
            "--domain" | "-d" => domain = Some(next_value(&mut args, "--domain")?),
            "--settings-file" => settings_file = Some(PathBuf::from(next_value(&mut args, "--settings-file")?)),
            "--fullscreen" => fullscreen_override = Some(true),
            "--windowed" => fullscreen_override = Some(false),
            "--width" => {
                width_override = Some(next_value(&mut args, "--width")?.parse().context("invalid --width value")?)
            }
            "--height" => {
                height_override = Some(next_value(&mut args, "--height")?.parse().context("invalid --height value")?)
            }
            "--color-depth" => {
                color_depth = next_value(&mut args, "--color-depth")?
                    .parse()
                    .context("invalid --color-depth value")?
            }
            "--no-lossy" => lossy_compression = false,
            "--monitor" => {
                let spec = next_value(&mut args, "--monitor")?;
                monitors.push(parse_monitor_spec(&spec)?);
            }
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
        settings_file,
        fullscreen_override,
        width_override,
        height_override,
        color_depth,
        lossy_compression,
        performance_overrides,
        monitors,
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
    settings_file: Option<PathBuf>,
    fullscreen_override: Option<bool>,
    width_override: Option<u16>,
    height_override: Option<u16>,
    color_depth: u32,
    lossy_compression: bool,
    performance_overrides: PerformanceOverrides,
    monitors: Vec<MonitorLayout>,
) -> anyhow::Result<()> {
    let loaded_preferences = match settings_file.as_ref() {
        Some(path) => Some(load_rdp_preferences(path.as_path())?),
        None => load_default_rdp_preferences()?,
    };
    if settings_file.is_none() {
        if let Some(path) = default_settings_file_path().filter(|path| path.exists()) {
            eprintln!("Using mirrored RDP settings from {}", path.display());
        }
    }

    let (width, height, fullscreen, performance) = if monitors.is_empty() {
        apply_profile_preferences(
            1280,
            720,
            loaded_preferences,
            fullscreen_override,
            width_override,
            height_override,
            performance_overrides,
        )
    } else {
        // Bounding box from monitor list; ignore size overrides for the RDP session resolution.
        let (bb_w, bb_h) = MonitorLayout::desktop_size(&monitors);
        let (_, _, fullscreen, performance) = apply_profile_preferences(
            bb_w,
            bb_h,
            loaded_preferences,
            fullscreen_override,
            None,
            None,
            performance_overrides,
        );
        (bb_w, bb_h, fullscreen, performance)
    };

    // In non-fullscreen multimon mode, compute the display window size from overrides or
    // scale down to fit within a reasonable default (1920×1080).
    let (display_w, display_h) = if !monitors.is_empty() && !fullscreen {
        let bb_w = width as f64;
        let bb_h = height as f64;
        let ow = width_override.map(|w| w as f64).unwrap_or(bb_w);
        let oh = height_override.map(|h| h as f64).unwrap_or(bb_h);
        // Keep aspect ratio: scale uniformly so display fits within the override box
        let scale = (ow / bb_w).min(oh / bb_h).min(1.0);
        ((bb_w * scale).round() as usize, (bb_h * scale).round() as usize)
    } else {
        (width as usize, height as usize)
    };

    let profile = SessionProfile {
        desktop_width: width,
        desktop_height: height,
        color_depth,
        lossy_compression,
        performance,
        monitors: monitors.clone(),
    };

    let (connection_result, framed) = connect_with_password(
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

    let desktop_width = usize::from(connection_result.desktop_size.width);
    let desktop_height = usize::from(connection_result.desktop_size.height);
    eprintln!("[viewer] desktop_size={}x{} monitors={}", desktop_width, desktop_height, monitors.len());
    for (i, m) in monitors.iter().enumerate() {
        eprintln!("[viewer] monitor[{i}]: left={} top={} width={} height={} primary={}", m.left, m.top, m.width, m.height, m.is_primary);
    }
    let image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    let active_stage = ActiveStage::new(connection_result);

    if monitors.is_empty() || !fullscreen {
        // Single window: either single-monitor, or non-fullscreen multimon (show bounding box scaled).
        run_single_window(host, port, fullscreen, desktop_width, desktop_height, display_w, display_h, image, active_stage, framed)
    } else {
        // Fullscreen multimon: one dedicated window per monitor.
        run_multi_window(host, port, desktop_width, desktop_height, monitors, image, active_stage, framed)
    }
}

fn make_window_options(fullscreen: bool) -> WindowOptions {
    if fullscreen {
        WindowOptions {
            borderless: true,
            title: false,
            resize: false,
            scale: Scale::X1,
            scale_mode: ScaleMode::Stretch,
            topmost: true,
            ..WindowOptions::default()
        }
    } else {
        WindowOptions::default()
    }
}

fn run_single_window(
    host: String,
    port: u16,
    fullscreen: bool,
    buf_w: usize,
    buf_h: usize,
    display_w: usize,
    display_h: usize,
    mut image: DecodedImage,
    mut active_stage: ActiveStage,
    mut framed: UpgradedFramed,
) -> anyhow::Result<()> {
    let mut window = Window::new(
        &format!("Internal RDP - {host}:{port}"),
        display_w,
        display_h,
        make_window_options(fullscreen),
    )
    .context("create viewer window")?;
    window.set_target_fps(VIEWER_TARGET_FPS);
    window.set_cursor_visibility(false);
    if fullscreen {
        window.set_position(0, 0);
        window.topmost(true);
    }

    let mut buffer = ViewerBuffer::new(buf_w, buf_h);
    let mut last_redraw = Instant::now();
    let mut mouse_state = MouseInputState::default();

    while window.is_open() {
        let input_events = collect_window_input(&window, display_w, display_h, buf_w, buf_h, &mut mouse_state, 0, 0);
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
                .update_with_buffer(buffer.pixels(), buf_w, buf_h)
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

struct MonitorWindow {
    window: Window,
    buffer: ViewerBuffer,
    mouse_state: MouseInputState,
    mon_x: usize,
    mon_y: usize,
    width: usize,
    height: usize,
    offset_x: i32,
    offset_y: i32,
}

/// Fullscreen multimon: one window per monitor.
/// On Windows, set_position() works via Win32 so windows are placed and fullscreened automatically.
/// On Linux/Wayland, xdg_toplevel does not support programmatic positioning; windows open at the
/// compositor's default position and the user should move + fullscreen each one manually
/// (e.g. Super+↑ or F11 on KDE).
/// Only called when `fullscreen == true`; in windowed mode `run_single_window` is used instead.
fn run_multi_window(
    host: String,
    port: u16,
    desktop_width: usize,
    desktop_height: usize,
    monitors: Vec<MonitorLayout>,
    mut image: DecodedImage,
    mut active_stage: ActiveStage,
    mut framed: UpgradedFramed,
) -> anyhow::Result<()> {
    // On Windows, use borderless (true fullscreen per monitor).
    // On Linux/Wayland, use regular windows — positioning is not supported by xdg_toplevel.
    #[cfg(target_os = "windows")]
    let window_opts = make_window_options(true);
    #[cfg(not(target_os = "windows"))]
    let window_opts = make_window_options(false);

    let mut mon_windows: Vec<MonitorWindow> = Vec::new();
    for (i, m) in monitors.iter().enumerate() {
        let w = m.width as usize;
        let h = m.height as usize;
        let mon_x = m.left as usize;
        let mon_y = m.top as usize;

        // Verifica se este monitor cabe dentro do desktop negociado com o servidor.
        // Se o servidor não suportar multimon, desktop pode ser menor que o bounding box.
        if mon_x >= desktop_width || mon_y >= desktop_height {
            eprintln!("[viewer] monitor[{i}] offset ({mon_x},{mon_y}) fora do desktop ({desktop_width}x{desktop_height}), ignorando");
            continue;
        }
        // Limita width/height ao que o servidor realmente enviou
        let effective_w = w.min(desktop_width - mon_x);
        let effective_h = h.min(desktop_height - mon_y);
        if effective_w != w || effective_h != h {
            eprintln!("[viewer] monitor[{i}] tamanho reduzido de {w}x{h} para {effective_w}x{effective_h} (desktop {desktop_width}x{desktop_height})");
        }

        let primary_label = if m.is_primary { " [primário]" } else { "" };
        let title = format!("Internal RDP - {host}:{port} — Monitor {} ({effective_w}×{effective_h}){primary_label}", i + 1);
        let mut win = Window::new(&title, effective_w, effective_h, window_opts.clone())
            .with_context(|| format!("create window for monitor {i}"))?;
        win.set_target_fps(VIEWER_TARGET_FPS);
        win.set_cursor_visibility(false);
        #[cfg(target_os = "windows")]
        {
            win.set_position(m.left as isize, m.top as isize);
            win.topmost(true);
        }

        eprintln!("[viewer] janela[{i}] criada: {effective_w}x{effective_h} offset=({mon_x},{mon_y})");
        mon_windows.push(MonitorWindow {
            window: win,
            buffer: ViewerBuffer::new(effective_w, effective_h),
            mouse_state: MouseInputState::default(),
            mon_x,
            mon_y,
            width: effective_w,
            height: effective_h,
            offset_x: m.left as i32,
            offset_y: m.top as i32,
        });
    }

    let mut last_redraw = Instant::now();
    let mut frame_count = 0u64;

    loop {
        frame_count += 1;
        let any_open = mon_windows.iter().any(|mw| mw.window.is_open());
        if !any_open {
            break;
        }

        // Fullscreen multimon: windows are on separate physical monitors, so there is no
        // pointer overlap. Collect input from all open windows independently.
        let mut all_input: Vec<_> = Vec::new();
        for mw in mon_windows.iter_mut() {
            if !mw.window.is_open() {
                continue;
            }
            let events = collect_window_input(
                &mw.window,
                mw.width,
                mw.height,
                mw.width,
                mw.height,
                &mut mw.mouse_state,
                mw.offset_x,
                mw.offset_y,
            );
            all_input.extend(events);
        }

        let input_dirty_region = if all_input.is_empty() {
            None
        } else {
            let outputs = active_stage.process_fastpath_input(&mut image, &all_input)?;
            internal_rdp_client::mvp_runtime::apply_active_stage_outputs(&mut framed, outputs)?
        };

        let drain_result = drain_active_stage(
            &mut active_stage,
            &mut framed,
            &mut image,
            MAX_DRAINED_FRAMES_PER_TICK,
        );
        let frame_dirty_region = match drain_result {
            Ok(r) => r.dirty_region,
            Err(e) => {
                eprintln!("[viewer] sessão encerrada: {e}");
                break;
            }
        };
        let dirty_region = merge_dirty_region(input_dirty_region, frame_dirty_region);

        let rgba = image.data();
        let mut any_updated = false;
        for mw in &mut mon_windows {
            if !mw.window.is_open() {
                continue;
            }
            if mw.buffer.apply_rgba_update_from_full(rgba, desktop_width, mw.mon_x, mw.mon_y, dirty_region.as_ref()) {
                if let Err(e) = mw.window.update_with_buffer(mw.buffer.pixels(), mw.width, mw.height) {
                    eprintln!("[viewer] update_with_buffer falhou: {e}");
                    break;
                }
                any_updated = true;
            } else {
                mw.window.update();
            }
        }

        if any_updated {
            last_redraw = Instant::now();
        } else if last_redraw.elapsed() >= Duration::from_millis(IDLE_PUMP_INTERVAL_MS) {
            last_redraw = Instant::now();
        }
    }

    if let Ok(outputs) = active_stage.graceful_shutdown() {
        let _ = internal_rdp_client::mvp_runtime::apply_active_stage_outputs(&mut framed, outputs);
    }

    Ok(())
}

/// Parses `left,top,width,height,primary,scale` into a `MonitorLayout`.
/// `primary` accepts `true`/`false`/`1`/`0`. `scale` is an integer (100 = 100 %).
fn parse_monitor_spec(spec: &str) -> anyhow::Result<MonitorLayout> {
    let parts: Vec<&str> = spec.splitn(6, ',').collect();
    if parts.len() != 6 {
        bail!("--monitor expects left,top,width,height,primary,scale — got: {spec}");
    }
    let parse_u32 = |s: &str, name: &str| -> anyhow::Result<u32> {
        s.trim().parse::<u32>().with_context(|| format!("invalid {name} in --monitor: {spec}"))
    };
    let left = parse_u32(parts[0], "left")?;
    let top = parse_u32(parts[1], "top")?;
    let width = parse_u32(parts[2], "width")?;
    let height = parse_u32(parts[3], "height")?;
    let is_primary = matches!(parts[4].trim(), "true" | "1");
    let scale_factor = parse_u32(parts[5], "scale")?;

    if width == 0 || height == 0 {
        bail!("--monitor width and height must be > 0: {spec}");
    }

    Ok(MonitorLayout { left, top, width, height, is_primary, scale_factor })
}

fn validate_color_depth(color_depth: u32) -> anyhow::Result<()> {
    match color_depth {
        15 | 16 | 24 | 32 => Ok(()),
        _ => bail!("unsupported --color-depth value: {color_depth}; expected 15, 16, 24, or 32"),
    }
}
