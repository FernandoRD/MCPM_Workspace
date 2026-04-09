use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use cfg_if::cfg_if;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::{storage, AppState};

struct RdpSession {
    temp_file: PathBuf,
    child: Option<Child>,
    cmdkey_target: Option<String>,
}

pub struct RdpManager {
    sessions: HashMap<String, RdpSession>,
    internal_viewers: HashMap<String, Child>,
}

impl RdpManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            internal_viewers: HashMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpLaunchResult {
    launcher_name: String,
    executable: String,
    arguments_preview: String,
    password_handled: bool,
    credential_mode: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InternalRdpViewerLaunchResult {
    launcher_name: String,
    executable: String,
    arguments_preview: String,
    message: String,
    settings_source: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RdpConnectOptions {
    preferred_linux_client: Option<String>,
    fullscreen: Option<bool>,
    dynamic_resolution: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    multimon: Option<bool>,
    clipboard: Option<bool>,
    audio_mode: Option<String>,
    certificate_mode: Option<String>,
    internal_client_performance: Option<RdpPerformanceOptions>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RdpPerformanceOptions {
    wallpaper: Option<bool>,
    full_window_drag: Option<bool>,
    menu_animations: Option<bool>,
    theming: Option<bool>,
    cursor_settings: Option<bool>,
    font_smoothing: Option<bool>,
    desktop_composition: Option<bool>,
}

impl Default for RdpConnectOptions {
    fn default() -> Self {
        Self {
            preferred_linux_client: Some("auto".to_string()),
            fullscreen: Some(false),
            dynamic_resolution: Some(true),
            width: Some(1600),
            height: Some(900),
            multimon: Some(false),
            clipboard: Some(true),
            audio_mode: Some("redirect".to_string()),
            certificate_mode: Some("ignore".to_string()),
            internal_client_performance: Some(RdpPerformanceOptions::default()),
        }
    }
}

impl RdpConnectOptions {
    fn preferred_linux_client(&self) -> &str {
        self.preferred_linux_client.as_deref().unwrap_or("auto")
    }

    fn fullscreen(&self) -> bool {
        self.fullscreen.unwrap_or(false)
    }

    fn dynamic_resolution(&self) -> bool {
        self.dynamic_resolution.unwrap_or(true)
    }

    fn width(&self) -> u32 {
        self.width.unwrap_or(1600).clamp(640, 7680)
    }

    fn height(&self) -> u32 {
        self.height.unwrap_or(900).clamp(480, 4320)
    }

    fn multimon(&self) -> bool {
        self.multimon.unwrap_or(false)
    }

    fn clipboard(&self) -> bool {
        self.clipboard.unwrap_or(true)
    }

    fn audio_mode(&self) -> &str {
        self.audio_mode.as_deref().unwrap_or("redirect")
    }

    fn certificate_mode(&self) -> &str {
        self.certificate_mode.as_deref().unwrap_or("ignore")
    }

    fn performance(&self) -> RdpPerformanceOptions {
        self.internal_client_performance.clone().unwrap_or_default()
    }
}

impl RdpPerformanceOptions {
    fn wallpaper(&self) -> bool {
        self.wallpaper.unwrap_or(false)
    }

    fn full_window_drag(&self) -> bool {
        self.full_window_drag.unwrap_or(false)
    }

    fn menu_animations(&self) -> bool {
        self.menu_animations.unwrap_or(false)
    }

    fn theming(&self) -> bool {
        self.theming.unwrap_or(false)
    }

    fn cursor_settings(&self) -> bool {
        self.cursor_settings.unwrap_or(false)
    }

    fn font_smoothing(&self) -> bool {
        self.font_smoothing.unwrap_or(false)
    }

    fn desktop_composition(&self) -> bool {
        self.desktop_composition.unwrap_or(false)
    }
}

struct LaunchOutcome {
    child: Option<Child>,
    launcher_name: String,
    executable: String,
    arguments_preview: String,
    password_handled: bool,
    credential_mode: String,
    message: String,
    cmdkey_target: Option<String>,
}

struct InternalViewerLaunchOutcome {
    child: Child,
    launcher_name: String,
    executable: String,
    arguments_preview: String,
    message: String,
    settings_source: Option<String>,
}

fn cleanup_session(session: &mut RdpSession) {
    if let Some(child) = session.child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
    if let Some(cmdkey_target) = session.cmdkey_target.as_deref() {
        clear_windows_credentials(cmdkey_target);
    }
    let _ = fs::remove_file(&session.temp_file);
}

fn ensure_rdp_dir(state: &AppState) -> Result<PathBuf, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let dir = storage.data_dir.join("rdp");
    fs::create_dir_all(&dir).map_err(|e| format!("Falha ao preparar diretório RDP: {e}"))?;
    Ok(dir)
}

fn write_rdp_file(
    path: &Path,
    host: &str,
    port: u16,
    username: Option<&str>,
    options: &RdpConnectOptions,
    prompt_for_credentials: bool,
) -> Result<(), String> {
    let lines = build_rdp_file_lines(host, port, username, options, prompt_for_credentials);

    fs::write(path, format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("Falha ao gravar arquivo temporário RDP: {e}"))
}

fn build_rdp_file_lines(
    host: &str,
    port: u16,
    username: Option<&str>,
    options: &RdpConnectOptions,
    prompt_for_credentials: bool,
) -> Vec<String> {
    let performance = options.performance();
    let screen_mode = if options.fullscreen() { 2 } else { 1 };
    let audio_mode = match options.audio_mode() {
        "remote" => 1,
        "disabled" => 2,
        _ => 0,
    };
    let authentication_level = if options.certificate_mode() == "strict" { 2 } else { 0 };
    let mut lines = vec![
        format!("screen mode id:i:{screen_mode}"),
        format!("use multimon:i:{}", if options.multimon() { 1 } else { 0 }),
        format!("desktopwidth:i:{}", options.width()),
        format!("desktopheight:i:{}", options.height()),
        "session bpp:i:32".to_string(),
        "compression:i:1".to_string(),
        format!(
            "disable wallpaper:i:{}",
            if performance.wallpaper() { 0 } else { 1 }
        ),
        format!(
            "disable full window drag:i:{}",
            if performance.full_window_drag() { 0 } else { 1 }
        ),
        format!(
            "disable menu anims:i:{}",
            if performance.menu_animations() { 0 } else { 1 }
        ),
        format!(
            "disable themes:i:{}",
            if performance.theming() { 0 } else { 1 }
        ),
        format!(
            "disable cursor settings:i:{}",
            if performance.cursor_settings() { 0 } else { 1 }
        ),
        format!(
            "allow font smoothing:i:{}",
            if performance.font_smoothing() { 1 } else { 0 }
        ),
        format!(
            "allow desktop composition:i:{}",
            if performance.desktop_composition() { 1 } else { 0 }
        ),
        format!(
            "prompt for credentials:i:{}",
            if prompt_for_credentials { 1 } else { 0 }
        ),
        "promptcredentialonce:i:1".to_string(),
        format!("authentication level:i:{authentication_level}"),
        "enablecredsspsupport:i:1".to_string(),
        format!(
            "redirectclipboard:i:{}",
            if options.clipboard() { 1 } else { 0 }
        ),
        format!("audiomode:i:{audio_mode}"),
        format!("full address:s:{host}:{port}"),
    ];

    if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
        lines.push(format!("username:s:{}", username.trim()));
    }

    lines
}

fn spawn_with_args(command: &str, args: &[String]) -> io::Result<Child> {
    Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
}

fn spawn_path_with_args(command: &Path, args: &[String], current_dir: Option<&Path>) -> io::Result<Child> {
    let mut process = Command::new(command);
    process
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if let Some(dir) = current_dir {
        process.current_dir(dir);
    }

    process.spawn()
}

fn preview_command(command: &str, args: &[String]) -> String {
    let rendered_args = args
        .iter()
        .map(|arg| {
            if arg.chars().any(char::is_whitespace) {
                format!("{arg:?}")
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    if rendered_args.is_empty() {
        command.to_string()
    } else {
        format!("{command} {rendered_args}")
    }
}

fn clear_windows_credentials(_target: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("cmdkey")
            .arg(format!("/delete:{_target}"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

fn reap_finished_internal_viewers(manager: &mut RdpManager) {
    let finished = manager
        .internal_viewers
        .iter_mut()
        .filter_map(|(id, child)| match child.try_wait() {
            Ok(Some(_)) => Some(id.clone()),
            Ok(None) => None,
            Err(_) => Some(id.clone()),
        })
        .collect::<Vec<_>>();

    for id in finished {
        if let Some(mut child) = manager.internal_viewers.remove(&id) {
            let _ = child.wait();
        }
    }
}

fn sanitize_internal_viewer_preview_args(args: &[String]) -> Vec<String> {
    let mut sanitized = Vec::with_capacity(args.len());
    let mut hide_next = false;

    for arg in args {
        if hide_next {
            sanitized.push("<hidden>".to_string());
            hide_next = false;
            continue;
        }

        if arg == "--password" || arg == "-p" {
            sanitized.push(arg.clone());
            hide_next = true;
            continue;
        }

        sanitized.push(arg.clone());
    }

    sanitized
}

fn workspace_root() -> Option<PathBuf> {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().map(Path::to_path_buf)
}

fn internal_viewer_manifest_path() -> Option<PathBuf> {
    workspace_root().map(|root| root.join("experiments/internal-rdp-client/Cargo.toml"))
}

fn internal_viewer_binary_candidates() -> Vec<PathBuf> {
    let Some(root) = workspace_root() else {
        return Vec::new();
    };
    let bin_name = if cfg!(target_os = "windows") {
        "viewer_mvp.exe"
    } else {
        "viewer_mvp"
    };

    vec![
        root.join("experiments/internal-rdp-client/target/debug").join(bin_name),
        root.join("experiments/internal-rdp-client/target/release").join(bin_name),
    ]
}

fn bundled_internal_viewer_path(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let bin_name = if cfg!(target_os = "windows") {
        "viewer_mvp.exe"
    } else {
        "viewer_mvp"
    };
    let path = resource_dir.join("internal-rdp-client").join(bin_name);
    path.exists().then_some(path)
}

fn launch_internal_rdp_viewer(
    app: &AppHandle,
    state: &AppState,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    options: &RdpConnectOptions,
) -> Result<InternalViewerLaunchOutcome, String> {
    let trimmed_username = username.trim();
    let trimmed_password = password.trim();

    if trimmed_username.is_empty() {
        return Err("O viewer RDP interno experimental exige um usuário preenchido.".to_string());
    }

    if trimmed_password.is_empty() {
        return Err("O viewer RDP interno experimental exige uma senha disponível na conexão ou credencial salva.".to_string());
    }

    let settings_source = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        let path = storage::internal_rdp_settings_path(&storage.data_dir);
        path.exists().then(|| path)
    };

    let mut viewer_args = vec![
        "--host".to_string(),
        host.to_string(),
        "--port".to_string(),
        port.to_string(),
        "--username".to_string(),
        trimmed_username.to_string(),
        "--password".to_string(),
        trimmed_password.to_string(),
        if options.fullscreen() {
            "--fullscreen".to_string()
        } else {
            "--windowed".to_string()
        },
        "--width".to_string(),
        options.width().to_string(),
        "--height".to_string(),
        options.height().to_string(),
    ];

    if let Some(settings_path) = settings_source.as_ref() {
        viewer_args.splice(
            0..0,
            ["--settings-file".to_string(), settings_path.to_string_lossy().to_string()],
        );
    }

    let preview_args = sanitize_internal_viewer_preview_args(&viewer_args);

    if let Some(candidate) = bundled_internal_viewer_path(app) {
        let child = spawn_path_with_args(&candidate, &viewer_args, None)
            .map_err(|e| format!("Falha ao iniciar viewer interno empacotado em {}: {e}", candidate.display()))?;

        return Ok(InternalViewerLaunchOutcome {
            child,
            launcher_name: "viewer_mvp".to_string(),
            executable: candidate.to_string_lossy().to_string(),
            arguments_preview: preview_command(&candidate.to_string_lossy(), &preview_args),
            message: "Viewer RDP interno experimental iniciado a partir do binário empacotado com o app.".to_string(),
            settings_source: settings_source.map(|path| path.to_string_lossy().to_string()),
        });
    }

    for candidate in internal_viewer_binary_candidates() {
        if !candidate.exists() {
            continue;
        }

        let child = spawn_path_with_args(&candidate, &viewer_args, workspace_root().as_deref())
            .map_err(|e| format!("Falha ao iniciar viewer interno em {}: {e}", candidate.display()))?;

        return Ok(InternalViewerLaunchOutcome {
            child,
            launcher_name: "viewer_mvp".to_string(),
            executable: candidate.to_string_lossy().to_string(),
            arguments_preview: preview_command(&candidate.to_string_lossy(), &preview_args),
            message: "Viewer RDP interno experimental iniciado a partir do binário local do protótipo.".to_string(),
            settings_source: settings_source.map(|path| path.to_string_lossy().to_string()),
        });
    }

    let manifest_path = internal_viewer_manifest_path()
        .filter(|path| path.exists())
        .ok_or(
            "O protótipo do viewer RDP interno não foi encontrado neste ambiente. Esta ação experimental só funciona dentro do workspace de desenvolvimento."
                .to_string(),
        )?;

    let mut cargo_args = vec![
        "run".to_string(),
        "--manifest-path".to_string(),
        manifest_path.to_string_lossy().to_string(),
        "--bin".to_string(),
        "viewer_mvp".to_string(),
        "--".to_string(),
    ];
    cargo_args.extend(viewer_args);

    let preview_cargo_args = sanitize_internal_viewer_preview_args(&cargo_args);
    let child = spawn_with_args("cargo", &cargo_args)
        .map_err(|e| format!("Falha ao iniciar cargo run para o viewer interno: {e}"))?;

    Ok(InternalViewerLaunchOutcome {
        child,
        launcher_name: "cargo run".to_string(),
        executable: "cargo".to_string(),
        arguments_preview: preview_command("cargo", &preview_cargo_args),
        message: "Viewer RDP interno experimental iniciado via cargo run no workspace local.".to_string(),
        settings_source: settings_source.map(|path| path.to_string_lossy().to_string()),
    })
}

#[cfg(target_os = "windows")]
fn store_windows_credentials(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> Result<String, String> {
    let target = if port == 3389 {
        format!("TERMSRV/{host}")
    } else {
        format!("TERMSRV/{host}:{port}")
    };

    clear_windows_credentials(&target);

    let status = Command::new("cmdkey")
        .arg(format!("/generic:{target}"))
        .arg(format!("/user:{username}"))
        .arg(format!("/pass:{password}"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| format!("Falha ao executar cmdkey: {e}"))?;

    if status.success() {
        Ok(target)
    } else {
        Err(format!("cmdkey retornou código {:?}", status.code()))
    }
}

fn spawn_linux_client(
    command: &str,
    args: &[String],
    preview_args: &[String],
    password_handled: bool,
    credential_mode: &str,
    message: String,
) -> Result<LaunchOutcome, String> {
    let child = spawn_with_args(command, args).map_err(|e| {
        if e.kind() == io::ErrorKind::NotFound {
            "__NOT_FOUND__".to_string()
        } else {
            e.to_string()
        }
    })?;

    Ok(LaunchOutcome {
        child: Some(child),
        launcher_name: command.to_string(),
        executable: command.to_string(),
        arguments_preview: preview_command(command, preview_args),
        password_handled,
        credential_mode: credential_mode.to_string(),
        message,
        cmdkey_target: None,
    })
}

fn spawn_linux_client_aliases(
    commands: &[&str],
    args: &[String],
    preview_args: &[String],
    password_handled: bool,
    credential_mode: &str,
    success_message: impl Fn(&str) -> String,
) -> Result<LaunchOutcome, String> {
    for command in commands {
        match spawn_linux_client(
            command,
            args,
            preview_args,
            password_handled,
            credential_mode,
            success_message(command),
        ) {
            Ok(result) => return Ok(result),
            Err(err) if err.starts_with("__NOT_FOUND__") => continue,
            Err(err) => return Err(err),
        }
    }

    Err("__NOT_FOUND__".to_string())
}

fn build_freerdp_args(
    host: &str,
    port: u16,
    username: Option<&str>,
    password: Option<&str>,
    options: &RdpConnectOptions,
) -> Vec<String> {
    let performance = options.performance();
    let mut freerdp_args = vec![
        format!("/v:{host}:{port}"),
        "+auto-reconnect".to_string(),
    ];
    if options.certificate_mode() == "ignore" {
        freerdp_args.push("/cert:ignore".to_string());
    }
    if options.dynamic_resolution() {
        freerdp_args.push("/dynamic-resolution".to_string());
    }
    if options.fullscreen() {
        freerdp_args.push("/f".to_string());
    } else {
        freerdp_args.push(format!("/size:{}x{}", options.width(), options.height()));
    }
    if options.multimon() {
        freerdp_args.push("/multimon".to_string());
    }
    freerdp_args.push(if options.clipboard() {
        "+clipboard".to_string()
    } else {
        "-clipboard".to_string()
    });
    freerdp_args.push(if performance.wallpaper() {
        "+wallpaper".to_string()
    } else {
        "-wallpaper".to_string()
    });
    freerdp_args.push(if performance.full_window_drag() {
        "+window-drag".to_string()
    } else {
        "-window-drag".to_string()
    });
    freerdp_args.push(if performance.menu_animations() {
        "+menu-anims".to_string()
    } else {
        "-menu-anims".to_string()
    });
    freerdp_args.push(if performance.theming() {
        "+themes".to_string()
    } else {
        "-themes".to_string()
    });
    freerdp_args.push(if performance.font_smoothing() {
        "+fonts".to_string()
    } else {
        "-fonts".to_string()
    });
    freerdp_args.push(if performance.desktop_composition() {
        "+aero".to_string()
    } else {
        "-aero".to_string()
    });
    match options.audio_mode() {
        "remote" => freerdp_args.push("/audio-mode:1".to_string()),
        "disabled" => freerdp_args.push("/audio-mode:2".to_string()),
        _ => {
            freerdp_args.push("/audio-mode:0".to_string());
            freerdp_args.push("/sound".to_string());
        }
    }
    if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
        freerdp_args.push(format!("/u:{}", username.trim()));
    }
    if let Some(password) = password.filter(|value| !value.trim().is_empty()) {
        freerdp_args.push(format!("/p:{password}"));
    }

    freerdp_args
}

fn build_freerdp_preview_args(args: &[String]) -> Vec<String> {
    args.iter()
        .map(|arg| {
            if arg.starts_with("/p:") {
                "/p:<hidden>".to_string()
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
}

fn launch_rdp_client(
    _rdp_file: &Path,
    host: &str,
    port: u16,
    username: Option<&str>,
    password: Option<&str>,
    options: &RdpConnectOptions,
) -> Result<LaunchOutcome, String> {
    cfg_if! {
        if #[cfg(target_os = "windows")] {
            let mstsc_args = vec![_rdp_file.to_string_lossy().to_string()];
            let username = username.unwrap_or("").trim();
            let password = password.unwrap_or("").trim();
            let cmdkey_target = if !username.is_empty() && !password.is_empty() {
                Some(store_windows_credentials(host, port, username, password)?)
            } else {
                None
            };

            let child = spawn_with_args("mstsc", &mstsc_args)
                .map_err(|e| format!("Falha ao iniciar mstsc: {e}"))?;
            let (password_handled, credential_mode, message) = if cmdkey_target.is_some() {
                (
                    true,
                    "cmdkey + mstsc".to_string(),
                    "Cliente mstsc iniciado com credenciais preparadas via cmdkey.".to_string(),
                )
            } else {
                (
                    false,
                    "prompt do Windows".to_string(),
                    "Cliente mstsc iniciado com arquivo .rdp temporário. O Windows pode solicitar as credenciais.".to_string(),
                )
            };
            Ok(LaunchOutcome {
                child: Some(child),
                launcher_name: "mstsc".to_string(),
                executable: "mstsc".to_string(),
                arguments_preview: preview_command("mstsc", &mstsc_args),
                password_handled,
                credential_mode,
                message,
                cmdkey_target,
            })
        } else if #[cfg(target_os = "macos")] {
            let args = vec![_rdp_file.to_string_lossy().to_string()];
            let _ = spawn_with_args("open", &args)
                .map_err(|e| format!("Falha ao abrir cliente RDP padrão: {e}"))?;
            let password_is_set = !password.unwrap_or("").trim().is_empty();
            let message = if password_is_set {
                "Arquivo .rdp aberto no cliente padrão do sistema. A senha poderá ser solicitada pelo aplicativo externo.".to_string()
            } else {
                "Arquivo .rdp aberto no cliente padrão do sistema.".to_string()
            };
            Ok(LaunchOutcome {
                child: None,
                launcher_name: "open".to_string(),
                executable: "open".to_string(),
                arguments_preview: preview_command("open", &args),
                password_handled: false,
                credential_mode: if password_is_set {
                    "cliente externo".to_string()
                } else {
                    "prompt do cliente".to_string()
                },
                message,
                cmdkey_target: None,
            })
        } else {
            let freerdp_args = build_freerdp_args(host, port, username, password, options);
            let freerdp_preview_args = build_freerdp_preview_args(&freerdp_args);

            let uri = if let Some(username) = username.filter(|value| !value.trim().is_empty()) {
                format!("rdp://{}@{}:{}", username.trim(), host, port)
            } else {
                format!("rdp://{}:{}", host, port)
            };
            let remmina_args = vec!["-c".to_string(), uri.clone()];
            let krdc_args = vec![uri];

            let password_is_set = !password.unwrap_or("").trim().is_empty();
            let preferred_linux_client = options.preferred_linux_client();

            let all_clients = ["xfreerdp", "wlfreerdp", "remmina", "krdc"];
            let ordered_clients = if preferred_linux_client != "auto" {
                vec![preferred_linux_client]
            } else {
                all_clients.to_vec()
            };

            let mut last_error: Option<String> = None;

            for client in ordered_clients {
                let result = match client {
                    "xfreerdp" => spawn_linux_client_aliases(
                        &["xfreerdp3", "xfreerdp"],
                        &freerdp_args,
                        &freerdp_preview_args,
                        password_is_set,
                        if password_is_set { "credenciais via FreeRDP" } else { "prompt do cliente" },
                        |command| {
                            if password_is_set {
                                format!("Cliente {command} iniciado com credenciais fornecidas.")
                            } else {
                                format!("Cliente {command} iniciado. O cliente pode solicitar a senha ou usar credenciais salvas.")
                            }
                        },
                    ),
                    "wlfreerdp" => spawn_linux_client_aliases(
                        &["wlfreerdp3", "wlfreerdp"],
                        &freerdp_args,
                        &freerdp_preview_args,
                        password_is_set,
                        if password_is_set { "credenciais via FreeRDP" } else { "prompt do cliente" },
                        |command| {
                            if password_is_set {
                                format!("Cliente {command} iniciado com credenciais fornecidas.")
                            } else {
                                format!("Cliente {command} iniciado. O cliente pode solicitar a senha ou usar credenciais salvas.")
                            }
                        },
                    ),
                    "remmina" => spawn_linux_client(
                        "remmina",
                        &remmina_args,
                        &remmina_args,
                        false,
                        "cliente externo",
                        "Cliente remmina iniciado. A senha pode ser solicitada pelo aplicativo externo.".to_string(),
                    ),
                    "krdc" => spawn_linux_client(
                        "krdc",
                        &krdc_args,
                        &krdc_args,
                        false,
                        "cliente externo",
                        "Cliente KRDC iniciado. A senha pode ser solicitada pelo aplicativo externo.".to_string(),
                    ),
                    _ => continue,
                };

                match result {
                    Ok(result) => return Ok(result),
                    Err(err) if err.starts_with("__NOT_FOUND__") => {
                        if preferred_linux_client != "auto" {
                            last_error = Some(format!(
                                "O cliente RDP selecionado ({client}) não está instalado neste sistema."
                            ));
                            break;
                        }
                        continue;
                    }
                    Err(err) => {
                        last_error = Some(format!("Falha ao iniciar {client}: {err}"));
                        break;
                    }
                }
            }

            if let Some(err) = last_error {
                Err(err)
            } else {
                Err(
                    "Nenhum cliente RDP suportado foi encontrado. Instale `xfreerdp`, `wlfreerdp`, `remmina` ou `krdc`.".to_string()
                )
            }
        }
    }
}

#[tauri::command]
pub async fn rdp_connect(
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    options: Option<RdpConnectOptions>,
    title: Option<String>,
) -> Result<RdpLaunchResult, String> {
    state
        .rate_limiter
        .check("rdp_connect", 10, std::time::Duration::from_secs(60))?;

    let options = options.unwrap_or_default();

    {
        let mut manager = state.rdp.lock().await;
        if let Some(mut existing) = manager.sessions.remove(&session_id) {
            cleanup_session(&mut existing);
        }
        if let Some(mut existing) = manager.internal_viewers.remove(&session_id) {
            let _ = existing.kill();
            let _ = existing.wait();
        }
    }

    let rdp_dir = ensure_rdp_dir(&state)?;
    let file_name = format!(
        "{}-{}.rdp",
        title.unwrap_or_else(|| "rdp".to_string()).replace(' ', "_"),
        session_id
    );
    let temp_file = rdp_dir.join(file_name);

    let prompt_for_credentials = password
        .as_deref()
        .map(|value| value.trim().is_empty())
        .unwrap_or(true);

    write_rdp_file(
        &temp_file,
        &host,
        port,
        username.as_deref(),
        &options,
        prompt_for_credentials,
    )?;

    let launch = match launch_rdp_client(
        &temp_file,
        &host,
        port,
        username.as_deref(),
        password.as_deref(),
        &options,
    ) {
        Ok(result) => result,
        Err(err) => {
            let _ = fs::remove_file(&temp_file);
            return Err(err);
        }
    };

    let mut manager = state.rdp.lock().await;
    manager.sessions.insert(
        session_id,
        RdpSession {
            temp_file,
            child: launch.child,
            cmdkey_target: launch.cmdkey_target,
        },
    );

    Ok(RdpLaunchResult {
        launcher_name: launch.launcher_name,
        executable: launch.executable,
        arguments_preview: launch.arguments_preview,
        password_handled: launch.password_handled,
        credential_mode: launch.credential_mode,
        message: launch.message,
    })
}

#[tauri::command]
pub async fn rdp_launch_internal_viewer(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    username: Option<String>,
    password: Option<String>,
    options: Option<RdpConnectOptions>,
) -> Result<InternalRdpViewerLaunchResult, String> {
    state
        .rate_limiter
        .check("rdp_launch_internal_viewer", 20, std::time::Duration::from_secs(60))?;

    let options = options.unwrap_or_default();

    let launch = launch_internal_rdp_viewer(
        &app,
        &state,
        &host,
        port,
        username.as_deref().unwrap_or(""),
        password.as_deref().unwrap_or(""),
        &options,
    )?;

    let mut manager = state.rdp.lock().await;
    reap_finished_internal_viewers(&mut manager);
    if let Some(mut existing) = manager.sessions.remove(&session_id) {
        cleanup_session(&mut existing);
    }
    if let Some(mut existing) = manager.internal_viewers.remove(&session_id) {
        let _ = existing.kill();
        let _ = existing.wait();
    }
    manager
        .internal_viewers
        .insert(session_id, launch.child);

    Ok(InternalRdpViewerLaunchResult {
        launcher_name: launch.launcher_name,
        executable: launch.executable,
        arguments_preview: launch.arguments_preview,
        message: launch.message,
        settings_source: launch.settings_source,
    })
}

#[tauri::command]
pub async fn rdp_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = state.rdp.lock().await;
    if let Some(mut session) = manager.sessions.remove(&session_id) {
        cleanup_session(&mut session);
    }
    if let Some(mut child) = manager.internal_viewers.remove(&session_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
pub async fn rdp_session_exists(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    let mut manager = state.rdp.lock().await;
    if let Some(session) = manager.sessions.get_mut(&session_id) {
        if let Some(child) = session.child.as_mut() {
            return match child.try_wait() {
                Ok(Some(_)) => {
                    let mut finished = manager.sessions.remove(&session_id).unwrap();
                    cleanup_session(&mut finished);
                    Ok(false)
                }
                Ok(None) => Ok(true),
                Err(e) => Err(format!("Falha ao consultar processo RDP: {e}")),
            };
        }

        return Ok(true);
    }

    if let Some(child) = manager.internal_viewers.get_mut(&session_id) {
        return match child.try_wait() {
            Ok(Some(_)) => {
                let mut finished = manager.internal_viewers.remove(&session_id).unwrap();
                let _ = finished.wait();
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(e) => Err(format!("Falha ao consultar viewer RDP interno: {e}")),
        }
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn full_options() -> RdpConnectOptions {
        RdpConnectOptions {
            preferred_linux_client: Some("xfreerdp".to_string()),
            fullscreen: Some(false),
            dynamic_resolution: Some(true),
            width: Some(1920),
            height: Some(1080),
            multimon: Some(true),
            clipboard: Some(false),
            audio_mode: Some("disabled".to_string()),
            certificate_mode: Some("strict".to_string()),
            internal_client_performance: Some(RdpPerformanceOptions {
                wallpaper: Some(true),
                full_window_drag: Some(true),
                menu_animations: Some(false),
                theming: Some(true),
                cursor_settings: Some(false),
                font_smoothing: Some(true),
                desktop_composition: Some(false),
            }),
        }
    }

    #[test]
    fn rdp_file_lines_include_visual_preferences_and_credentials_prompt() {
        let lines = build_rdp_file_lines(
            "192.168.0.218",
            3389,
            Some("fernando"),
            &full_options(),
            true,
        );

        assert!(lines.contains(&"screen mode id:i:1".to_string()));
        assert!(lines.contains(&"desktopwidth:i:1920".to_string()));
        assert!(lines.contains(&"desktopheight:i:1080".to_string()));
        assert!(lines.contains(&"disable wallpaper:i:0".to_string()));
        assert!(lines.contains(&"disable full window drag:i:0".to_string()));
        assert!(lines.contains(&"disable menu anims:i:1".to_string()));
        assert!(lines.contains(&"disable themes:i:0".to_string()));
        assert!(lines.contains(&"disable cursor settings:i:1".to_string()));
        assert!(lines.contains(&"allow font smoothing:i:1".to_string()));
        assert!(lines.contains(&"allow desktop composition:i:0".to_string()));
        assert!(lines.contains(&"prompt for credentials:i:1".to_string()));
        assert!(lines.contains(&"authentication level:i:2".to_string()));
        assert!(lines.contains(&"redirectclipboard:i:0".to_string()));
        assert!(lines.contains(&"audiomode:i:2".to_string()));
        assert!(lines.contains(&"username:s:fernando".to_string()));
    }

    #[test]
    fn rdp_file_lines_use_fullscreen_mode_when_enabled() {
        let mut options = full_options();
        options.fullscreen = Some(true);

        let lines = build_rdp_file_lines("host.local", 3390, None, &options, false);

        assert!(lines.contains(&"screen mode id:i:2".to_string()));
        assert!(lines.contains(&"prompt for credentials:i:0".to_string()));
        assert!(!lines.iter().any(|line| line.starts_with("username:s:")));
    }

    #[test]
    fn freerdp_args_include_display_audio_and_visual_flags() {
        let args = build_freerdp_args(
            "192.168.0.218",
            3389,
            Some("fernando"),
            Some("secret"),
            &full_options(),
        );

        assert!(args.contains(&"/v:192.168.0.218:3389".to_string()));
        assert!(args.contains(&"/dynamic-resolution".to_string()));
        assert!(args.contains(&"/size:1920x1080".to_string()));
        assert!(args.contains(&"/multimon".to_string()));
        assert!(args.contains(&"-clipboard".to_string()));
        assert!(args.contains(&"+wallpaper".to_string()));
        assert!(args.contains(&"+window-drag".to_string()));
        assert!(args.contains(&"-menu-anims".to_string()));
        assert!(args.contains(&"+themes".to_string()));
        assert!(args.contains(&"+fonts".to_string()));
        assert!(args.contains(&"-aero".to_string()));
        assert!(args.contains(&"/audio-mode:2".to_string()));
        assert!(args.contains(&"/u:fernando".to_string()));
        assert!(args.contains(&"/p:secret".to_string()));
    }

    #[test]
    fn freerdp_args_switch_to_fullscreen_and_sound_redirect_defaults() {
        let mut options = RdpConnectOptions::default();
        options.fullscreen = Some(true);
        options.audio_mode = Some("redirect".to_string());

        let args = build_freerdp_args("host.local", 3389, None, None, &options);

        assert!(args.contains(&"/f".to_string()));
        assert!(!args.iter().any(|arg| arg.starts_with("/size:")));
        assert!(args.contains(&"/audio-mode:0".to_string()));
        assert!(args.contains(&"/sound".to_string()));
    }

    #[test]
    fn freerdp_preview_hides_password_argument() {
        let args = vec![
            "/v:host:3389".to_string(),
            "/u:fernando".to_string(),
            "/p:secret".to_string(),
        ];

        let preview = build_freerdp_preview_args(&args);

        assert_eq!(preview[2], "/p:<hidden>");
    }

    #[test]
    fn connect_options_clamp_dimensions() {
        let options = RdpConnectOptions {
            width: Some(12),
            height: Some(99999),
            ..RdpConnectOptions::default()
        };

        assert_eq!(options.width(), 640);
        assert_eq!(options.height(), 4320);
    }
}
