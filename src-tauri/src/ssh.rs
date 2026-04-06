use std::borrow::Cow;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use cfg_if::cfg_if;
use rusqlite::{params, Connection};
use russh::{cipher, compression, kex, mac};
use russh::client;
use russh::Channel;
use russh::Preferred;
use russh::ChannelMsg;
use russh_keys::agent::client::AgentClient;
use russh_keys::key::PublicKey;
use russh_sftp::client::SftpSession;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use zeroize::Zeroizing;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::sync::mpsc;
use tokio::time::{sleep, timeout};

// ─── Algoritmos legado (KEX + ciphers + MACs + host-key) ─────────────────────

// KEX: inclui DH-Group14-SHA1 para servidores com OpenSSH ≤ 7
static LEGACY_KEX: &[kex::Name] = &[
    kex::CURVE25519,
    kex::CURVE25519_PRE_RFC_8731,
    kex::DH_G16_SHA512,
    kex::DH_G14_SHA256,
    kex::ECDH_SHA2_NISTP256,
    kex::ECDH_SHA2_NISTP384,
    kex::ECDH_SHA2_NISTP521,
    kex::DH_G14_SHA1,   // legado: OpenSSH ≤ 7, equipamentos de rede
];

// KEX muito legado: adiciona DH-Group1-SHA1 (Oakley Group 2)
static VERY_LEGACY_KEX: &[kex::Name] = &[
    kex::CURVE25519,
    kex::CURVE25519_PRE_RFC_8731,
    kex::DH_G16_SHA512,
    kex::DH_G14_SHA256,
    kex::ECDH_SHA2_NISTP256,
    kex::ECDH_SHA2_NISTP384,
    kex::ECDH_SHA2_NISTP521,
    kex::DH_G14_SHA1,
    kex::DH_G1_SHA1,    // muito legado: CentOS 5, RHEL 5
];

static LEGACY_CIPHER: &[cipher::Name] = &[
    cipher::CHACHA20_POLY1305,
    cipher::AES_256_GCM,
    cipher::AES_256_CTR,
    cipher::AES_192_CTR,
    cipher::AES_128_CTR,
    cipher::AES_256_CBC,  // legado: servidor sem suporte a CTR
    cipher::AES_192_CBC,
    cipher::AES_128_CBC,
];

static LEGACY_MAC: &[mac::Name] = &[
    mac::HMAC_SHA256_ETM,
    mac::HMAC_SHA512_ETM,
    mac::HMAC_SHA256,
    mac::HMAC_SHA512,
    mac::HMAC_SHA1_ETM,
    mac::HMAC_SHA1,     // legado
];

static LEGACY_KEY: &[russh_keys::key::Name] = &[
    russh_keys::key::ED25519,
    russh_keys::key::ECDSA_SHA2_NISTP256,
    russh_keys::key::ECDSA_SHA2_NISTP384,
    russh_keys::key::ECDSA_SHA2_NISTP521,
    russh_keys::key::RSA_SHA2_256,
    russh_keys::key::RSA_SHA2_512,
    russh_keys::key::SSH_RSA, // legado: ssh-rsa com SHA-1
];

static LEGACY_COMPRESSION: &[compression::Name] = &[compression::NONE];

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

// ─── Túnel ativo ──────────────────────────────────────────────────────────────

struct LiveTunnel {
    shutdown_tx: tokio::sync::oneshot::Sender<()>,
}

// ─── Gerenciador de sessões ───────────────────────────────────────────────────

pub struct SshManager {
    sessions: HashMap<String, LiveSession>,
    tunnels: HashMap<String, LiveTunnel>,
}

impl SshManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            tunnels: HashMap::new(),
        }
    }
}

// ─── Known hosts (TOFU) ───────────────────────────────────────────────────────

fn known_hosts_path(data_dir: &Path) -> std::path::PathBuf {
    data_dir.join("known_hosts.json")
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

// ─── Handler russh com TOFU known_hosts ──────────────────────────────────────

struct ClientHandler {
    host_key: String,
    known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>,
}

impl ClientHandler {
    fn new(host: &str, port: u16, known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>) -> Self {
        Self {
            host_key: format!("[{}]:{}", host, port),
            known_hosts,
        }
    }
}

struct FingerprintProbeHandler {
    fingerprint: Arc<std::sync::Mutex<Option<String>>>,
}

impl FingerprintProbeHandler {
    fn new(fingerprint: Arc<std::sync::Mutex<Option<String>>>) -> Self {
        Self { fingerprint }
    }
}

#[async_trait]
impl client::Handler for ClientHandler {
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

#[async_trait]
impl client::Handler for FingerprintProbeHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        *self.fingerprint.lock().unwrap() = Some(server_public_key.fingerprint());
        Ok(true)
    }
}

#[derive(Clone, Serialize)]
pub struct KnownHostEntry {
    pub host_key: String,
    pub fingerprint: String,
}

