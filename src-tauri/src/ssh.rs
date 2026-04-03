use std::borrow::Cow;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use cfg_if::cfg_if;
use russh::{cipher, compression, kex, mac};
use russh::client;
use russh::Preferred;
use russh::ChannelMsg;
use russh_keys::agent::client::AgentClient;
use russh_keys::key::PublicKey;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::mpsc;

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
    let known_hosts = Arc::new(std::sync::Mutex::new(known_hosts_map));

    let addr = format!("{}:{}", host, port);
    let mut session = client::connect(
        config,
        addr,
        ClientHandler::new(&host, port, known_hosts.clone()),
    )
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

// ─── ssh-copy-id ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn ssh_copy_id(
    host: String,
    port: u16,
    username: String,
    password: String,
    public_key_content: String,
) -> Result<(), String> {
    let config = Arc::new(client::Config::default());
    let addr = format!("{}:{}", host, port);

    // Usa known_hosts em memória (sem persistência) para o ssh-copy-id
    let known_hosts = Arc::new(std::sync::Mutex::new(HashMap::<String, String>::new()));
    let mut session = client::connect(
        config,
        addr,
        ClientHandler::new(&host, port, known_hosts),
    )
    .await
    .map_err(|e| format!("Erro ao conectar: {e}"))?;

    let ok = session
        .authenticate_password(&username, &password)
        .await
        .map_err(|e| format!("Erro de autenticação: {e}"))?;

    if !ok {
        return Err("Senha incorreta ou autenticação recusada pelo servidor.".into());
    }

    // Escapa aspas simples no conteúdo da chave para uso no shell
    let key = public_key_content.trim().replace('\'', "'\\''");

    // Garante ~/.ssh com permissões corretas e adiciona a chave em authorized_keys
    let cmd = format!(
        "umask 077; mkdir -p ~/.ssh && \
         grep -qxF '{key}' ~/.ssh/authorized_keys 2>/dev/null || \
         echo '{key}' >> ~/.ssh/authorized_keys"
    );

    let mut channel = session
        .channel_open_session()
        .await
        .map_err(|e| format!("Erro ao abrir canal: {e}"))?;

    channel
        .exec(true, cmd.as_str())
        .await
        .map_err(|e| format!("Erro ao executar comando: {e}"))?;

    // Aguarda o canal fechar e captura eventuais erros de exit status
    loop {
        match channel.wait().await {
            Some(ChannelMsg::ExitStatus { exit_status }) => {
                if exit_status != 0 {
                    return Err(format!(
                        "Comando remoto falhou com status {exit_status}."
                    ));
                }
                break;
            }
            Some(ChannelMsg::Close) | None => break,
            _ => {}
        }
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
