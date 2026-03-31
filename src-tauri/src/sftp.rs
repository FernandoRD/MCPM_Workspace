use std::collections::HashMap;
use std::sync::Arc;
use std::time::SystemTime;

use async_trait::async_trait;
use russh::client;
use russh_keys::key::PublicKey;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

use crate::AppState;

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
    /// Mantém a sessão SSH viva enquanto o SFTP estiver aberto
    _handle: client::Handle<SftpClientHandler>,
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

// ─── Handler SSH mínimo (apenas para o handshake) ─────────────────────────────

struct SftpClientHandler;

#[async_trait]
impl client::Handler for SftpClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
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
) -> Result<(), String> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);
    let mut session = client::connect(config, addr, SftpClientHandler)
        .await
        .map_err(|e| format!("Erro ao conectar: {e}"))?;

    let ok = match auth_method.as_str() {
        "password" => {
            let pwd = password.ok_or("Senha não informada")?;
            session
                .authenticate_password(&username, pwd)
                .await
                .map_err(|e| e.to_string())?
        }
        "privateKey" => {
            let content = private_key_content.ok_or("Conteúdo da chave não informado")?;
            let key =
                russh_keys::decode_secret_key(&content, private_key_passphrase.as_deref())
                    .map_err(|e| format!("Falha ao decodificar chave: {e}"))?;
            session
                .authenticate_publickey(&username, Arc::new(key))
                .await
                .map_err(|e| e.to_string())?
        }
        "agent" => {
            use cfg_if::cfg_if;
            cfg_if! {
                if #[cfg(unix)] {
                    use russh_keys::agent::client::AgentClient;
                    let agent = AgentClient::connect_env()
                        .await
                        .map_err(|_| "Não foi possível conectar ao agente SSH.".to_string())?;
                    let ids = {
                        let mut a = agent;
                        let ids = a.request_identities().await.map_err(|e| e.to_string())?;
                        let mut ok = false;
                        for id in &ids {
                            let (ra, result) = session
                                .authenticate_future(&username, id.clone(), a)
                                .await;
                            a = ra;
                            if result.unwrap_or(false) { ok = true; break; }
                        }
                        ok
                    };
                    ids
                } else {
                    return Err("Agente SSH não suportado nesta plataforma.".into());
                }
            }
        }
        _ => return Err(format!("Método de autenticação desconhecido: {auth_method}")),
    };

    if !ok {
        return Err("Autenticação falhou. Verifique as credenciais.".into());
    }

    // Abre o canal SFTP
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
            // Ignora entradas especiais "." e ".."
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
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;

    let mut remote_file = conn
        .sftp
        .open(&remote_path)
        .await
        .map_err(|e| format!("Erro ao abrir arquivo remoto: {e}"))?;

    let mut local_file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|e| format!("Erro ao criar arquivo local: {e}"))?;

    let mut buf = vec![0u8; 65536];
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
    }

    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let conn_arc = {
        let mgr = state.sftp.lock().await;
        mgr.sessions
            .get(&session_id)
            .ok_or("Sessão SFTP não encontrada")?
            .clone()
    };
    let conn = conn_arc.lock().await;

    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|e| format!("Erro ao abrir arquivo local: {e}"))?;

    let mut remote_file = conn
        .sftp
        .create(&remote_path)
        .await
        .map_err(|e| format!("Erro ao criar arquivo remoto: {e}"))?;

    let mut buf = vec![0u8; 65536];
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
        conn.sftp
            .remove_dir(&path)
            .await
            .map_err(|e| format!("Erro ao remover diretório: {e}"))
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
