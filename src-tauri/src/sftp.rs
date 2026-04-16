use std::collections::HashMap;
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::Arc;
use std::time::SystemTime;

use cfg_if::cfg_if;
use russh::client;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::ssh_common::{
    build_ssh_config, load_known_hosts, save_known_hosts, trim_optional_owned, trim_owned,
    KnownHostsHandler,
};
use crate::AppState;

// ─── Eventos emitidos ao frontend ─────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct SftpProgressEvent {
    pub session_id: String,
    /// "upload" | "download"
    pub operation: String,
    pub file_name: String,
    pub bytes_done: u64,
    /// 0 = desconhecido
    pub bytes_total: u64,
}

// ─── Tipos retornados ao frontend ─────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    /// Unix timestamp (segundos)
    pub modified: Option<u64>,
}

// ─── Conexão SFTP ─────────────────────────────────────────────────────────────

struct SftpConnection {
    /// Mantém a sessão SSH do host alvo viva
    _handle: client::Handle<KnownHostsHandler>,
    /// Mantém a sessão SSH do jump host viva (quando usado)
    _jump_handle: Option<client::Handle<KnownHostsHandler>>,
    sftp: SftpSession,
}

// ─── Gerenciador ──────────────────────────────────────────────────────────────

pub struct SftpManager {
    sessions: HashMap<String, Arc<Mutex<SftpConnection>>>,
}

impl SftpManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

// ─── Helper de autenticação ───────────────────────────────────────────────────

async fn authenticate(
    session: &mut client::Handle<KnownHostsHandler>,
    username: &str,
    auth_method: &str,
    password: Option<String>,
    private_key_content: Option<String>,
    private_key_passphrase: Option<String>,
) -> Result<bool, String> {
    match auth_method {
        "password" => {
            let pwd = password.ok_or("Senha não informada")?;
            session
                .authenticate_password(username, pwd)
                .await
                .map_err(|e| e.to_string())
        }
        "privateKey" => {
            let content = private_key_content.ok_or("Conteúdo da chave não informado")?;
            let key =
                russh_keys::decode_secret_key(&content, private_key_passphrase.as_deref())
                    .map_err(|e| format!("Falha ao decodificar chave: {e}"))?;
            session
                .authenticate_publickey(username, Arc::new(key))
                .await
                .map_err(|e| e.to_string())
        }
        "agent" => {
            cfg_if! {
                if #[cfg(unix)] {
                    use russh_keys::agent::client::AgentClient;
                    let mut agent = AgentClient::connect_env()
                        .await
                        .map_err(|_| "Não foi possível conectar ao agente SSH.".to_string())?;
                    let ids = agent
                        .request_identities()
                        .await
                        .map_err(|e| e.to_string())?;
                    let mut ok = false;
                    for id in ids {
                        let (returned_agent, result) =
                            session.authenticate_future(username, id, agent).await;
                        agent = returned_agent;
                        if result.unwrap_or(false) {
                            ok = true;
                            break;
                        }
                    }
                    Ok(ok)
                } else {
                    Err("Agente SSH não suportado nesta plataforma.".into())
                }
            }
        }
        _ => Err(format!("Método de autenticação desconhecido: {auth_method}")),
    }
}

// ─── Delete recursivo ─────────────────────────────────────────────────────────

fn sftp_remove_recursive<'a>(
    sftp: &'a SftpSession,
    path: &'a str,
) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + 'a>> {
    Box::pin(async move {
        let entries = sftp
            .read_dir(path)
            .await
            .map_err(|e| format!("Erro ao listar '{path}': {e}"))?;

        for entry in entries {
            let name = entry.file_name().to_string();
            if name == "." || name == ".." {
                continue;
            }
            let child = if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };
            if entry.metadata().is_dir() {
                sftp_remove_recursive(sftp, &child).await?;
            } else {
                sftp.remove_file(&child)
                    .await
                    .map_err(|e| format!("Erro ao remover '{child}': {e}"))?;
            }
        }

        sftp.remove_dir(path)
            .await
            .map_err(|e| format!("Erro ao remover diretório '{path}': {e}"))
    })
}

