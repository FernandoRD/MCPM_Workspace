use keyring::{Entry, Error as KeyringError};
use rand::Rng;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

use crate::AppState;

const KEYCHAIN_SERVICE: &str = "ssh-vault";
const KEYCHAIN_DB_KEY_ACCOUNT: &str = "db-encryption-key";

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn open(data_dir: &PathBuf) -> Result<Self, String> {
        let key = Self::get_or_create_key(data_dir)?;
        let db_path = data_dir.join("vault.db");

        match Self::try_open(&db_path, &key) {
            Ok(db) => Ok(db),
            Err(e) if e.contains("file is not a database") || e.contains("not a database") => {
                // Arquivo incompatível (plain SQLite ou chave diferente) — apaga e recria
                eprintln!("[ssh-vault] vault.db incompatível, recriando: {e}");
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
SSH Vault nao persiste mais essa chave em arquivo plain. Configure o keychain do sistema \
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
SSH Vault nao usa mais fallback em arquivo plain. Corrija o acesso ao keychain antes de continuar."
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
SSH Vault nao vai gerar uma nova chave automaticamente para evitar perda de dados. \
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
SSH Vault nao persiste mais essa chave em arquivo plain. Habilite o keychain do sistema antes de continuar."
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
                status       TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_connection_logs_connected_at
                ON connection_logs (connected_at DESC);
            ",
        )
        .map_err(|e| format!("Falha na migração do banco: {e}"))
    }
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
pub fn db_get_settings(state: State<AppState>) -> Result<Option<Value>, String> {
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn db_save_settings(state: State<AppState>, settings: Value) -> Result<(), String> {
    let data = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?1)",
        params![data],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
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

    let conn = state.database.conn.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO connection_logs
         (id, host_id, host_label, host_address, session_type, connected_at, disconnected_at, duration_secs, status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![id, host_id, host_label, host_address, session_type,
                connected_at, disconnected_at, duration_secs, status],
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
                    connected_at, disconnected_at, duration_secs, status
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
