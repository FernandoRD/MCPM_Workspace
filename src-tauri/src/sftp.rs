use std::borrow::Cow;
use std::collections::HashMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

use async_trait::async_trait;
use cfg_if::cfg_if;
use russh::client;
use russh_keys::key::PublicKey;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

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
    _handle: client::Handle<SftpClientHandler>,
    /// Mantém a sessão SSH do jump host viva (quando usado)
    _jump_handle: Option<client::Handle<SftpClientHandler>>,
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

// ─── Known hosts (TOFU) ───────────────────────────────────────────────────────

fn known_hosts_path(data_dir: &Path) -> PathBuf {
    data_dir.join("known_hosts.json")
}

fn trim_owned(value: String) -> String {
    value.trim().to_string()
}

fn trim_optional_owned(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn load_known_hosts(data_dir: &Path) -> HashMap<String, String> {
    let path = known_hosts_path(data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_known_hosts(data_dir: &Path, hosts: &HashMap<String, String>) {
    let path = known_hosts_path(data_dir);
    if let Ok(json) = serde_json::to_string_pretty(hosts) {
        let _ = std::fs::write(path, json);
    }
}

// ─── Handler SSH com known_hosts TOFU ────────────────────────────────────────

pub struct SftpClientHandler {
    host_key: String,
    known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>,
}

impl SftpClientHandler {
    fn new(
        host: &str,
        port: u16,
        known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>,
    ) -> Self {
        Self {
            host_key: format!("[{}]:{}", host, port),
            known_hosts,
        }
    }
}

#[async_trait]
impl client::Handler for SftpClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        let mut kh = self.known_hosts.lock().unwrap();
        match kh.get(&self.host_key).cloned() {
            None => {
                // TOFU: primeira conexão — armazena e aceita
                kh.insert(self.host_key.clone(), fingerprint);
                Ok(true)
            }
            Some(stored) if stored == fingerprint => Ok(true),
            Some(_) => {
                // Fingerprint diferente — possível MITM
                Err(russh::Error::WrongServerSig)
            }
        }
    }
}

// ─── Helper de autenticação ───────────────────────────────────────────────────

async fn authenticate(
    session: &mut client::Handle<SftpClientHandler>,
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

// ─── Configuração SSH por preset (reusa as constantes de ssh.rs) ──────────────

fn build_sftp_config(
    preset: &str,
    keepalive_secs: u32,
    timeout_secs: u32,
) -> Arc<client::Config> {
    use russh::{cipher, compression, kex, mac};
    use russh::Preferred;

    static LEGACY_KEX: &[kex::Name] = &[
        kex::CURVE25519, kex::CURVE25519_PRE_RFC_8731, kex::DH_G16_SHA512,
        kex::DH_G14_SHA256, kex::ECDH_SHA2_NISTP256, kex::ECDH_SHA2_NISTP384,
        kex::ECDH_SHA2_NISTP521, kex::DH_G14_SHA1,
    ];
    static VERY_LEGACY_KEX: &[kex::Name] = &[
        kex::CURVE25519, kex::CURVE25519_PRE_RFC_8731, kex::DH_G16_SHA512,
        kex::DH_G14_SHA256, kex::ECDH_SHA2_NISTP256, kex::ECDH_SHA2_NISTP384,
        kex::ECDH_SHA2_NISTP521, kex::DH_G14_SHA1, kex::DH_G1_SHA1,
    ];
    static LEGACY_CIPHER: &[cipher::Name] = &[
        cipher::CHACHA20_POLY1305, cipher::AES_256_GCM, cipher::AES_256_CTR,
        cipher::AES_192_CTR, cipher::AES_128_CTR, cipher::AES_256_CBC,
        cipher::AES_192_CBC, cipher::AES_128_CBC,
    ];
    static LEGACY_MAC: &[mac::Name] = &[
        mac::HMAC_SHA256_ETM, mac::HMAC_SHA512_ETM, mac::HMAC_SHA256,
        mac::HMAC_SHA512, mac::HMAC_SHA1_ETM, mac::HMAC_SHA1,
    ];
    static LEGACY_KEY: &[russh_keys::key::Name] = &[
        russh_keys::key::ED25519, russh_keys::key::ECDSA_SHA2_NISTP256,
        russh_keys::key::ECDSA_SHA2_NISTP384, russh_keys::key::ECDSA_SHA2_NISTP521,
        russh_keys::key::RSA_SHA2_256, russh_keys::key::RSA_SHA2_512,
        russh_keys::key::SSH_RSA,
    ];
    static LEGACY_COMPRESSION: &[compression::Name] = &[compression::NONE];

    let mut config = client::Config::default();

    match preset {
        "legacy" => {
            config.preferred = Preferred {
                kex: Cow::Borrowed(LEGACY_KEX),
                key: Cow::Borrowed(LEGACY_KEY),
                cipher: Cow::Borrowed(LEGACY_CIPHER),
                mac: Cow::Borrowed(LEGACY_MAC),
                compression: Cow::Borrowed(LEGACY_COMPRESSION),
            };
        }
        "very-legacy" => {
            config.preferred = Preferred {
                kex: Cow::Borrowed(VERY_LEGACY_KEX),
                key: Cow::Borrowed(LEGACY_KEY),
                cipher: Cow::Borrowed(LEGACY_CIPHER),
                mac: Cow::Borrowed(LEGACY_MAC),
                compression: Cow::Borrowed(LEGACY_COMPRESSION),
            };
        }
        _ => {}
    }

    if keepalive_secs > 0 {
        config.keepalive_interval = Some(Duration::from_secs(keepalive_secs as u64));
        config.keepalive_max = 3;
    }

    if timeout_secs > 0 {
        config.inactivity_timeout = Some(Duration::from_secs(timeout_secs as u64));
    }

    Arc::new(config)
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
    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let known_hosts_map = load_known_hosts(&data_dir);
    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let preset = ssh_compat_preset.as_deref().unwrap_or("modern");
    let keepalive = keepalive_interval.unwrap_or(0);
    let timeout = connection_timeout.unwrap_or(30);
    let config = build_sftp_config(preset, keepalive, timeout);

    // ─── Conecta ao host alvo (direto ou via jump host) ────────────────────────

    let (mut session, jump_handle) = if let Some(ref jhost) = jump_host {
        let jport = jump_port.unwrap_or(22);
        let jusername = jump_username.as_deref().unwrap_or(&username);
        let jauth = jump_auth_method.as_deref().unwrap_or("password");

        let mut jump_session = client::connect(
            config.clone(),
            format!("{}:{}", jhost, jport),
            SftpClientHandler::new(jhost, jport, known_hosts.clone()),
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
            SftpClientHandler::new(&host, port, known_hosts.clone()),
        )
        .await
        .map_err(|e| format!("Erro ao conectar ao host via jump: {e}"))?;

        (target_session, Some(jump_session))
    } else {
        let s = client::connect(
            config.clone(),
            format!("{}:{}", host, port),
            SftpClientHandler::new(&host, port, known_hosts.clone()),
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

    save_known_hosts(&data_dir, &known_hosts.lock().unwrap());

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

    let file_name = local_path
        .split('/')
        .next_back()
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
