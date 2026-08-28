use keyring::{Entry, Error as KeyringError};
use rand::Rng;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::{storage, AppState};

const KEYCHAIN_SERVICE: &str = "ssh-vault";
const KEYCHAIN_DB_KEY_ACCOUNT: &str = "db-encryption-key";

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableHost {
    id: String,
    label: String,
    host: String,
    port: u16,
    protocol: String,
    auth_method: String,
    tags: Vec<String>,
    created_at: String,
    updated_at: String,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableCredential {
    id: String,
    label: String,
    username: String,
    auth_method: String,
    created_at: String,
    updated_at: String,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableSshKey {
    id: String,
    label: String,
    created_at: String,
    updated_at: String,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableSettings {
    theme_id: String,
    locale: String,
    #[serde(flatten)]
    extra: HashMap<String, Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PortableStatePayload {
    hosts: Vec<PortableHost>,
    credentials: Vec<PortableCredential>,
    ssh_keys: Vec<PortableSshKey>,
    settings: PortableSettings,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RdpMirrorSummary {
    attempted: bool,
    succeeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPortableStateSummary {
    database_committed: bool,
    hosts: usize,
    credentials: usize,
    ssh_keys: usize,
    settings: usize,
    rdp_mirror: RdpMirrorSummary,
}

impl Database {
    pub fn connection(&self) -> &Mutex<Connection> {
        &self.conn
    }

    pub fn open(data_dir: &PathBuf) -> Result<Self, String> {
        let key = Self::get_or_create_key(data_dir)?;
        let db_path = data_dir.join("vault.db");

        match Self::try_open(&db_path, &key) {
            Ok(db) => Ok(db),
            Err(e) if e.contains("file is not a database") || e.contains("not a database") => {
                // Arquivo incompatível (plain SQLite ou chave diferente) — apaga e recria
                log::warn!("[mpcm-workspace] vault.db incompatível, recriando: {e}");
                let _ = std::fs::remove_file(&db_path);
                // Remove também o WAL e SHM se existirem
                let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
                let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
                Self::try_open(&db_path, &key)
            }
            Err(e) => Err(e),
        }
    }

    fn try_open(db_path: &std::path::Path, key: &str) -> Result<Self, String> {
        let conn = Connection::open(db_path)
            .map_err(|e| format!("Falha ao abrir banco de dados: {e}"))?;

        // Define a chave de criptografia do SQLCipher
        conn.execute_batch(&format!(
            "PRAGMA key = '{}';",
            key.replace('\'', "''")
        ))
        .map_err(|e| format!("Falha ao definir chave do banco: {e}"))?;

        // WAL para melhor performance em leituras concorrentes
        conn.execute_batch("PRAGMA journal_mode = WAL;")
            .map_err(|e| format!("Falha ao configurar WAL: {e}"))?;

        Self::migrate(&conn)?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn get_or_create_key(data_dir: &PathBuf) -> Result<String, String> {
        let key_path = data_dir.join(".db_key");
        let db_path = data_dir.join("vault.db");
        let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_DB_KEY_ACCOUNT)
            .map_err(|e| format!("Falha ao acessar o keychain do sistema: {e}"))?;

        // Tenta ler do keychain do SO primeiro
        match entry.get_password() {
            Ok(key) if !key.is_empty() => {
                Self::remove_legacy_key_file(&key_path)?;
                return Ok(key);
            }
            Ok(_) | Err(KeyringError::NoEntry) => {}
            Err(e) => {
                return Err(format!(
                    "Nao foi possivel ler a chave SQLCipher do keychain do sistema: {e}. \
MPCM Workspace nao persiste mais essa chave em arquivo plain. Configure o keychain do sistema \
ou migre o vault para um ambiente com armazenamento seguro antes de continuar."
                ));
            }
        }

        // Migra instalacoes antigas que ainda tenham .db_key somente se conseguirmos
        // gravar a chave no keychain e remover o arquivo legado.
        if key_path.exists() {
            let key = std::fs::read_to_string(&key_path)
                .map_err(|e| format!("Falha ao ler arquivo legado de chave: {e}"))?;
            let trimmed = key.trim();
            if trimmed.is_empty() {
                return Err("Arquivo legado .db_key esta vazio. Remova-o manualmente e inicialize o vault novamente.".to_string());
            }

            entry.set_password(trimmed).map_err(|e| {
                format!(
                    "Foi encontrado um arquivo legado .db_key, mas nao foi possivel migrar a chave para o keychain do sistema: {e}. \
MPCM Workspace nao usa mais fallback em arquivo plain. Corrija o acesso ao keychain antes de continuar."
                )
            })?;
            Self::remove_legacy_key_file(&key_path)?;
            return Ok(trimmed.to_string());
        }

        // Se o banco ja existe mas nao temos mais a chave, jamais gere uma nova:
        // isso faria o app abrir com uma chave diferente e recriar o vault,
        // parecendo perda de dados/configuracoes.
        if db_path.exists() {
            return Err(
                "O arquivo vault.db ja existe, mas a chave SQLCipher nao foi encontrada no keychain do sistema. \
MPCM Workspace nao vai gerar uma nova chave automaticamente para evitar perda de dados. \
Recupere o acesso ao keychain ou restaure a chave antiga antes de continuar."
                    .to_string(),
            );
        }

        // Gera uma nova chave e persiste apenas no keychain do sistema.
        let key: String = rand::thread_rng()
            .sample_iter(&rand::distributions::Alphanumeric)
            .take(64)
            .map(char::from)
            .collect();

        entry.set_password(&key).map_err(|e| {
            format!(
                "Nao foi possivel armazenar a chave SQLCipher no keychain do sistema: {e}. \
MPCM Workspace nao persiste mais essa chave em arquivo plain. Habilite o keychain do sistema antes de continuar."
            )
        })?;

        Ok(key)
    }

    fn remove_legacy_key_file(key_path: &std::path::Path) -> Result<(), String> {
        if !key_path.exists() {
            return Ok(());
        }

        std::fs::remove_file(key_path).map_err(|e| {
            format!(
                "A chave SQLCipher ja foi movida para o keychain, mas nao foi possivel remover o arquivo legado {}: {e}. \
Remova esse arquivo manualmente antes de continuar.",
                key_path.display()
            )
        })
    }

    fn migrate(conn: &Connection) -> Result<(), String> {
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS hosts (
                id         TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS credentials (
                id         TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ssh_keys (
                id         TEXT PRIMARY KEY,
                data       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS connection_logs (
                id           TEXT PRIMARY KEY,
                host_id      TEXT NOT NULL,
                host_label   TEXT NOT NULL,
                host_address TEXT NOT NULL,
                session_type TEXT NOT NULL,
                connected_at TEXT NOT NULL,
                disconnected_at TEXT,
                duration_secs   INTEGER,
                status       TEXT NOT NULL,
                message      TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_connection_logs_connected_at
                ON connection_logs (connected_at DESC);
            ",
        )
        .map_err(|e| format!("Falha na migração do banco: {e}"))?;

        add_column_if_missing(conn, "connection_logs", "message", "TEXT")
    }
}

fn add_column_if_missing(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    match conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    ) {
        Ok(_) => Ok(()),
        Err(err) if err.to_string().contains("duplicate column name") => Ok(()),
        Err(err) => Err(format!(
            "Falha ao adicionar coluna {column} em {table}: {err}"
        )),
    }
}

#[derive(Debug, PartialEq, Eq)]
struct PortableStateCounts {
    hosts: usize,
    credentials: usize,
    ssh_keys: usize,
}

fn validate_required(entity: &str, field: &str, value: &str, index: usize) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!(
            "{entity}[{index}] possui campo obrigatório vazio: {field}"
        ));
    }
    if value.contains('\0') {
        return Err(format!(
            "{entity}[{index}] possui caractere NUL inválido em {field}"
        ));
    }
    Ok(())
}

fn validate_timestamp(entity: &str, field: &str, value: &str, index: usize) -> Result<(), String> {
    validate_required(entity, field, value, index)?;
    chrono::DateTime::parse_from_rfc3339(value).map_err(|_| {
        format!("{entity}[{index}] possui timestamp RFC 3339 inválido em {field}: {value}")
    })?;
    Ok(())
}

fn validate_entity_identity(
    entity: &str,
    id: &str,
    created_at: &str,
    updated_at: &str,
    index: usize,
    ids: &mut HashSet<String>,
) -> Result<(), String> {
    validate_required(entity, "id", id, index)?;
    validate_timestamp(entity, "createdAt", created_at, index)?;
    validate_timestamp(entity, "updatedAt", updated_at, index)?;
    if !ids.insert(id.to_string()) {
        return Err(format!("{entity} contém id duplicado: {id}"));
    }
    Ok(())
}

fn validate_portable_state(payload: &PortableStatePayload) -> Result<(), String> {
    let mut ids = HashSet::new();
    for (index, host) in payload.hosts.iter().enumerate() {
        validate_entity_identity(
            "hosts",
            &host.id,
            &host.created_at,
            &host.updated_at,
            index,
            &mut ids,
        )?;
        validate_required("hosts", "label", &host.label, index)?;
        validate_required("hosts", "host", &host.host, index)?;
        if host.port == 0 {
            return Err(format!("hosts[{index}] possui porta inválida: 0"));
        }
        if !matches!(host.protocol.as_str(), "ssh" | "telnet" | "rdp" | "vnc") {
            return Err(format!(
                "hosts[{index}] possui protocolo inválido: {}",
                host.protocol
            ));
        }
        if !matches!(
            host.auth_method.as_str(),
            "password" | "privateKey" | "agent"
        ) {
            return Err(format!(
                "hosts[{index}] possui authMethod inválido: {}",
                host.auth_method
            ));
        }
    }

    ids.clear();
    for (index, credential) in payload.credentials.iter().enumerate() {
        validate_entity_identity(
            "credentials",
            &credential.id,
            &credential.created_at,
            &credential.updated_at,
            index,
            &mut ids,
        )?;
        validate_required("credentials", "label", &credential.label, index)?;
        if !matches!(
            credential.auth_method.as_str(),
            "password" | "privateKey" | "agent"
        ) {
            return Err(format!(
                "credentials[{index}] possui authMethod inválido: {}",
                credential.auth_method
            ));
        }
    }

    ids.clear();
    for (index, ssh_key) in payload.ssh_keys.iter().enumerate() {
        validate_entity_identity(
            "sshKeys",
            &ssh_key.id,
            &ssh_key.created_at,
            &ssh_key.updated_at,
            index,
            &mut ids,
        )?;
        validate_required("sshKeys", "label", &ssh_key.label, index)?;
    }

    validate_required("settings", "themeId", &payload.settings.theme_id, 0)?;
    validate_required("settings", "locale", &payload.settings.locale, 0)
}

fn apply_portable_state_transaction(
    conn: &Connection,
    payload: &PortableStatePayload,
) -> Result<PortableStateCounts, String> {
    validate_portable_state(payload)?;

    let hosts = payload
        .hosts
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao serializar hosts: {error}"))?;
    let credentials = payload
        .credentials
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao serializar credenciais: {error}"))?;
    let ssh_keys = payload
        .ssh_keys
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Falha ao serializar chaves SSH: {error}"))?;
    let settings = serde_json::to_string(&payload.settings)
        .map_err(|error| format!("Falha ao serializar configurações: {error}"))?;

    // unchecked_transaction usa &Connection, evitando exigir acesso mutável ao
    // Connection protegido pelo Mutex. O Mutex externo ainda garante exclusão.
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| format!("Falha ao iniciar transação do estado portátil: {error}"))?;

    let apply_result = (|| -> Result<(), String> {
        transaction
            .execute_batch(
                "DELETE FROM hosts;
                 DELETE FROM credentials;
                 DELETE FROM ssh_keys;
                 DELETE FROM settings;",
            )
            .map_err(|error| format!("Falha ao limpar estado anterior: {error}"))?;

        for (host, data) in payload.hosts.iter().zip(hosts.iter()) {
            transaction
                .execute(
                    "INSERT INTO hosts (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    params![host.id, data, host.created_at, host.updated_at],
                )
                .map_err(|error| format!("Falha ao salvar host {}: {error}", host.id))?;
        }

        for (credential, data) in payload.credentials.iter().zip(credentials.iter()) {
            transaction
                .execute(
                    "INSERT INTO credentials (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    params![
                        credential.id,
                        data,
                        credential.created_at,
                        credential.updated_at
                    ],
                )
                .map_err(|error| {
                    format!("Falha ao salvar credencial {}: {error}", credential.id)
                })?;
        }

        for (ssh_key, data) in payload.ssh_keys.iter().zip(ssh_keys.iter()) {
            transaction
                .execute(
                    "INSERT INTO ssh_keys (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
                    params![ssh_key.id, data, ssh_key.created_at, ssh_key.updated_at],
                )
                .map_err(|error| {
                    format!("Falha ao salvar chave SSH {}: {error}", ssh_key.id)
                })?;
        }

        transaction
            .execute(
                "INSERT INTO settings (key, value) VALUES ('app_settings', ?1)",
                params![settings],
            )
            .map_err(|error| format!("Falha ao salvar configurações: {error}"))?;

        Ok(())
    })();

    if let Err(error) = apply_result {
        return match transaction.rollback() {
            Ok(()) => Err(error),
            Err(rollback_error) => Err(format!(
                "{error}; também falhou o rollback da transação: {rollback_error}"
            )),
        };
    }

    transaction
        .commit()
        .map_err(|error| format!("Falha ao confirmar estado portátil: {error}"))?;

    Ok(PortableStateCounts {
        hosts: payload.hosts.len(),
        credentials: payload.credentials.len(),
        ssh_keys: payload.ssh_keys.len(),
    })
}

// ── Hosts ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_hosts(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM hosts ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let rows: Result<Vec<Value>, String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .map(|r| {
            r.map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        })
        .collect();

    rows
}