// ─── Comandos Tauri ───────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sftp_connect(
    state: State<'_, AppState>,
    session_id: String,
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    password: Option<String>,
    private_key_content: Option<String>,
    private_key_passphrase: Option<String>,
    ssh_compat_preset: Option<String>,
    keepalive_interval: Option<u32>,
    connection_timeout: Option<u32>,
    // Jump host (opcional)
    jump_host: Option<String>,
    jump_port: Option<u16>,
    jump_username: Option<String>,
    jump_auth_method: Option<String>,
    jump_password: Option<String>,
    jump_private_key_content: Option<String>,
    jump_private_key_passphrase: Option<String>,
) -> Result<(), String> {
    let host = trim_owned(host);
    let username = trim_owned(username);
    let jump_host = trim_optional_owned(jump_host);
    let jump_username = trim_optional_owned(jump_username);
    let data_dir = state.storage.lock().map_err(|e| e.to_string())?.data_dir.clone();
    let known_hosts_map = load_known_hosts(&data_dir);
    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let preset = ssh_compat_preset.as_deref().unwrap_or("modern");
    let keepalive = keepalive_interval.unwrap_or(0);
    let timeout = connection_timeout.unwrap_or(30);
    let config = build_ssh_config(preset, keepalive, timeout);

    // ─── Conecta ao host alvo (direto ou via jump host) ────────────────────────

    let (mut session, jump_handle) = if let Some(ref jhost) = jump_host {
        let jport = jump_port.unwrap_or(22);
        let jusername = jump_username.as_deref().unwrap_or(&username);
        let jauth = jump_auth_method.as_deref().unwrap_or("password");

        let mut jump_session = client::connect(
            config.clone(),
            format!("{}:{}", jhost, jport),
            KnownHostsHandler::new(jhost, jport, known_hosts.clone()),
        )
        .await
        .map_err(|e| format!("Erro ao conectar ao jump host '{jhost}': {e}"))?;

        let ok = authenticate(
            &mut jump_session,
            jusername,
            jauth,
            jump_password,
            jump_private_key_content,
            jump_private_key_passphrase,
        )
        .await?;
        if !ok {
            return Err("Autenticação no jump host falhou.".into());
        }

        // Abre túnel TCP para o host alvo através do jump host
        let channel = jump_session
            .channel_open_direct_tcpip(&host, port as u32, "127.0.0.1", 0)
            .await
            .map_err(|e| format!("Erro ao abrir túnel para {host}:{port}: {e}"))?;

        // Conecta o SSH do alvo através do túnel
        let target_session = client::connect_stream(
            config.clone(),
            channel.into_stream(),
            KnownHostsHandler::new(&host, port, known_hosts.clone()),
        )
        .await
        .map_err(|e| format!("Erro ao conectar ao host via jump: {e}"))?;

        (target_session, Some(jump_session))
    } else {
        let s = client::connect(
            config.clone(),
            format!("{}:{}", host, port),
            KnownHostsHandler::new(&host, port, known_hosts.clone()),
        )
        .await
        .map_err(|e| format!("Erro ao conectar: {e}"))?;
        (s, None)
    };

    // ─── Autentica no host alvo ────────────────────────────────────────────────

    let ok = authenticate(
        &mut session,
        &username,
        &auth_method,
        password,
        private_key_content,
        private_key_passphrase,
    )
    .await?;
    if !ok {
        return Err("Autenticação falhou. Verifique as credenciais.".into());
    }

    // ─── Persiste known_hosts atualizados ─────────────────────────────────────

    save_known_hosts(&data_dir, &*known_hosts.lock().map_err(|e| e.to_string())?);

    // ─── Abre sessão SFTP ──────────────────────────────────────────────────────

    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Erro ao abrir canal: {e}"))?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Erro ao iniciar subsistema SFTP: {e}"))?;

    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Erro ao iniciar sessão SFTP: {e}"))?;

    let conn = Arc::new(Mutex::new(SftpConnection {
        _handle: session,
        _jump_handle: jump_handle,
        sftp,
    }));

    state
        .sftp
        .lock()
        .await
        .sessions
        .insert(session_id, conn);

    Ok(())
}