#[derive(Clone, Serialize)]
pub struct SshHealthCheckResult {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
    pub host_key: String,
    pub fingerprint: Option<String>,
    pub stored_fingerprint: Option<String>,
    pub fingerprint_status: String,
}

fn format_host_key(host: &str, port: u16) -> String {
    format!("[{}]:{}", host, port)
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

async fn fetch_server_fingerprint(
    host: &str,
    port: u16,
    ssh_compat_preset: Option<&str>,
    timeout_duration: Duration,
) -> Result<String, String> {
    let config = build_ssh_config(
        ssh_compat_preset.unwrap_or("modern"),
        0,
        (timeout_duration.as_secs().max(1)) as u32,
    );
    let captured = Arc::new(std::sync::Mutex::new(None::<String>));
    let handler = FingerprintProbeHandler::new(captured.clone());
    let addr = format!("{}:{}", host, port);

    let session = timeout(timeout_duration, client::connect(config, addr, handler))
        .await
        .map_err(|_| "Tempo esgotado ao negociar fingerprint SSH".to_string())?
        .map_err(|e| e.to_string())?;

    drop(session);

    let fingerprint = captured
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| "Servidor respondeu sem expor fingerprint".to_string())?;
    Ok(fingerprint)
}

#[tauri::command]
pub fn ssh_list_known_hosts(
    state: tauri::State<'_, crate::AppState>,
) -> Result<Vec<KnownHostEntry>, String> {
    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let mut entries = load_known_hosts(&data_dir)
        .into_iter()
        .map(|(host_key, fingerprint)| KnownHostEntry {
            host_key,
            fingerprint,
        })
        .collect::<Vec<_>>();
    entries.sort_by(|a, b| a.host_key.cmp(&b.host_key));
    Ok(entries)
}

/// Armazena explicitamente a fingerprint de um host nos known_hosts.
/// Chamado pelo frontend após o usuário confirmar a fingerprint de um host novo.
#[tauri::command]
pub fn ssh_trust_host(
    state: tauri::State<'_, crate::AppState>,
    host: String,
    port: u16,
    fingerprint: String,
) -> Result<(), String> {
    let host = trim_owned(host);
    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let mut known_hosts = load_known_hosts(&data_dir);
    known_hosts.insert(format_host_key(&host, port), fingerprint);
    save_known_hosts(&data_dir, &known_hosts);
    Ok(())
}

#[tauri::command]
pub async fn ssh_health_check(
    state: tauri::State<'_, crate::AppState>,
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
    ssh_compat_preset: Option<String>,
) -> Result<SshHealthCheckResult, String> {
    let host = trim_owned(host);
    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(4000));
    let host_key = format_host_key(&host, port);
    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let known_hosts = load_known_hosts(&data_dir);
    let stored_fingerprint = known_hosts.get(&host_key).cloned();

    let started = std::time::Instant::now();
    let tcp_result = timeout(timeout_duration, tokio::net::TcpStream::connect((host.as_str(), port))).await;
    let (reachable, latency_ms, tcp_error) = match tcp_result {
        Ok(Ok(_)) => (true, Some(started.elapsed().as_millis() as u64), None),
        Ok(Err(err)) => (false, None, Some(err.to_string())),
        Err(_) => (false, None, Some("Tempo esgotado ao conectar na porta SSH".to_string())),
    };

    if !reachable {
        return Ok(SshHealthCheckResult {
            reachable,
            latency_ms,
            error: tcp_error,
            host_key,
            fingerprint: None,
            stored_fingerprint,
            fingerprint_status: "unreachable".to_string(),
        });
    }

    match fetch_server_fingerprint(&host, port, ssh_compat_preset.as_deref(), timeout_duration).await {
        Ok(fingerprint) => {
            let fingerprint_status = match stored_fingerprint.as_deref() {
                Some(stored) if stored == fingerprint => "match",
                Some(_) => "mismatch",
                None => "new",
            };
            Ok(SshHealthCheckResult {
                reachable,
                latency_ms,
                error: None,
                host_key,
                fingerprint: Some(fingerprint),
                stored_fingerprint,
                fingerprint_status: fingerprint_status.to_string(),
            })
        }
        Err(err) => Ok(SshHealthCheckResult {
            reachable,
            latency_ms,
            error: Some(err),
            host_key,
            fingerprint: None,
            stored_fingerprint: stored_fingerprint.clone(),
            fingerprint_status: if stored_fingerprint.is_some() {
                "stored-only".to_string()
            } else {
                "unknown".to_string()
            },
        }),
    }
}

// ─── Configuração SSH por preset de compatibilidade ──────────────────────────

