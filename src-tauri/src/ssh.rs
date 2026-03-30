use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use cfg_if::cfg_if;
use russh::client;
use russh::ChannelMsg;
use russh_keys::agent::client::AgentClient;
use russh_keys::key::PublicKey;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;

// ─── Eventos emitidos ao frontend ─────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct SshOutputEvent {
    pub tab_id: String,
    pub data: String, // base64
}

#[derive(Clone, Serialize)]
pub struct SshStatusEvent {
    pub tab_id: String,
    pub status: String,
    pub message: Option<String>,
}

// ─── Comandos internos para a task SSH ───────────────────────────────────────

enum SshCommand {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

// ─── Sessão ativa ─────────────────────────────────────────────────────────────

struct LiveSession {
    tx: mpsc::Sender<SshCommand>,
}

// ─── Gerenciador de sessões ───────────────────────────────────────────────────

pub struct SshManager {
    sessions: HashMap<String, LiveSession>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

// ─── Handler russh ────────────────────────────────────────────────────────────

struct ClientHandler;

#[async_trait]
impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // TODO fase 3: verificar known_hosts
        Ok(true)
    }
}

// ─── Auth por agente (genérico sobre o tipo de stream) ───────────────────────

async fn try_agent_auth<S>(
    session: &mut client::Handle<ClientHandler>,
    username: &str,
    agent: AgentClient<S>,
) -> Result<bool, String>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let mut agent = agent;

    let identities: Vec<PublicKey> = agent
        .request_identities()
        .await
        .map_err(|e| e.to_string())?;

    if identities.is_empty() {
        return Err(
            "O agente SSH não possui identidades carregadas.\n\
             Execute: ssh-add ~/.ssh/id_rsa  (ou o caminho da sua chave)"
                .into(),
        );
    }

    for identity in identities {
        let (returned_agent, result) =
            session.authenticate_future(username, identity, agent).await;
        agent = returned_agent;
        match result {
            Ok(true) => return Ok(true),
            Ok(false) => continue,
            Err(e) => return Err(e.to_string()),
        }
    }

    Ok(false)
}

// ─── Comandos Tauri ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_connect(
    state: tauri::State<'_, crate::AppState>,
    app: AppHandle,
    tab_id: String,
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    private_key_content: Option<String>,
    private_key_passphrase: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let _ = app.emit(
        "ssh-status",
        SshStatusEvent {
            tab_id: tab_id.clone(),
            status: "connecting".into(),
            message: None,
        },
    );

    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);
    let mut session = client::connect(config, addr, ClientHandler)
        .await
        .map_err(|e| e.to_string())?;

    let ok = match auth_method.as_str() {
        "password" => {
            let pwd = password.ok_or("Senha não informada")?;
            session
                .authenticate_password(&username, pwd)
                .await
                .map_err(|e| e.to_string())?
        }

        "privateKey" => {
            let content = private_key_content.ok_or("Conteúdo da chave privada não informado")?;
            let key =
                russh_keys::decode_secret_key(&content, private_key_passphrase.as_deref())
                    .map_err(|e| format!("Falha ao decodificar a chave privada: {e}"))?;
            session
                .authenticate_publickey(&username, Arc::new(key))
                .await
                .map_err(|e| e.to_string())?
        }

        "agent" => {
            cfg_if! {
                if #[cfg(unix)] {
                    // Linux / macOS — conecta via SSH_AUTH_SOCK (Unix socket)
                    let agent = AgentClient::connect_env()
                        .await
                        .map_err(|_| {
                            "Não foi possível conectar ao agente SSH.\n\
                             Verifique se o ssh-agent está rodando e SSH_AUTH_SOCK está definido.\n\
                             Dica: eval $(ssh-agent) && ssh-add ~/.ssh/id_rsa".to_string()
                        })?;
                    try_agent_auth(&mut session, &username, agent).await?
                } else if #[cfg(windows)] {
                    // Windows 10+ — OpenSSH Agent via named pipe
                    use tokio::net::windows::named_pipe::ClientOptions;
                    let stream = ClientOptions::new()
                        .open(r"\\.\pipe\openssh-ssh-agent")
                        .map_err(|_| {
                            "Agente OpenSSH não encontrado.\n\
                             Ative o serviço 'OpenSSH Authentication Agent' no Windows:\n\
                             Serviços → OpenSSH Authentication Agent → Tipo de inicialização: Automático → Iniciar".to_string()
                        })?;
                    let agent = AgentClient::connect(stream);
                    try_agent_auth(&mut session, &username, agent).await?
                } else {
                    return Err("Agente SSH não suportado nesta plataforma.".into());
                }
            }
        }

        _ => return Err(format!("Método de autenticação desconhecido: {auth_method}")),
    };

    if !ok {
        let _ = app.emit(
            "ssh-status",
            SshStatusEvent {
                tab_id: tab_id.clone(),
                status: "error".into(),
                message: Some("Autenticação falhou. Verifique as credenciais.".into()),
            },
        );
        return Err("Autenticação falhou".into());
    }

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| e.to_string())?;

    channel
        .request_pty(
            false,
            "xterm-256color",
            cols as u32,
            rows as u32,
            0,
            0,
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;

    channel
        .request_shell(false)
        .await
        .map_err(|e| e.to_string())?;

    let (tx, mut rx) = mpsc::channel::<SshCommand>(64);

    {
        let mut mgr = state.ssh.lock().await;
        mgr.sessions.insert(tab_id.clone(), LiveSession { tx });
    }

    let _ = app.emit(
        "ssh-status",
        SshStatusEvent {
            tab_id: tab_id.clone(),
            status: "connected".into(),
            message: None,
        },
    );

    let app_task = app.clone();
    let tab_id_task = tab_id.clone();
    let ssh_arc = Arc::clone(&state.ssh);

    tokio::spawn(async move {
        loop {
            tokio::select! {
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { ref data }) |
                        Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                            let _ = app_task.emit("ssh-output", SshOutputEvent {
                                tab_id: tab_id_task.clone(),
                                data: B64.encode(data.as_ref()),
                            });
                        }
                        Some(ChannelMsg::ExitStatus { .. })
                        | Some(ChannelMsg::Close)
                        | None => break,
                        _ => {}
                    }
                }
                cmd = rx.recv() => {
                    match cmd {
                        Some(SshCommand::Data(bytes)) => {
                            let _ = channel.data(bytes.as_ref()).await;
                        }
                        Some(SshCommand::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await;
                        }
                        Some(SshCommand::Disconnect) | None => {
                            let _ = channel.close().await;
                            break;
                        }
                    }
                }
            }
        }

        ssh_arc.lock().await.sessions.remove(&tab_id_task);
        let _ = app_task.emit(
            "ssh-status",
            SshStatusEvent {
                tab_id: tab_id_task,
                status: "disconnected".into(),
                message: None,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn ssh_send_input(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let mgr = state.ssh.lock().await;
    if let Some(session) = mgr.sessions.get(&tab_id) {
        session
            .tx
            .send(SshCommand::Data(data.into_bytes()))
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_resize(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let mgr = state.ssh.lock().await;
    if let Some(session) = mgr.sessions.get(&tab_id) {
        session
            .tx
            .send(SshCommand::Resize { cols, rows })
            .await
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ssh_disconnect(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
) -> Result<(), String> {
    let mgr = state.ssh.lock().await;
    if let Some(session) = mgr.sessions.get(&tab_id) {
        let _ = session.tx.send(SshCommand::Disconnect).await;
    }
    Ok(())
}