#[tauri::command]
pub fn db_save_host(state: State<AppState>, host: Value) -> Result<(), String> {
    let id = host["id"].as_str().ok_or("Host sem id")?;
    let created_at = host["createdAt"].as_str().unwrap_or("");
    let updated_at = host["updatedAt"].as_str().unwrap_or("");
    let data = serde_json::to_string(&host).map_err(|e| e.to_string())?;

    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO hosts (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, data, created_at, updated_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_delete_host(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM hosts WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Settings ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_apply_portable_state(
    state: State<AppState>,
    payload: PortableStatePayload,
) -> Result<ApplyPortableStateSummary, String> {
    let settings = serde_json::to_value(&payload.settings)
        .map_err(|error| format!("Falha ao preparar configurações para espelhamento: {error}"))?;

    let counts = {
        let conn = state
            .database
            .conn
            .lock()
            .map_err(|error| error.to_string())?;
        apply_portable_state_transaction(&conn, &payload)?
    };

    // O banco já foi confirmado neste ponto. Uma falha ao atualizar o arquivo
    // auxiliar do cliente RDP é reportada no resumo, sem fingir que houve rollback.
    let rdp_mirror = match mirror_internal_rdp_settings(&state, &settings) {
        Ok(()) => RdpMirrorSummary {
            attempted: true,
            succeeded: true,
            error: None,
        },
        Err(error) => {
            log::error!(
                "[mpcm-workspace] estado portátil confirmado, mas falhou o espelho RDP: {error}"
            );
            RdpMirrorSummary {
                attempted: true,
                succeeded: false,
                error: Some(error),
            }
        }
    };

    Ok(ApplyPortableStateSummary {
        database_committed: true,
        hosts: counts.hosts,
        credentials: counts.credentials,
        ssh_keys: counts.ssh_keys,
        settings: 1,
        rdp_mirror,
    })
}

#[tauri::command]
pub fn db_get_settings(state: State<AppState>) -> Result<Option<Value>, String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    let result: Result<String, _> = conn.query_row(
        "SELECT value FROM settings WHERE key = 'app_settings'",
        [],
        |row| row.get(0),
    );

    match result {
        Ok(data) => {
            let settings = serde_json::from_str(&data).map_err(|e| e.to_string())?;
            if let Err(error) = mirror_internal_rdp_settings(&state, &settings) {
                log::error!("[mpcm-workspace] failed to mirror internal RDP settings: {error}");
            }
            Ok(Some(settings))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn db_save_settings(state: State<AppState>, settings: Value) -> Result<(), String> {
    let data = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?1)",
        params![data],
    )
    .map_err(|e| e.to_string())?;

    if let Err(error) = mirror_internal_rdp_settings(&state, &settings) {
        eprintln!("[mpcm-workspace] failed to mirror internal RDP settings: {error}");
    }

    Ok(())
}

fn mirror_internal_rdp_settings(state: &State<AppState>, settings: &Value) -> Result<(), String> {
    let data_dir = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.data_dir.clone()
    };
    let target_path = storage::internal_rdp_settings_path(&data_dir);
    let payload = json!({
        "app": "ssh-vault",
        "kind": "internal-rdp-client-settings",
        "version": 1,
        "rdp": settings.get("rdp").cloned().unwrap_or_else(|| json!({})),
    });
    let serialized = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;

    std::fs::write(&target_path, serialized)
        .map_err(|e| format!("write {}: {e}", target_path.display()))
}

#[tauri::command]
pub fn db_clear_hosts(state: State<AppState>) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM hosts", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Credentials ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_credentials(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM credentials ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let rows: Result<Vec<Value>, String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .map(|r| {
            r.map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        })
        .collect();

    rows
}

