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
    let mut session = client::connect(config, addr, ClientHandler)
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