fn build_ssh_config(
    preset: &str,
    keepalive_secs: u32,
    timeout_secs: u32,
) -> Arc<client::Config> {
    let mut config = client::Config::default();

    // Aplica preset de compatibilidade
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
        _ => {} // "modern" ou desconhecido → padrão seguro
    }

    // Keepalive
    if keepalive_secs > 0 {
        config.keepalive_interval = Some(Duration::from_secs(keepalive_secs as u64));
        config.keepalive_max = 3;
    }

    // Timeout de inatividade
    if timeout_secs > 0 {
        config.inactivity_timeout = Some(Duration::from_secs(timeout_secs as u64));
    }

    Arc::new(config)
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
    ssh_compat_preset: Option<String>,
    keepalive_interval: Option<u32>,
    connection_timeout: Option<u32>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let host = trim_owned(host);
    let username = trim_owned(username);
    state.rate_limiter.check("ssh_connect", 10, std::time::Duration::from_secs(60))?;
    let _ = app.emit(
        "ssh-status",
        SshStatusEvent {
            tab_id: tab_id.clone(),
            status: "connecting".into(),
            message: None,
        },
    );

    let preset = ssh_compat_preset.as_deref().unwrap_or("modern");
    let keepalive = keepalive_interval.unwrap_or(0);
    let timeout = connection_timeout.unwrap_or(30);
    let config = build_ssh_config(preset, keepalive, timeout);

    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let known_hosts_map = load_known_hosts(&data_dir);

    // Antes de conectar: se o host não está nos known_hosts, busca a fingerprint
    // e retorna um erro especial para o frontend pedir confirmação ao usuário.
    // Isso impede aceitação silenciosa de hosts desconhecidos (TOFU inseguro).
    let host_key_id = format_host_key(&host, port);
    if !known_hosts_map.contains_key(&host_key_id) {
        let timeout_dur = Duration::from_secs(10);
        let fingerprint = fetch_server_fingerprint(&host, port, ssh_compat_preset.as_deref(), timeout_dur)
            .await
            .map_err(|e| e)?;
        return Err(format!("HOST_KEY_UNKNOWN:{fingerprint}"));
    }

    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let addr = format!("{}:{}", host, port);
    let mut session = client::connect(
        config,
        addr,
        ClientHandler::new(&host, port, known_hosts.clone()),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Zeroiza credenciais sensíveis ao sair de escopo
    let password = password.map(Zeroizing::new);
    let private_key_content = private_key_content.map(Zeroizing::new);
    let private_key_passphrase = private_key_passphrase.map(Zeroizing::new);

    let ok = match auth_method.as_str() {
        "password" => {
            let pwd = password.ok_or("Senha não informada")?;
            session
                .authenticate_password(&username, pwd.as_str())
                .await
                .map_err(|e| e.to_string())?
        }

        "privateKey" => {
            let content = private_key_content.ok_or("Conteúdo da chave privada não informado")?;
            let passphrase = private_key_passphrase.as_ref().map(|z| z.as_str());
            let key =
                russh_keys::decode_secret_key(content.as_str(), passphrase)
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

    // Persiste known_hosts atualizados após autenticação bem-sucedida
    save_known_hosts(&data_dir, &known_hosts.lock().unwrap());

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

#[tauri::command]
pub async fn ssh_session_exists(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
) -> Result<bool, String> {
    Ok(state.ssh.lock().await.sessions.contains_key(&tab_id))
}

// ─── ssh-copy-id ──────────────────────────────────────────────────────────────

/// Instala uma chave pública no `~/.ssh/authorized_keys` do servidor remoto.
///
/// Usa SFTP em vez de execução de shell para eliminar o risco de injeção de
/// comandos via conteúdo malicioso na chave pública.
#[tauri::command]
pub async fn ssh_copy_id(
    state: tauri::State<'_, crate::AppState>,
    host: String,
    port: u16,
    username: String,
    password: String,
    public_key_content: String,
) -> Result<(), String> {
    let host = trim_owned(host);
    let username = trim_owned(username);
    state.rate_limiter.check("ssh_copy_id", 5, std::time::Duration::from_secs(60))?;
    // Zeroiza credenciais sensíveis ao sair de escopo
    let password = Zeroizing::new(password);

    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let known_hosts_map = load_known_hosts(&data_dir);

    // Rejeita host desconhecido — o usuário deve confirmar a fingerprint primeiro
    let host_key_id = format_host_key(&host, port);
    if !known_hosts_map.contains_key(&host_key_id) {
        let fingerprint = fetch_server_fingerprint(&host, port, None, Duration::from_secs(10))
            .await
            .map_err(|e| e)?;
        return Err(format!("HOST_KEY_UNKNOWN:{fingerprint}"));
    }

    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);
    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let mut session = client::connect(
        config,
        addr,
        ClientHandler::new(&host, port, known_hosts),
    )
    .await
    .map_err(|e| format!("Erro ao conectar: {e}"))?;

    let ok = session
        .authenticate_password(&username, password.as_str())
        .await
        .map_err(|e| format!("Erro de autenticação: {e}"))?;

    if !ok {
        return Err("Senha incorreta ou autenticação recusada pelo servidor.".into());
    }

    // Abre sessão SFTP — sem passar pela shell, sem risco de injeção
    let channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Erro ao abrir canal SFTP: {e}"))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|e| format!("Erro ao iniciar subsistema SFTP: {e}"))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|e| format!("Erro ao iniciar sessão SFTP: {e}"))?;

    // Cria ~/.ssh se não existir (ignora erro "já existe")
    let _ = sftp.create_dir(".ssh").await;

    // Lê authorized_keys existente (ou usa string vazia)
    let authorized_keys_path = ".ssh/authorized_keys";
    let existing = match sftp.open(authorized_keys_path).await {
        Ok(mut f) => {
            let mut buf = Vec::new();
            f.read_to_end(&mut buf)
                .await
                .map_err(|e| format!("Erro ao ler authorized_keys: {e}"))?;
            String::from_utf8_lossy(&buf).into_owned()
        }
        Err(_) => String::new(),
    };

    // Verifica se a chave já está presente (linha exata)
    let key_trimmed = public_key_content.trim();
    let already_present = existing
        .lines()
        .any(|line| line.trim() == key_trimmed);

    if already_present {
        return Ok(());
    }

    // Monta o novo conteúdo e escreve via SFTP — sem shell, sem injeção
    let new_content = if existing.is_empty() || existing.ends_with('\n') {
        format!("{key_trimmed}\n")
    } else {
        format!("\n{key_trimmed}\n")
    };
    let full_content = format!("{existing}{new_content}");

    let mut f = sftp
        .create(authorized_keys_path)
        .await
        .map_err(|e| format!("Erro ao escrever authorized_keys: {e}"))?;
    f.write_all(full_content.as_bytes())
        .await
        .map_err(|e| format!("Erro ao gravar authorized_keys: {e}"))?;

    Ok(())
}

// ─── Helper: autenticação extraída ────────────────────────────────────────────

async fn authenticate_session(
    session: &mut client::Handle<ClientHandler>,
    auth_method: &str,
    username: &str,
    password: Option<&str>,
    private_key_content: Option<&str>,
    private_key_passphrase: Option<&str>,
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
            let content = private_key_content.ok_or("Conteúdo da chave privada não informado")?;
            let key = russh_keys::decode_secret_key(content, private_key_passphrase)
                .map_err(|e| format!("Falha ao decodificar a chave privada: {e}"))?;
            session
                .authenticate_publickey(username, Arc::new(key))
                .await
                .map_err(|e| e.to_string())
        }
        "agent" => {
            cfg_if! {
                if #[cfg(unix)] {
                    let agent = AgentClient::connect_env().await.map_err(|_| {
                        "Não foi possível conectar ao agente SSH.\n\
                         Verifique se o ssh-agent está rodando e SSH_AUTH_SOCK está definido."
                            .to_string()
                    })?;
                    try_agent_auth(session, username, agent).await
                } else if #[cfg(windows)] {
                    use tokio::net::windows::named_pipe::ClientOptions;
                    let stream = ClientOptions::new()
                        .open(r"\\.\pipe\openssh-ssh-agent")
                        .map_err(|_| "Agente OpenSSH não encontrado.".to_string())?;
                    let agent = AgentClient::connect(stream);
                    try_agent_auth(session, username, agent).await
                } else {
                    Err("Agente SSH não suportado nesta plataforma.".into())
                }
            }
        }
        _ => Err(format!("Método de autenticação desconhecido: {auth_method}")),
    }
}