#[tauri::command]
pub fn db_save_credential(state: State<AppState>, credential: Value) -> Result<(), String> {
    let id = credential["id"].as_str().ok_or("Credential sem id")?;
    let created_at = credential["createdAt"].as_str().unwrap_or("");
    let updated_at = credential["updatedAt"].as_str().unwrap_or("");
    let data = serde_json::to_string(&credential).map_err(|e| e.to_string())?;

    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO credentials (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, data, created_at, updated_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_delete_credential(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_clear_credentials(state: State<AppState>) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM credentials", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ── SSH Keys ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_get_ssh_keys(state: State<AppState>) -> Result<Vec<Value>, String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT data FROM ssh_keys ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let rows: Result<Vec<Value>, String> = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .map(|r| {
            r.map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        })
        .collect();

    rows
}

#[tauri::command]
pub fn db_save_ssh_key(state: State<AppState>, ssh_key: Value) -> Result<(), String> {
    let id = ssh_key["id"].as_str().ok_or("SshKey sem id")?;
    let created_at = ssh_key["createdAt"].as_str().unwrap_or("");
    let updated_at = ssh_key["updatedAt"].as_str().unwrap_or("");
    let data = serde_json::to_string(&ssh_key).map_err(|e| e.to_string())?;

    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO ssh_keys (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, data, created_at, updated_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_delete_ssh_key(state: State<AppState>, id: String) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ssh_keys WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn db_clear_ssh_keys(state: State<AppState>) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM ssh_keys", []).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Connection Logs ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_add_connection_log(state: State<AppState>, log: Value) -> Result<(), String> {
    let id           = log["id"].as_str().ok_or("log sem id")?;
    let host_id      = log["hostId"].as_str().unwrap_or("");
    let host_label   = log["hostLabel"].as_str().unwrap_or("");
    let host_address = log["hostAddress"].as_str().unwrap_or("");
    let session_type = log["sessionType"].as_str().unwrap_or("terminal");
    let connected_at = log["connectedAt"].as_str().unwrap_or("");
    let disconnected_at = log["disconnectedAt"].as_str();
    let duration_secs   = log["durationSecs"].as_i64();
    let status          = log["status"].as_str().unwrap_or("connected");
    let message         = log["message"].as_str();

    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO connection_logs
         (id, host_id, host_label, host_address, session_type, connected_at, disconnected_at, duration_secs, status, message)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![id, host_id, host_label, host_address, session_type,
                connected_at, disconnected_at, duration_secs, status, message],
    )
    .map_err(|e| e.to_string())?;

    // Mantém apenas os 1000 registros mais recentes para evitar crescimento ilimitado.
    conn.execute(
        "DELETE FROM connection_logs WHERE id NOT IN (
             SELECT id FROM connection_logs ORDER BY connected_at DESC LIMIT 1000
         )",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn db_get_connection_logs(state: State<AppState>, limit: Option<i64>) -> Result<Vec<Value>, String> {
    let limit = limit.unwrap_or(200);
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, host_id, host_label, host_address, session_type,
                    connected_at, disconnected_at, duration_secs, status, message
             FROM connection_logs
             ORDER BY connected_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows: Result<Vec<Value>, String> = stmt
        .query_map([limit], |row| {
            Ok(serde_json::json!({
                "id":             row.get::<_, String>(0)?,
                "hostId":         row.get::<_, String>(1)?,
                "hostLabel":      row.get::<_, String>(2)?,
                "hostAddress":    row.get::<_, String>(3)?,
                "sessionType":    row.get::<_, String>(4)?,
                "connectedAt":    row.get::<_, String>(5)?,
                "disconnectedAt": row.get::<_, Option<String>>(6)?,
                "durationSecs":   row.get::<_, Option<i64>>(7)?,
                "status":         row.get::<_, String>(8)?,
                "message":        row.get::<_, Option<String>>(9)?,
            }))
        })
        .map_err(|e| e.to_string())?
        .map(|r| r.map_err(|e| e.to_string()))
        .collect();

    rows
}

