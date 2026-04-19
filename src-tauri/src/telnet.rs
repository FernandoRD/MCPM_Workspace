use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::{mpsc, Mutex};
use tokio::time::timeout;

use crate::ssh::{TerminalOutputEvent, TerminalStatusEvent};

const IAC: u8 = 255;
const DONT: u8 = 254;
const DO: u8 = 253;
const WONT: u8 = 252;
const WILL: u8 = 251;
const SB: u8 = 250;
const SE: u8 = 240;

const OPT_ECHO: u8 = 1;
const OPT_SUPPRESS_GO_AHEAD: u8 = 3;
const OPT_TERMINAL_TYPE: u8 = 24;
const OPT_NAWS: u8 = 31;

const TTYPE_IS: u8 = 0;
const TTYPE_SEND: u8 = 1;
const DEFAULT_TERMINAL_TYPE: &[u8] = b"xterm-256color";

enum TelnetCommand {
    Data(Vec<u8>),
    Resize { cols: u16, rows: u16 },
    Disconnect,
}

struct LiveSession {
    tx: mpsc::Sender<TelnetCommand>,
}

pub struct TelnetManager {
    sessions: HashMap<String, LiveSession>,
}

impl TelnetManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }
}

#[derive(Default)]
struct TelnetNegotiation {
    local_enabled: HashSet<u8>,
    remote_enabled: HashSet<u8>,
    cols: u16,
    rows: u16,
}

impl TelnetNegotiation {
    fn new(cols: u16, rows: u16) -> Self {
        Self {
            local_enabled: HashSet::new(),
            remote_enabled: HashSet::new(),
            cols,
            rows,
        }
    }
}

enum TelnetParseState {
    Data,
    Command,
    Negotiate(u8),
    SubOption,
    SubData { option: u8, saw_iac: bool },
}

struct TelnetParser {
    state: TelnetParseState,
    sub_data: Vec<u8>,
}

impl Default for TelnetParser {
    fn default() -> Self {
        Self {
            state: TelnetParseState::Data,
            sub_data: Vec::new(),
        }
    }
}

struct TelnetParseResult {
    output: Vec<u8>,
    responses: Vec<Vec<u8>>,
}

impl TelnetParser {
    fn consume(
        &mut self,
        bytes: &[u8],
        negotiation: &mut TelnetNegotiation,
    ) -> TelnetParseResult {
        let mut output = Vec::new();
        let mut responses = Vec::new();

        for &byte in bytes {
            match self.state {
                TelnetParseState::Data => {
                    if byte == IAC {
                        self.state = TelnetParseState::Command;
                    } else {
                        output.push(byte);
                    }
                }
                TelnetParseState::Command => match byte {
                    IAC => {
                        output.push(IAC);
                        self.state = TelnetParseState::Data;
                    }
                    DO | DONT | WILL | WONT => {
                        self.state = TelnetParseState::Negotiate(byte);
                    }
                    SB => {
                        self.sub_data.clear();
                        self.state = TelnetParseState::SubOption;
                    }
                    _ => {
                        self.state = TelnetParseState::Data;
                    }
                },
                TelnetParseState::Negotiate(command) => {
                    if let Some(response) = handle_negotiation(command, byte, negotiation) {
                        responses.push(response);
                    }
                    if command == DO && byte == OPT_NAWS {
                        responses.push(build_naws_subnegotiation(
                            negotiation.cols,
                            negotiation.rows,
                        ));
                    }
                    self.state = TelnetParseState::Data;
                }
                TelnetParseState::SubOption => {
                    self.sub_data.clear();
                    self.state = TelnetParseState::SubData {
                        option: byte,
                        saw_iac: false,
                    };
                }
                TelnetParseState::SubData { option, saw_iac } => {
                    if saw_iac {
                        match byte {
                            IAC => {
                                self.sub_data.push(IAC);
                                self.state = TelnetParseState::SubData {
                                    option,
                                    saw_iac: false,
                                };
                            }
                            SE => {
                                if let Some(response) =
                                    handle_subnegotiation(option, &self.sub_data, negotiation)
                                {
                                    responses.push(response);
                                }
                                self.sub_data.clear();
                                self.state = TelnetParseState::Data;
                            }
                            _ => {
                                self.sub_data.clear();
                                self.state = TelnetParseState::Data;
                            }
                        }
                    } else if byte == IAC {
                        self.state = TelnetParseState::SubData {
                            option,
                            saw_iac: true,
                        };
                    } else {
                        self.sub_data.push(byte);
                    }
                }
            }
        }

        TelnetParseResult { output, responses }
    }
}

fn is_supported_local_option(option: u8) -> bool {
    matches!(option, OPT_TERMINAL_TYPE | OPT_NAWS)
}

fn is_supported_remote_option(option: u8) -> bool {
    matches!(option, OPT_ECHO | OPT_SUPPRESS_GO_AHEAD)
}