// ─── Proxy bidirecional: TCP <-> canal SSH ────────────────────────────────────

/// Tempo máximo sem tráfego antes de encerrar um túnel — evita conexões mortas indefinidas.
const TUNNEL_IDLE_TIMEOUT: Duration = Duration::from_secs(300);

async fn proxy_tcp_to_channel(stream: tokio::net::TcpStream, mut channel: Channel<client::Msg>) {
    let (mut tcp_read, mut tcp_write) = stream.into_split();
    let mut buf = vec![0u8; 32 * 1024];

    loop {
        tokio::select! {
            // Encerra o túnel se ficar ocioso por mais de TUNNEL_IDLE_TIMEOUT.
            // O timer é recriado a cada iteração, portanto reseta a cada transferência.
            _ = sleep(TUNNEL_IDLE_TIMEOUT) => {
                let _ = channel.eof().await;
                break;
            }
            n = tcp_read.read(&mut buf) => {
                match n {
                    Ok(0) | Err(_) => {
                        let _ = channel.eof().await;
                        break;
                    }
                    Ok(n) => {
                        if channel.data(&buf[..n]).await.is_err() {
                            break;
                        }
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        if tcp_write.write_all(data.as_ref()).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    }
}

// ─── Handshake SOCKS5 para DynamicForward ────────────────────────────────────

async fn socks5_handshake(
    mut stream: tokio::net::TcpStream,
) -> Result<(String, u16, tokio::net::TcpStream), String> {
    // 1. Saudação do cliente
    let mut header = [0u8; 2];
    stream.read_exact(&mut header).await.map_err(|e| e.to_string())?;
    if header[0] != 5 {
        return Err("Protocolo não é SOCKS5".into());
    }
    let nmethods = header[1] as usize;
    let mut methods = vec![0u8; nmethods];
    stream.read_exact(&mut methods).await.map_err(|e| e.to_string())?;

    // Aceita sem autenticação (método 0)
    stream.write_all(&[5, 0]).await.map_err(|e| e.to_string())?;

    // 2. Requisição de conexão
    let mut req = [0u8; 4];
    stream.read_exact(&mut req).await.map_err(|e| e.to_string())?;
    if req[0] != 5 || req[1] != 1 {
        return Err("Comando SOCKS5 não suportado (somente CONNECT)".into());
    }

    let target_host = match req[3] {
        1 => {
            // IPv4
            let mut addr = [0u8; 4];
            stream.read_exact(&mut addr).await.map_err(|e| e.to_string())?;
            format!("{}.{}.{}.{}", addr[0], addr[1], addr[2], addr[3])
        }
        3 => {
            // Nome de domínio
            let len = stream.read_u8().await.map_err(|e| e.to_string())?;
            let mut domain = vec![0u8; len as usize];
            stream.read_exact(&mut domain).await.map_err(|e| e.to_string())?;
            String::from_utf8_lossy(&domain).to_string()
        }
        4 => {
            // IPv6
            let mut addr = [0u8; 16];
            stream.read_exact(&mut addr).await.map_err(|e| e.to_string())?;
            let parts: Vec<String> = addr.chunks(2).map(|c| format!("{:02x}{:02x}", c[0], c[1])).collect();
            parts.join(":")
        }
        t => return Err(format!("Tipo de endereço SOCKS5 não suportado: {t}")),
    };

    let target_port = stream.read_u16().await.map_err(|e| e.to_string())?;

    // Resposta de sucesso (BND.ADDR = 0.0.0.0, BND.PORT = 0)
    stream
        .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
        .await
        .map_err(|e| e.to_string())?;

    Ok((target_host, target_port, stream))
}

// ─── ssh_exec ─────────────────────────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct RemoteExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_status: u32,
    pub duration_ms: u64,
}

fn load_db_value_by_id(conn: &Connection, table: &str, id: &str) -> Result<Option<Value>, String> {
    let sql = format!("SELECT data FROM {table} WHERE id = ?1");
    let result: Result<String, _> = conn.query_row(&sql, params![id], |row| row.get(0));

    match result {
        Ok(data) => serde_json::from_str(&data).map(Some).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn load_app_settings(conn: &Connection) -> Result<Option<Value>, String> {
    let result: Result<String, _> = conn.query_row(
        "SELECT value FROM settings WHERE key = 'app_settings'",
        [],
        |row| row.get(0),
    );

    match result {
        Ok(data) => serde_json::from_str(&data).map(Some).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn snippet_applies_to_host(snippet: &Value, host: &Value) -> bool {
    match snippet["scopeType"].as_str().unwrap_or("global") {
        "global" => true,
        "host" => snippet["scopeValue"].as_str() == host["id"].as_str(),
        "group" => {
            let host_group = host["group"].as_str().map(str::trim).unwrap_or("");
            let scope_value = snippet["scopeValue"].as_str().map(str::trim).unwrap_or("");
            !host_group.is_empty() && host_group == scope_value
        }
        _ => false,
    }
}

fn render_snippet_command(
    template: &str,
    host: &Value,
    credential: Option<&Value>,
    cwd: &str,
) -> String {
    let username = credential
        .and_then(|cred| cred["username"].as_str())
        .or_else(|| host["username"].as_str())
        .unwrap_or("");
    let replacements = [
        ("${host}", host["host"].as_str().unwrap_or("")),
        ("${user}", username),
        ("${port}", &host["port"].as_u64().unwrap_or(22).to_string()),
        ("${cwd}", cwd),
        ("${label}", host["label"].as_str().unwrap_or("")),
        ("${group}", host["group"].as_str().unwrap_or("")),
    ];

    let mut rendered = template.to_string();
    for (token, value) in replacements {
        rendered = rendered.replace(token, value);
    }
    rendered
}

#[tauri::command]
pub async fn ssh_exec(
    state: tauri::State<'_, crate::AppState>,
    host_id: String,
    snippet_id: String,
    cwd: Option<String>,
) -> Result<RemoteExecResult, String> {
    state.rate_limiter.check("ssh_exec", 30, std::time::Duration::from_secs(60))?;
    let (host, credential, ssh_key, settings, command) = {
        let conn = state
            .database
            .connection()
            .lock()
            .map_err(|e| e.to_string())?;

        let host = load_db_value_by_id(&conn, "hosts", &host_id)?
            .ok_or_else(|| "Host não encontrado.".to_string())?;

        let settings = load_app_settings(&conn)?
            .ok_or_else(|| "Configurações da aplicação não encontradas.".to_string())?;

        let snippets = settings["productivity"]["snippets"]
            .as_array()
            .ok_or_else(|| "Lista de snippets indisponível nas configurações.".to_string())?;
        let snippet = snippets
            .iter()
            .find(|candidate| candidate["id"].as_str() == Some(snippet_id.as_str()))
            .ok_or_else(|| "Snippet não encontrado.".to_string())?;

        if !snippet_applies_to_host(snippet, &host) {
            return Err("O snippet selecionado não está autorizado para este host.".to_string());
        }

        let credential = match host["credentialId"].as_str() {
            Some(id) if !id.is_empty() => load_db_value_by_id(&conn, "credentials", id)?,
            _ => None,
        };

        let ssh_key = match credential.as_ref().and_then(|cred| cred["keyId"].as_str()) {
            Some(id) if !id.is_empty() => load_db_value_by_id(&conn, "ssh_keys", id)?,
            _ => None,
        };

        let rendered = render_snippet_command(
            snippet["command"].as_str().unwrap_or(""),
            &host,
            credential.as_ref(),
            cwd.as_deref().unwrap_or("~"),
        );
        if rendered.trim().is_empty() {
            return Err("O snippet renderizado resultou em um comando vazio.".to_string());
        }

        (host, credential, ssh_key, settings, rendered)
    };

    let host_name = host["host"]
        .as_str()
        .ok_or_else(|| "Host salvo sem endereço válido.".to_string())?
        .to_string();
    let port = host["port"].as_u64().unwrap_or(22) as u16;
    let username = credential
        .as_ref()
        .and_then(|cred| cred["username"].as_str())
        .or_else(|| host["username"].as_str())
        .ok_or_else(|| "Host salvo sem usuário configurado.".to_string())?
        .to_string();
    let auth_method = credential
        .as_ref()
        .and_then(|cred| cred["authMethod"].as_str())
        .or_else(|| host["authMethod"].as_str())
        .unwrap_or("agent")
        .to_string();

    // Zeroiza credenciais sensíveis ao sair de escopo
    let password = credential
        .as_ref()
        .and_then(|cred| cred["password"].as_str())
        .or_else(|| host["passwordRef"].as_str())
        .map(|value| Zeroizing::new(value.to_string()));
    let private_key_content = ssh_key
        .as_ref()
        .and_then(|key| key["privateKeyContent"].as_str())
        .map(|value| Zeroizing::new(value.to_string()));
    let private_key_passphrase = ssh_key
        .as_ref()
        .and_then(|key| key["passphrase"].as_str())
        .map(|value| Zeroizing::new(value.to_string()));

    let preset = host["sshCompat"]["preset"].as_str().unwrap_or("modern");
    let keepalive_interval = host["keepAliveInterval"]
        .as_u64()
        .map(|value| value as u32)
        .or_else(|| settings["ssh"]["keepAliveInterval"].as_u64().map(|value| value as u32))
        .unwrap_or(0);
    let connection_timeout = host["connectionTimeout"]
        .as_u64()
        .map(|value| value as u32)
        .or_else(|| settings["ssh"]["inactivityTimeout"].as_u64().map(|value| value as u32))
        .unwrap_or(30);

    let config = build_ssh_config(preset, keepalive_interval, connection_timeout);

    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let known_hosts_map = load_known_hosts(&data_dir);
    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let addr = format!("{}:{}", host_name, port);
    let mut session = client::connect(config, addr, ClientHandler::new(&host_name, port, known_hosts.clone()))
        .await
        .map_err(|e| e.to_string())?;

    let ok = authenticate_session(
        &mut session,
        &auth_method,
        &username,
        password.as_ref().map(|z| z.as_str()),
        private_key_content.as_ref().map(|z| z.as_str()),
        private_key_passphrase.as_ref().map(|z| z.as_str()),
    )
    .await?;

    if !ok {
        return Err("Autenticação falhou. Verifique as credenciais.".into());
    }
    save_known_hosts(&data_dir, &known_hosts.lock().unwrap());

    let mut channel = session.channel_open_session().await.map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    channel.exec(true, command.as_str()).await.map_err(|e| e.to_string())?;

    let mut stdout_buf = Vec::new();
    let mut stderr_buf = Vec::new();
    let mut exit_status = 0u32;

    loop {
        match channel.wait().await {
            Some(ChannelMsg::Data { ref data }) => stdout_buf.extend_from_slice(data.as_ref()),
            Some(ChannelMsg::ExtendedData { ref data, .. }) => stderr_buf.extend_from_slice(data.as_ref()),
            Some(ChannelMsg::ExitStatus { exit_status: s }) => exit_status = s,
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
    }

    Ok(RemoteExecResult {
        stdout: String::from_utf8_lossy(&stdout_buf).to_string(),
        stderr: String::from_utf8_lossy(&stderr_buf).to_string(),
        exit_status,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

// ─── TunnelSpec ───────────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Clone)]
#[allow(dead_code)]
pub struct TunnelSpec {
    pub kind: String,
    pub bind_address: String,
    pub bind_port: u16,
    pub destination_host: String,
    pub destination_port: u16,
    pub local_host: Option<String>,
    pub local_port: Option<u16>,
}

// ─── ssh_start_tunnel ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_start_tunnel(
    state: tauri::State<'_, crate::AppState>,
    tunnel_id: String,
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
    spec: TunnelSpec,
) -> Result<(), String> {
    let host = trim_owned(host);
    let username = trim_owned(username);
    let spec = TunnelSpec {
        bind_address: trim_owned(spec.bind_address),
        destination_host: trim_owned(spec.destination_host),
        local_host: trim_optional_owned(spec.local_host),
        ..spec
    };
    // Zeroiza credenciais sensíveis ao sair de escopo
    let password = password.map(Zeroizing::new);
    let private_key_content = private_key_content.map(Zeroizing::new);
    let private_key_passphrase = private_key_passphrase.map(Zeroizing::new);

    // Verifica se túnel já está ativo
    {
        let mgr = state.ssh.lock().await;
        if mgr.tunnels.contains_key(&tunnel_id) {
            return Err(format!("Túnel {tunnel_id} já está ativo"));
        }
    }

    let preset = ssh_compat_preset.as_deref().unwrap_or("modern");
    let config = build_ssh_config(preset, keepalive_interval.unwrap_or(0), connection_timeout.unwrap_or(30));

    let data_dir = state.storage.lock().unwrap().data_dir.clone();
    let known_hosts_map = load_known_hosts(&data_dir);
    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let addr = format!("{}:{}", host, port);
    let mut session = client::connect(config, addr, ClientHandler::new(&host, port, known_hosts.clone()))
        .await
        .map_err(|e| e.to_string())?;

    let ok = authenticate_session(
        &mut session,
        &auth_method,
        &username,
        password.as_ref().map(|z| z.as_str()),
        private_key_content.as_ref().map(|z| z.as_str()),
        private_key_passphrase.as_ref().map(|z| z.as_str()),
    )
    .await?;

    if !ok {
        return Err("Autenticação falhou. Verifique as credenciais.".into());
    }
    save_known_hosts(&data_dir, &known_hosts.lock().unwrap());

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();

    {
        let mut mgr = state.ssh.lock().await;
        mgr.tunnels.insert(tunnel_id.clone(), LiveTunnel { shutdown_tx });
    }

    let session_arc = Arc::new(tokio::sync::Mutex::new(session));
    let ssh_mgr = Arc::clone(&state.ssh);
    let tunnel_id_task = tunnel_id.clone();

    match spec.kind.as_str() {
        "local" => {
            let bind_addr = format!("{}:{}", spec.bind_address, spec.bind_port);
            let listener = tokio::net::TcpListener::bind(&bind_addr)
                .await
                .map_err(|e| format!("Falha ao fazer bind em {bind_addr}: {e}"))?;

            let dest_host = spec.destination_host.clone();
            let dest_port = spec.destination_port;

            tokio::spawn(async move {
                let mut shutdown_rx = shutdown_rx;
                loop {
                    tokio::select! {
                        result = listener.accept() => {
                            match result {
                                Ok((tcp_stream, _)) => {
                                    let sess = Arc::clone(&session_arc);
                                    let dh = dest_host.clone();
                                    let dp = dest_port;
                                    tokio::spawn(async move {
                                        let channel = {
                                            let s = sess.lock().await;
                                            s.channel_open_direct_tcpip(&dh, dp as u32, "127.0.0.1", 0).await
                                        };
                                        if let Ok(ch) = channel {
                                            proxy_tcp_to_channel(tcp_stream, ch).await;
                                        }
                                    });
                                }
                                Err(_) => break,
                            }
                        }
                        _ = &mut shutdown_rx => break,
                    }
                }
                ssh_mgr.lock().await.tunnels.remove(&tunnel_id_task);
            });
        }

        "dynamic" => {
            // Proxy SOCKS5
            let bind_addr = format!("{}:{}", spec.bind_address, spec.bind_port);
            let listener = tokio::net::TcpListener::bind(&bind_addr)
                .await
                .map_err(|e| format!("Falha ao fazer bind em {bind_addr}: {e}"))?;

            tokio::spawn(async move {
                let mut shutdown_rx = shutdown_rx;
                loop {
                    tokio::select! {
                        result = listener.accept() => {
                            match result {
                                Ok((tcp_stream, _)) => {
                                    let sess = Arc::clone(&session_arc);
                                    tokio::spawn(async move {
                                        if let Ok((target_host, target_port, stream)) = socks5_handshake(tcp_stream).await {
                                            let channel = {
                                                let s = sess.lock().await;
                                                s.channel_open_direct_tcpip(&target_host, target_port as u32, "127.0.0.1", 0).await
                                            };
                                            if let Ok(ch) = channel {
                                                proxy_tcp_to_channel(stream, ch).await;
                                            }
                                        }
                                    });
                                }
                                Err(_) => break,
                            }
                        }
                        _ = &mut shutdown_rx => break,
                    }
                }
                ssh_mgr.lock().await.tunnels.remove(&tunnel_id_task);
            });
        }

        "remote" => {
            // RemoteForward: limpa estado antes de retornar erro
            ssh_mgr.lock().await.tunnels.remove(&tunnel_id_task);
            return Err("RemoteForward ainda não é suportado nesta versão.".into());
        }

        kind => {
            ssh_mgr.lock().await.tunnels.remove(&tunnel_id_task);
            return Err(format!("Tipo de túnel desconhecido: {kind}"));
        }
    }

    Ok(())
}

// ─── ssh_stop_tunnel ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_stop_tunnel(
    state: tauri::State<'_, crate::AppState>,
    tunnel_id: String,
) -> Result<(), String> {
    let mut mgr = state.ssh.lock().await;
    if let Some(tunnel) = mgr.tunnels.remove(&tunnel_id) {
        let _ = tunnel.shutdown_tx.send(());
    }
    Ok(())
}

// ─── Geração de par de chaves SSH ─────────────────────────────────────────────

#[derive(serde::Serialize)]
pub struct GeneratedKeyPair {
    /// Chave privada no formato PKCS#8 PEM
    pub private_key: String,
    /// Chave pública no formato OpenSSH de uma linha (ssh-ed25519 AAAA... comment)
    pub public_key: String,
    /// Fingerprint SHA-256 da chave pública (SHA256:xxxx)
    pub fingerprint: String,
}

#[tauri::command]
pub fn ssh_generate_key(
    key_type: String,
    comment: Option<String>,
) -> Result<GeneratedKeyPair, String> {
    use russh_keys::encode_pkcs8_pem;
    use russh_keys::key::{KeyPair, SignatureHash};

    let pair: KeyPair = match key_type.as_str() {
        "ed25519" => KeyPair::generate_ed25519()
            .ok_or("Falha ao gerar chave Ed25519")?,
        "ecdsa" => {
            use rand::rngs::OsRng;
            let signing_key = p256::ecdsa::SigningKey::random(&mut OsRng);
            let scalar_bytes = signing_key.to_bytes();
            let ec_key = russh_keys::ec::PrivateKey::new_from_secret_scalar(
                b"ecdsa-sha2-nistp256",
                &scalar_bytes,
            )
            .map_err(|e| format!("Falha ao criar chave ECDSA: {e}"))?;
            KeyPair::EC { key: ec_key }
        }
        "rsa2048" => KeyPair::generate_rsa(2048, SignatureHash::SHA2_256)
            .ok_or("Falha ao gerar chave RSA-2048")?,
        "rsa4096" => KeyPair::generate_rsa(4096, SignatureHash::SHA2_256)
            .ok_or("Falha ao gerar chave RSA-4096")?,
        _ => return Err(format!("Tipo de chave desconhecido: {key_type}")),
    };

    // Serializa chave privada como PEM PKCS#8
    let mut private_pem: Vec<u8> = Vec::new();
    encode_pkcs8_pem(&pair, &mut private_pem)
        .map_err(|e| format!("Falha ao serializar chave privada: {e}"))?;
    let private_key = String::from_utf8(private_pem)
        .map_err(|e| format!("Falha ao converter PEM para string: {e}"))?;

    // Serializa chave pública no formato OpenSSH de uma linha
    let pub_key = pair
        .clone_public_key()
        .map_err(|e| format!("Falha ao obter chave pública: {e}"))?;
    let fingerprint = pub_key.fingerprint();

    let mut pub_bytes: Vec<u8> = Vec::new();
    russh_keys::write_public_key_base64(&mut pub_bytes, &pub_key)
        .map_err(|e| format!("Falha ao serializar chave pública: {e}"))?;
    let pub_str = String::from_utf8(pub_bytes)
        .map_err(|e| format!("Falha ao converter chave pública para string: {e}"))?;

    // Adiciona o comentário ao final da linha da chave pública
    let public_key = match comment.filter(|s| !s.trim().is_empty()) {
        Some(c) => format!("{} {}", pub_str.trim_end(), c),
        None => pub_str.trim_end().to_string(),
    };

    Ok(GeneratedKeyPair {
        private_key,
        public_key,
        fingerprint,
    })
}
