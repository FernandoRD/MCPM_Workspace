use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

use cfg_if::cfg_if;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

struct RdpSession {
    temp_file: PathBuf,
    child: Option<Child>,
    cmdkey_target: Option<String>,
}

pub struct RdpManager {
    sessions: HashMap<String, RdpSession>,
}

impl RdpManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
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

    fs::write(path, format!("{}\n", lines.join("\n")))
        .map_err(|e| format!("Falha ao gravar arquivo temporário RDP: {e}"))
}

fn spawn_with_args(command: &str, args: &[String]) -> io::Result<Child> {
    Command::new(command)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
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
            let freerdp_preview_args = freerdp_args
                .iter()
                .map(|arg| {
                    if arg.starts_with("/p:") {
                        "/p:<hidden>".to_string()
                    } else {
                        arg.clone()
                    }
                })
                .collect::<Vec<_>>();

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
pub async fn rdp_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = state.rdp.lock().await;
    if let Some(mut session) = manager.sessions.remove(&session_id) {
        cleanup_session(&mut session);
    }
    Ok(())
}

#[tauri::command]
pub async fn rdp_session_exists(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    let mut manager = state.rdp.lock().await;
    let Some(session) = manager.sessions.get_mut(&session_id) else {
        return Ok(false);
    };

    if let Some(child) = session.child.as_mut() {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut finished = manager.sessions.remove(&session_id).unwrap();
                cleanup_session(&mut finished);
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(e) => Err(format!("Falha ao consultar processo RDP: {e}")),
        }
    } else {
        Ok(true)
    }
}