#[tauri::command]
pub async fn sftp_read_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;

    let entries = conn
        .sftp
        .read_dir(&path)
        .await
        .map_err(|e| format!("Erro ao listar diretório: {e}"))?;

    let mut result: Vec<SftpEntry> = entries
        .into_iter()
        .filter_map(|entry| {
            let name = entry.file_name().to_string();
            if name == "." || name == ".." {
                return None;
            }
            let meta = entry.metadata();
            let full_path = if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };
            let modified = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_secs());

            Some(SftpEntry {
                is_dir: meta.is_dir(),
                size: meta.len(),
                modified,
                name,
                path: full_path,
            })
        })
        .collect();

    // Diretórios primeiro, depois arquivos, ambos em ordem alfabética
    result.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(result)
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    state.rate_limiter.check("sftp_download", 30, std::time::Duration::from_secs(60))?;
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;

    let file_name = remote_path
        .split('/')
        .next_back()
        .unwrap_or(&remote_path)
        .to_string();

    // Obtém tamanho do arquivo remoto para barra de progresso
    let bytes_total = conn
        .sftp
        .metadata(&remote_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut remote_file = conn
        .sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Erro ao abrir arquivo remoto: {e}"))?;

    let mut local_file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| format!("Erro ao criar arquivo local: {e}"))?;

    let mut buf = vec![0u8; 65536];
    let mut bytes_done = 0u64;

    loop {
        let n = remote_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("Erro ao ler arquivo remoto: {e}"))?;
        if n == 0 {
            break;
        }
        local_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Erro ao gravar arquivo local: {e}"))?;

        bytes_done += n as u64;
        let _ = app.emit(
            "sftp-progress",
            SftpProgressEvent {
                session_id: session_id.clone(),
                operation: "download".into(),
                file_name: file_name.clone(),
                bytes_done,
                bytes_total,
            },
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    state.rate_limiter.check("sftp_upload", 30, std::time::Duration::from_secs(60))?;
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;

    let file_name = Path::new(&local_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&local_path)
        .to_string();

    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| format!("Erro ao abrir arquivo local: {e}"))?;

    // Obtém tamanho do arquivo local para barra de progresso
    let bytes_total = local_file
        .metadata()
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let mut remote_file = conn
        .sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("Erro ao criar arquivo remoto: {e}"))?;

    let mut buf = vec![0u8; 65536];
    let mut bytes_done = 0u64;

    loop {
        let n = local_file
            .read(&mut buf)
            .await
            .map_err(|e| format!("Erro ao ler arquivo local: {e}"))?;
        if n == 0 {
            break;
        }
        remote_file
            .write_all(&buf[..n])
            .await
            .map_err(|e| format!("Erro ao enviar dados: {e}"))?;

        bytes_done += n as u64;
        let _ = app.emit(
            "sftp-progress",
            SftpProgressEvent {
                session_id: session_id.clone(),
                operation: "upload".into(),
                file_name: file_name.clone(),
                bytes_done,
                bytes_total,
            },
        );
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;
    conn.sftp
        .create_dir(&path)
        .await
        .map_err(|e| format!("Erro ao criar diretório: {e}"))
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
    is_dir: bool,
) -> Result<(), String> {
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;
    if is_dir {
        // Delete recursivo: remove conteúdo antes do diretório
        sftp_remove_recursive(&conn.sftp, &path).await
    } else {
        conn.sftp
            .remove_file(&path)
            .await
            .map_err(|e| format!("Erro ao remover arquivo: {e}"))
    }
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;
    conn.sftp
        .rename(&old_path, &new_path)
        .await
        .map_err(|e| format!("Erro ao renomear: {e}"))
}

#[tauri::command]
pub async fn sftp_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.sftp.lock().await.sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn sftp_session_exists(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<bool, String> {
    Ok(state.sftp.lock().await.sessions.contains_key(&session_id))
}