#[tauri::command]
pub fn db_clear_connection_logs(state: State<AppState>) -> Result<(), String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM connection_logs", []).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OLD_TIMESTAMP: &str = "2025-01-01T00:00:00Z";
    const NEW_TIMESTAMP: &str = "2026-01-01T00:00:00Z";

    fn test_connection() -> Connection {
        let conn = Connection::open_in_memory().expect("abre SQLite em memória");
        Database::migrate(&conn).expect("cria schema de teste");
        conn
    }

    fn seed_existing_state(conn: &Connection) {
        let old_host = json!({
            "id": "old-host",
            "label": "Host antigo",
            "host": "old.example.test",
            "port": 22,
            "protocol": "ssh",
            "authMethod": "agent",
            "tags": [],
            "createdAt": OLD_TIMESTAMP,
            "updatedAt": OLD_TIMESTAMP,
        });
        let old_credential = json!({
            "id": "old-credential",
            "label": "Credencial antiga",
            "username": "old-user",
            "authMethod": "password",
            "createdAt": OLD_TIMESTAMP,
            "updatedAt": OLD_TIMESTAMP,
        });
        let old_ssh_key = json!({
            "id": "old-key",
            "label": "Chave antiga",
            "privateKeyContent": "old-private-key",
            "createdAt": OLD_TIMESTAMP,
            "updatedAt": OLD_TIMESTAMP,
        });
        let old_settings = json!({"themeId": "dark", "locale": "pt-BR", "rdp": {}});

        conn.execute(
            "INSERT INTO hosts (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "old-host",
                old_host.to_string(),
                OLD_TIMESTAMP,
                OLD_TIMESTAMP
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO credentials (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "old-credential",
                old_credential.to_string(),
                OLD_TIMESTAMP,
                OLD_TIMESTAMP
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ssh_keys (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![
                "old-key",
                old_ssh_key.to_string(),
                OLD_TIMESTAMP,
                OLD_TIMESTAMP
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('app_settings', ?1)",
            params![old_settings.to_string()],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO connection_logs
             (id, host_id, host_label, host_address, session_type, connected_at, status)
             VALUES ('log-1', 'old-host', 'Host antigo', 'old.example.test', 'terminal', ?1, 'connected')",
            params![OLD_TIMESTAMP],
        )
        .unwrap();
    }

    fn portable_payload(credential_id: &str) -> PortableStatePayload {
        PortableStatePayload {
            hosts: vec![PortableHost {
                id: "new-host".to_string(),
                label: "Host novo".to_string(),
                host: "new.example.test".to_string(),
                port: 2222,
                protocol: "ssh".to_string(),
                auth_method: "password".to_string(),
                tags: vec!["produção".to_string()],
                created_at: NEW_TIMESTAMP.to_string(),
                updated_at: NEW_TIMESTAMP.to_string(),
                extra: HashMap::new(),
            }],
            credentials: vec![PortableCredential {
                id: credential_id.to_string(),
                label: "Credencial nova".to_string(),
                username: "new-user".to_string(),
                auth_method: "password".to_string(),
                created_at: NEW_TIMESTAMP.to_string(),
                updated_at: NEW_TIMESTAMP.to_string(),
                extra: HashMap::from([("password".to_string(), json!("secret"))]),
            }],
            ssh_keys: vec![PortableSshKey {
                id: "new-key".to_string(),
                label: "Chave nova".to_string(),
                created_at: NEW_TIMESTAMP.to_string(),
                updated_at: NEW_TIMESTAMP.to_string(),
                extra: HashMap::from([("privateKeyContent".to_string(), json!("new-private-key"))]),
            }],
            settings: PortableSettings {
                theme_id: "light".to_string(),
                locale: "en-US".to_string(),
                extra: HashMap::from([(
                    "rdp".to_string(),
                    json!({"launchMode": "internalExperimental"}),
                )]),
            },
        }
    }

    fn stored_ids(conn: &Connection, table: &str) -> Vec<String> {
        let mut statement = conn
            .prepare(&format!("SELECT id FROM {table} ORDER BY id"))
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn portable_state_replaces_targets_atomically_and_preserves_logs() {
        let conn = test_connection();
        seed_existing_state(&conn);

        let counts = apply_portable_state_transaction(&conn, &portable_payload("new-credential"))
            .expect("aplica estado portátil");

        assert_eq!(
            counts,
            PortableStateCounts {
                hosts: 1,
                credentials: 1,
                ssh_keys: 1,
            }
        );
        assert_eq!(stored_ids(&conn, "hosts"), vec!["new-host"]);
        assert_eq!(stored_ids(&conn, "credentials"), vec!["new-credential"]);
        assert_eq!(stored_ids(&conn, "ssh_keys"), vec!["new-key"]);

        let settings: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app_settings'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let settings: Value = serde_json::from_str(&settings).unwrap();
        assert_eq!(settings["themeId"], "light");
        assert_eq!(settings["rdp"]["launchMode"], "internalExperimental");

        let log_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connection_logs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(log_count, 1);
    }

    #[test]
    fn portable_state_rolls_back_every_target_after_insert_error() {
        let conn = test_connection();
        seed_existing_state(&conn);
        conn.execute_batch(
            "CREATE TRIGGER reject_portable_credential
             BEFORE INSERT ON credentials
             WHEN NEW.id = 'force-failure'
             BEGIN
                 SELECT RAISE(ABORT, 'forced credential failure');
             END;",
        )
        .unwrap();

        let error = apply_portable_state_transaction(&conn, &portable_payload("force-failure"))
            .expect_err("falha forçada deve abortar a transação");

        assert!(error.contains("forced credential failure"));
        assert_eq!(stored_ids(&conn, "hosts"), vec!["old-host"]);
        assert_eq!(stored_ids(&conn, "credentials"), vec!["old-credential"]);
        assert_eq!(stored_ids(&conn, "ssh_keys"), vec!["old-key"]);

        let theme: String = conn
            .query_row(
                "SELECT json_extract(value, '$.themeId') FROM settings WHERE key = 'app_settings'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(theme, "dark");

        let log_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM connection_logs", [], |row| row.get(0))
            .unwrap();
        assert_eq!(log_count, 1);
    }
}