fn build_negotiation(command: u8, option: u8) -> Vec<u8> {
    vec![IAC, command, option]
}

fn push_escaped_byte(bytes: &mut Vec<u8>, value: u8) {
    bytes.push(value);
    if value == IAC {
        bytes.push(IAC);
    }
}

fn build_naws_subnegotiation(cols: u16, rows: u16) -> Vec<u8> {
    let mut payload = vec![IAC, SB, OPT_NAWS];
    for byte in cols.to_be_bytes() {
        push_escaped_byte(&mut payload, byte);
    }
    for byte in rows.to_be_bytes() {
        push_escaped_byte(&mut payload, byte);
    }
    payload.extend_from_slice(&[IAC, SE]);
    payload
}

fn build_terminal_type_subnegotiation() -> Vec<u8> {
    let mut payload = vec![IAC, SB, OPT_TERMINAL_TYPE, TTYPE_IS];
    for &byte in DEFAULT_TERMINAL_TYPE {
        push_escaped_byte(&mut payload, byte);
    }
    payload.extend_from_slice(&[IAC, SE]);
    payload
}

fn handle_negotiation(
    command: u8,
    option: u8,
    negotiation: &mut TelnetNegotiation,
) -> Option<Vec<u8>> {
    match command {
        WILL => {
            if is_supported_remote_option(option) {
                negotiation.remote_enabled.insert(option);
                Some(build_negotiation(DO, option))
            } else {
                negotiation.remote_enabled.remove(&option);
                Some(build_negotiation(DONT, option))
            }
        }
        WONT => {
            negotiation.remote_enabled.remove(&option);
            Some(build_negotiation(DONT, option))
        }
        DO => {
            if is_supported_local_option(option) {
                negotiation.local_enabled.insert(option);
                Some(build_negotiation(WILL, option))
            } else {
                negotiation.local_enabled.remove(&option);
                Some(build_negotiation(WONT, option))
            }
        }
        DONT => {
            negotiation.local_enabled.remove(&option);
            Some(build_negotiation(WONT, option))
        }
        _ => None,
    }
}

fn handle_subnegotiation(
    option: u8,
    data: &[u8],
    negotiation: &TelnetNegotiation,
) -> Option<Vec<u8>> {
    if option == OPT_TERMINAL_TYPE
        && negotiation.local_enabled.contains(&OPT_TERMINAL_TYPE)
        && data.first().copied() == Some(TTYPE_SEND)
    {
        return Some(build_terminal_type_subnegotiation());
    }

    None
}

fn normalize_telnet_input(data: String) -> Vec<u8> {
    let mut normalized = Vec::with_capacity(data.len() + 8);
    let bytes = data.as_bytes();
    let mut idx = 0;

    while idx < bytes.len() {
        let byte = bytes[idx];
        if byte == b'\r' {
            normalized.extend_from_slice(b"\r\n");
            if bytes.get(idx + 1) == Some(&b'\n') {
                idx += 1;
            }
        } else {
            normalized.push(byte);
        }
        idx += 1;
    }

    normalized
}

fn trim_owned(value: String) -> String {
    value.trim().to_string()
}

fn telnet_log_error(context: String, error: impl std::fmt::Display) -> String {
    let message = format!("{context}: {error}");
    log::error!("{message}");
    message
}

