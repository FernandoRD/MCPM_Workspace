use std::path::PathBuf;
use std::time::{Duration, Instant};

use anyhow::{Context, bail};
use image::{ImageBuffer, Rgba};
use internal_rdp_client::mvp_runtime::{connect_with_password, SessionProfile};
use internal_rdp_client::settings_bridge::{
    apply_profile_preferences, default_settings_file_path, load_default_rdp_preferences,
    load_rdp_preferences, parse_bool_toggle, parse_negative_bool_toggle, PerformanceOverrides,
};
use ironrdp::graphics::image_processing::PixelFormat;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::ActiveStage;

const HELP: &str = "\
USAGE:
  cargo run --manifest-path experiments/internal-rdp-client/Cargo.toml --bin screenshot_mvp -- \\
    --host <HOST> --username <USERNAME> --password <PASSWORD> [--port <PORT>] [--output <PNG>] [--domain <DOMAIN>] [--settings-file <JSON|SSHVAULT>] [--width <PX>] [--height <PX>] [--color-depth <15|16|24|32>] [--no-lossy]

SETTINGS FILE:
  --settings-file <PATH>      Load width, height, and internal-client visual preferences
                              from either a raw app settings JSON or an exported .sshvault backup.
                              If omitted, the screenshot tool tries the mirrored app profile in
                              the default application data directory automatically.

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
            output,
            domain,
            settings_file,
            width_override,
            height_override,
            color_depth,
            lossy_compression,
            performance_overrides,
        } => run(
            host,
            port,
            username,
            password,
            output,
            domain,
            settings_file,
            width_override,
            height_override,
            color_depth,
            lossy_compression,
            performance_overrides,
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
        output: PathBuf,
        domain: Option<String>,
        settings_file: Option<PathBuf>,
        width_override: Option<u16>,
        height_override: Option<u16>,
        color_depth: u32,
        lossy_compression: bool,
        performance_overrides: PerformanceOverrides,
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
    let mut output = PathBuf::from("rdp_mvp_screenshot.png");
    let mut domain = None;
    let mut settings_file = None;
    let mut width_override = None;
    let mut height_override = None;
    let mut color_depth = 16u32;
    let mut lossy_compression = true;
    let mut performance_overrides = PerformanceOverrides::default();

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
            "--output" | "-o" => output = PathBuf::from(next_value(&mut args, "--output")?),
            "--domain" | "-d" => domain = Some(next_value(&mut args, "--domain")?),
            "--settings-file" => settings_file = Some(PathBuf::from(next_value(&mut args, "--settings-file")?)),
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
            other => bail!("unknown argument: {other}"),
        }
    }

    validate_color_depth(color_depth)?;

    Ok(Action::Run {
        host: host.context("missing --host")?,
        port,
        username: username.context("missing --username")?,
        password: password.context("missing --password")?,
        output,
        domain,
        settings_file,
        width_override,
        height_override,
        color_depth,
        lossy_compression,
        performance_overrides,
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
    output: PathBuf,
    domain: Option<String>,
    settings_file: Option<PathBuf>,
    width_override: Option<u16>,
    height_override: Option<u16>,
    color_depth: u32,
    lossy_compression: bool,
    performance_overrides: PerformanceOverrides,
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
    let (width, height, _fullscreen, performance) = apply_profile_preferences(
        1280,
        720,
        loaded_preferences,
        None,
        width_override,
        height_override,
        performance_overrides,
    );

    let profile = SessionProfile {
        desktop_width: width,
        desktop_height: height,
        color_depth,
        lossy_compression,
        performance,
        monitors: Vec::new(),
    };

    let (connection_result, mut framed) = connect_with_password(
        host.clone(),
        port,
        username,
        password,
        domain,
        profile,
        Duration::from_secs(5),
        Duration::from_millis(100),
    )
    .with_context(|| format!("connect to {host}:{port}"))?;

    let mut image = DecodedImage::new(
        PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );
    let mut active_stage = ActiveStage::new(connection_result);
    let deadline = Instant::now() + Duration::from_secs(6);
    let mut changed = false;

    while Instant::now() < deadline {
        let frame_changed =
            internal_rdp_client::mvp_runtime::flush_active_stage_once(&mut active_stage, &mut framed, &mut image)?;
        changed |= frame_changed;
    }

    if !changed {
        bail!("no graphics updates received before timeout");
    }

    let img: ImageBuffer<Rgba<u8>, _> =
        ImageBuffer::from_raw(u32::from(image.width()), u32::from(image.height()), image.data())
            .context("invalid decoded image buffer")?;

    img.save(&output)
        .with_context(|| format!("save screenshot to {}", output.display()))?;

    println!("Screenshot saved to {}", output.display());
    Ok(())
}

fn validate_color_depth(color_depth: u32) -> anyhow::Result<()> {
    match color_depth {
        15 | 16 | 24 | 32 => Ok(()),
        _ => bail!("unsupported --color-depth value: {color_depth}; expected 15, 16, 24, or 32"),
    }
}
