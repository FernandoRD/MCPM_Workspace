use std::collections::HashMap;
use std::io;
use std::process::{Child, Command, Stdio};

use cfg_if::cfg_if;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

struct VncSession {
    child: Option<Child>,
}

pub struct VncManager {
    sessions: HashMap<String, VncSession>,
}

impl VncManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VncLaunchResult {
    launcher_name: String,
    executable: String,
    arguments_preview: String,
    password_handled: bool,
    credential_mode: String,
    message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VncConnectOptions {
    preferred_linux_client: Option<String>,
    fullscreen: Option<bool>,
    view_only: Option<bool>,
}

impl Default for VncConnectOptions {
    fn default() -> Self {
        Self {
            preferred_linux_client: Some("auto".to_string()),
            fullscreen: Some(false),
            view_only: Some(false),
        }
    }
}

impl VncConnectOptions {
    fn preferred_linux_client(&self) -> &str {
        self.preferred_linux_client.as_deref().unwrap_or("auto")
    }

    fn fullscreen(&self) -> bool {
        self.fullscreen.unwrap_or(false)
    }

    fn view_only(&self) -> bool {
        self.view_only.unwrap_or(false)
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

fn build_vnc_uri(host: &str, port: u16) -> String {
    format!("vnc://{host}:{port}")
}

fn build_vncviewer_target(host: &str, port: u16) -> String {
    format!("{host}::{port}")
}

fn build_vncviewer_args(host: &str, port: u16, options: &VncConnectOptions) -> Vec<String> {
    let mut args = vec![build_vncviewer_target(host, port)];

    if options.fullscreen() {
        args.push("-FullScreen".to_string());
    }

    if options.view_only() {
        args.push("-ViewOnly".to_string());
    }

    args
}

fn cleanup_session(session: &mut VncSession) {
    if let Some(child) = session.child.as_mut() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn spawn_linux_client(
    command: &str,
    args: &[String],
    preview_args: &[String],
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
        password_handled: false,
        credential_mode: "prompt do cliente".to_string(),
        message,
    })
}

fn spawn_linux_client_aliases(
    commands: &[&str],
    args: &[String],
    preview_args: &[String],
    success_message: impl Fn(&str) -> String,
) -> Result<LaunchOutcome, String> {
    for command in commands {
        match spawn_linux_client(command, args, preview_args, success_message(command)) {
            Ok(result) => return Ok(result),
            Err(err) if err.starts_with("__NOT_FOUND__") => continue,
            Err(err) => return Err(err),
        }
    }

    Err("__NOT_FOUND__".to_string())
}

fn launch_vnc_client(
    host: &str,
    port: u16,
    password_is_set: bool,
    options: &VncConnectOptions,
) -> Result<LaunchOutcome, String> {
    let uri = build_vnc_uri(host, port);
    let preferred_linux_client = options.preferred_linux_client();

    cfg_if! {
        if #[cfg(target_os = "windows")] {
            let args = vec![
                "/C".to_string(),
                "start".to_string(),
                "".to_string(),
                uri.clone(),
            ];

            let _ = spawn_with_args("cmd", &args)
                .map_err(|e| format!("Falha ao abrir o cliente VNC associado no Windows: {e}"))?;

            Ok(LaunchOutcome {
                child: None,
                launcher_name: "start".to_string(),
                executable: "cmd".to_string(),
                arguments_preview: preview_command("cmd", &args),
                password_handled: false,
                credential_mode: "cliente externo".to_string(),
                message: if password_is_set {
                    "URI VNC enviada ao cliente associado do sistema. A senha pode ser solicitada pelo aplicativo externo.".to_string()
                } else {
                    "URI VNC enviada ao cliente associado do sistema.".to_string()
                },
            })
        } else if #[cfg(target_os = "macos")] {
            let args = vec![uri.clone()];
            let _ = spawn_with_args("open", &args)
                .map_err(|e| format!("Falha ao abrir o cliente VNC padrão: {e}"))?;

            Ok(LaunchOutcome {
                child: None,
                launcher_name: "open".to_string(),
                executable: "open".to_string(),
                arguments_preview: preview_command("open", &args),
                password_handled: false,
                credential_mode: "cliente externo".to_string(),
                message: if password_is_set {
                    "URI VNC aberta no cliente padrão do sistema. A senha pode ser solicitada pelo aplicativo externo.".to_string()
                } else {
                    "URI VNC aberta no cliente padrão do sistema.".to_string()
                },
            })
        } else {
            let vncviewer_args = build_vncviewer_args(host, port, options);
            let remmina_args = vec!["-c".to_string(), uri.clone()];
            let krdc_args = vec![uri.clone()];
            let vinagre_args = vec![uri.clone()];
            let xdg_open_args = vec![uri.clone()];

            let all_clients = ["tigervnc", "remmina", "krdc", "vinagre", "system"];
            let ordered_clients = if preferred_linux_client != "auto" {
                vec![preferred_linux_client]
            } else {
                all_clients.to_vec()
            };
            let mut last_error: Option<String> = None;

            for client in ordered_clients {
                let result = match client {
                    "tigervnc" => spawn_linux_client_aliases(
                        &["xtigervncviewer", "vncviewer"],
                        &vncviewer_args,
                        &vncviewer_args,
                        |command| {
                            if password_is_set {
                                format!("Cliente {command} iniciado. A senha salva permanece disponível no app, mas o cliente pode solicitá-la novamente.")
                            } else {
                                format!("Cliente {command} iniciado.")
                            }
                        },
                    ),
                    "remmina" => spawn_linux_client(
                        "remmina",
                        &remmina_args,
                        &remmina_args,
                        "Cliente remmina iniciado. O aplicativo externo pode solicitar autenticação adicional.".to_string(),
                    ),
                    "krdc" => spawn_linux_client(
                        "krdc",
                        &krdc_args,
                        &krdc_args,
                        "Cliente KRDC iniciado. O aplicativo externo pode solicitar autenticação adicional.".to_string(),
                    ),
                    "vinagre" => spawn_linux_client(
                        "vinagre",
                        &vinagre_args,
                        &vinagre_args,
                        "Cliente Vinagre iniciado. O aplicativo externo pode solicitar autenticação adicional.".to_string(),
                    ),
                    "system" => {
                        let _ = spawn_with_args("xdg-open", &xdg_open_args).map_err(|e| {
                            if e.kind() == io::ErrorKind::NotFound {
                                "__NOT_FOUND__".to_string()
                            } else {
                                e.to_string()
                            }
                        })?;

                        Ok(LaunchOutcome {
                            child: None,
                            launcher_name: "xdg-open".to_string(),
                            executable: "xdg-open".to_string(),
                            arguments_preview: preview_command("xdg-open", &xdg_open_args),
                            password_handled: false,
                            credential_mode: "cliente externo".to_string(),
                            message: "URI VNC enviada ao cliente padrão configurado no sistema.".to_string(),
                        })
                    }
                    _ => continue,
                };

                match result {
                    Ok(result) => return Ok(result),
                    Err(err) if err.starts_with("__NOT_FOUND__") => {
                        if preferred_linux_client != "auto" {
                            last_error = Some(format!(
                                "O cliente VNC selecionado ({client}) não está instalado neste sistema."
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
                    "Nenhum cliente VNC suportado foi encontrado. Instale `TigerVNC`, `Remmina`, `KRDC`, `Vinagre` ou associe o esquema `vnc://` no sistema."
                        .to_string(),
                )
            }
        }
    }
}

#[tauri::command]
pub async fn vnc_connect(
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    password: Option<String>,
    options: Option<VncConnectOptions>,
) -> Result<VncLaunchResult, String> {
    state
        .rate_limiter
        .check("vnc_connect", 10, std::time::Duration::from_secs(60))?;

    let options = options.unwrap_or_default();

    {
        let mut manager = state.vnc.lock().await;
        if let Some(mut existing) = manager.sessions.remove(&session_id) {
            cleanup_session(&mut existing);
        }
    }

    let launch = launch_vnc_client(
        &host,
        port,
        password.as_deref().is_some_and(|value| !value.trim().is_empty()),
        &options,
    )?;

    let mut manager = state.vnc.lock().await;
    manager.sessions.insert(
        session_id,
        VncSession {
            child: launch.child,
        },
    );

    Ok(VncLaunchResult {
        launcher_name: launch.launcher_name,
        executable: launch.executable,
        arguments_preview: launch.arguments_preview,
        password_handled: launch.password_handled,
        credential_mode: launch.credential_mode,
        message: launch.message,
    })
}

#[tauri::command]
pub async fn vnc_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let mut manager = state.vnc.lock().await;
    if let Some(mut session) = manager.sessions.remove(&session_id) {
        cleanup_session(&mut session);
    }
    Ok(())
}

#[tauri::command]
pub async fn vnc_session_exists(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    let mut manager = state.vnc.lock().await;
    if let Some(session) = manager.sessions.get_mut(&session_id) {
        if let Some(child) = session.child.as_mut() {
            return match child.try_wait() {
                Ok(Some(_)) => {
                    let mut finished = manager.sessions.remove(&session_id).unwrap();
                    cleanup_session(&mut finished);
                    Ok(false)
                }
                Ok(None) => Ok(true),
                Err(e) => Err(format!("Falha ao consultar processo VNC: {e}")),
            };
        }

        return Ok(true);
    }

    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_vnc_uri_with_host_and_port() {
        assert_eq!(build_vnc_uri("192.168.1.40", 5901), "vnc://192.168.1.40:5901");
    }

    #[test]
    fn builds_vncviewer_target_using_tcp_port_syntax() {
        assert_eq!(build_vncviewer_target("server.internal", 5900), "server.internal::5900");
    }

    #[test]
    fn builds_vncviewer_args_with_fullscreen_and_view_only() {
        let options = VncConnectOptions {
            preferred_linux_client: Some("tigervnc".to_string()),
            fullscreen: Some(true),
            view_only: Some(true),
        };

        let args = build_vncviewer_args("server.internal", 5901, &options);

        assert_eq!(args[0], "server.internal::5901");
        assert!(args.contains(&"-FullScreen".to_string()));
        assert!(args.contains(&"-ViewOnly".to_string()));
    }
}