#[tauri::command]
pub async fn telnet_connect(
    state: tauri::State<'_, crate::AppState>,
    app: AppHandle,
    tab_id: String,
    host: String,
    port: u16,
    connection_timeout: Option<u32>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let host = trim_owned(host);
    let connect_context = format!(
        "tab={} target={}:{} timeout={} cols={} rows={}",
        tab_id,
        host,
        port,
        connection_timeout.unwrap_or(15),
        cols,
        rows
    );
    state
        .rate_limiter
        .check("telnet_connect", 10, Duration::from_secs(60))
        .map_err(|error| {
            log::warn!("telnet: conexão bloqueada por rate limit {connect_context}: {error}");
            error
        })?;
    log::info!("telnet: connect iniciado {connect_context}");

    let _ = app.emit(
        "terminal-status",
        TerminalStatusEvent {
            tab_id: tab_id.clone(),
            status: "connecting".into(),
            message: None,
        },
    );

    let timeout_duration = Duration::from_secs(connection_timeout.unwrap_or(15).max(1) as u64);
    let stream = timeout(timeout_duration, TcpStream::connect((host.as_str(), port)))
        .await
        .map_err(|_| {
            let message = format!("Tempo esgotado ao conectar via Telnet ({connect_context})");
            log::error!("{message}");
            message
        })?
        .map_err(|e| telnet_log_error(format!("telnet: erro ao conectar ({connect_context})"), e))?;

    let (tx, mut rx) = mpsc::channel::<TelnetCommand>(64);
    {
        let mut manager = state.telnet.lock().await;
        manager.sessions.insert(tab_id.clone(), LiveSession { tx });
    }

    let _ = app.emit(
        "terminal-status",
        TerminalStatusEvent {
            tab_id: tab_id.clone(),
            status: "connected".into(),
            message: None,
        },
    );
    log::info!("telnet: conectado {connect_context}");

    let app_task = app.clone();
    let tab_id_task = tab_id.clone();
    let telnet_arc = Arc::clone(&state.telnet);
    let negotiation = Arc::new(Mutex::new(TelnetNegotiation::new(cols, rows)));

    tokio::spawn(async move {
        let (mut reader, mut writer) = stream.into_split();
        let mut parser = TelnetParser::default();
        let mut buffer = [0u8; 4096];

        loop {
            tokio::select! {
                read_result = reader.read(&mut buffer) => {
                    match read_result {
                        Ok(0) => break,
                        Ok(read) => {
                            let parse_result = {
                                let mut negotiation = negotiation.lock().await;
                                parser.consume(&buffer[..read], &mut negotiation)
                            };

                            if !parse_result.output.is_empty() {
                                let _ = app_task.emit("terminal-output", TerminalOutputEvent {
                                    tab_id: tab_id_task.clone(),
                                    data: B64.encode(parse_result.output),
                                });
                            }

                            for response in parse_result.responses {
                                if writer.write_all(&response).await.is_err() {
                                    log::error!("telnet: falha ao responder negociação tab={}", tab_id_task);
                                    break;
                                }
                            }
                        }
                        Err(error) => {
                            log::error!("telnet: erro de leitura tab={}: {}", tab_id_task, error);
                            break;
                        }
                    }
                }
                cmd = rx.recv() => {
                    match cmd {
                        Some(TelnetCommand::Data(bytes)) => {
                            if writer.write_all(&bytes).await.is_err() {
                                log::error!("telnet: falha ao enviar dados tab={}", tab_id_task);
                                break;
                            }
                        }
                        Some(TelnetCommand::Resize { cols, rows }) => {
                            let response = {
                                let mut negotiation = negotiation.lock().await;
                                negotiation.cols = cols;
                                negotiation.rows = rows;
                                if negotiation.local_enabled.contains(&OPT_NAWS) {
                                    Some(build_naws_subnegotiation(cols, rows))
                                } else {
                                    None
                                }
                            };

                            if let Some(response) = response {
                                if writer.write_all(&response).await.is_err() {
                                    log::error!("telnet: falha ao enviar resize tab={}", tab_id_task);
                                    break;
                                }
                            }
                        }
                        Some(TelnetCommand::Disconnect) | None => {
                            let _ = writer.shutdown().await;
                            break;
                        }
                    }
                }
            }
        }

        telnet_arc.lock().await.sessions.remove(&tab_id_task);
        log::info!("telnet: desconectado tab={}", tab_id_task);
        let _ = app_task.emit(
            "terminal-status",
            TerminalStatusEvent {
                tab_id: tab_id_task,
                status: "disconnected".into(),
                message: None,
            },
        );
    });

    Ok(())
}

#[tauri::command]
pub async fn telnet_send_input(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
    data: String,
) -> Result<(), String> {
    let manager = state.telnet.lock().await;
    if let Some(session) = manager.sessions.get(&tab_id) {
        session
            .tx
            .send(TelnetCommand::Data(normalize_telnet_input(data)))
            .await
            .map_err(|e| telnet_log_error(format!("telnet: falha ao enviar input tab={tab_id}"), e))?;
    } else {
        log::warn!("telnet: send_input para sessão inexistente tab={}", tab_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn telnet_resize(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let manager = state.telnet.lock().await;
    if let Some(session) = manager.sessions.get(&tab_id) {
        session
            .tx
            .send(TelnetCommand::Resize { cols, rows })
            .await
            .map_err(|e| {
                telnet_log_error(
                    format!("telnet: falha ao redimensionar tab={tab_id} cols={cols} rows={rows}"),
                    e,
                )
            })?;
    } else {
        log::warn!("telnet: resize para sessão inexistente tab={}", tab_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn telnet_disconnect(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
) -> Result<(), String> {
    let manager = state.telnet.lock().await;
    if let Some(session) = manager.sessions.get(&tab_id) {
        log::info!("telnet: disconnect solicitado tab={}", tab_id);
        let _ = session.tx.send(TelnetCommand::Disconnect).await;
    } else {
        log::warn!("telnet: disconnect para sessão inexistente tab={}", tab_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn telnet_session_exists(
    state: tauri::State<'_, crate::AppState>,
    tab_id: String,
) -> Result<bool, String> {
    let exists = state.telnet.lock().await.sessions.contains_key(&tab_id);
    log::debug!("telnet: session_exists tab={} exists={}", tab_id, exists);
    Ok(exists)
}
