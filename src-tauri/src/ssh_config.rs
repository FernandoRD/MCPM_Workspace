use crate::AppState;
use chrono::Utc;
use rusqlite::params;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tauri::State;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
struct BlockSettings {
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    proxy_jump: Option<String>,
    identity_file: Option<String>,
}

#[derive(Debug, Clone)]
struct ImportedSshConfigHost {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub proxy_jump: Option<String>,
    pub identity_file_content: Option<String>,
    pub public_key_content: Option<String>,
    pub source_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportedSshConfigPreviewHost {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub auth_method: String,
    pub has_jump_host: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshConfigImportPreview {
    pub hosts: Vec<ImportedSshConfigPreviewHost>,
    pub imported_count: usize,
    pub skipped_count: usize,
    pub credentials_count: usize,
    pub ssh_keys_count: usize,
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshConfigImportResult {
    pub imported_count: usize,
    pub skipped_count: usize,
    pub credentials_count: usize,
    pub ssh_keys_count: usize,
    pub source_path: Option<String>,
}

struct ImportPlan {
    hosts: Vec<Value>,
    credentials: Vec<Value>,
    ssh_keys: Vec<Value>,
    preview_hosts: Vec<ImportedSshConfigPreviewHost>,
    skipped_count: usize,
    source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SshProbeResult {
    pub reachable: bool,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

fn strip_inline_comment(line: &str) -> String {
    let mut result = String::new();
    let mut in_quotes = false;
    for ch in line.chars() {
        match ch {
            '"' => {
                in_quotes = !in_quotes;
                result.push(ch);
            }
            '#' if !in_quotes => break,
            _ => result.push(ch),
        }
    }
    result.trim().to_string()
}

fn strip_wrapping_quotes(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        trimmed[1..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

fn merge_settings(global: &BlockSettings, local: &BlockSettings) -> BlockSettings {
    BlockSettings {
        host_name: local.host_name.clone().or_else(|| global.host_name.clone()),
        user: local.user.clone().or_else(|| global.user.clone()),
        port: local.port.or(global.port),
        proxy_jump: local.proxy_jump.clone().or_else(|| global.proxy_jump.clone()),
        identity_file: local
            .identity_file
            .clone()
            .or_else(|| global.identity_file.clone()),
    }
}

fn looks_like_pattern(value: &str) -> bool {
    value.contains('*') || value.contains('?') || value.contains('!')
}

fn parse_host_aliases(value: &str) -> Vec<String> {
    value.split_whitespace()
        .map(strip_wrapping_quotes)
        .filter(|alias| !alias.is_empty() && !looks_like_pattern(alias))
        .collect()
}

fn expand_home_tokens(raw: &str) -> String {
    let home = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("~"))
        .to_string_lossy()
        .to_string();
    raw.replace("%d", &home)
        .replace("~/", &format!("{home}/"))
}

fn read_optional_text(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|content| content.trim().to_string())
        .filter(|content| !content.is_empty())
}

fn normalize_jump_alias(raw: &str) -> Option<String> {
    let first = raw.split(',').next()?.trim();
    if first.is_empty() {
        return None;
    }
    let without_user = first.rsplit('@').next().unwrap_or(first);
    let host = without_user.split(':').next().unwrap_or(without_user).trim();
    if host.is_empty() {
        None
    } else {
        Some(host.to_string())
    }
}

fn host_duplicate_key(label: &str, host: &str, port: u16, username: Option<&str>) -> String {
    [
        label.trim().to_lowercase(),
        host.trim().to_lowercase(),
        port.to_string(),
        username.unwrap_or("").trim().to_lowercase(),
    ]
    .join("|")
}

fn credential_duplicate_key(label: &str, username: &str, auth_method: &str, key_id: Option<&str>) -> String {
    [
        label.trim().to_lowercase(),
        username.trim().to_lowercase(),
        auth_method.to_string(),
        key_id.unwrap_or("").to_string(),
    ]
    .join("|")
}

fn ssh_key_duplicate_key(label: &str, public_key_content: Option<&str>) -> String {
    [
        label.trim().to_lowercase(),
        public_key_content.unwrap_or("").trim().to_string(),
    ]
    .join("|")
}

fn load_values(conn: &rusqlite::Connection, table: &str) -> Result<Vec<Value>, String> {
    let sql = format!("SELECT data FROM {table}");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .map(|r| {
            r.map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
        })
        .collect();
    rows
}

fn save_value(
    conn: &rusqlite::Connection,
    table: &str,
    id: &str,
    created_at: &str,
    updated_at: &str,
    value: &Value,
) -> Result<(), String> {
    let data = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let sql = format!(
        "INSERT OR REPLACE INTO {table} (id, data, created_at, updated_at) VALUES (?1, ?2, ?3, ?4)"
    );
    conn.execute(&sql, params![id, data, created_at, updated_at])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn build_import_plan(
    entries: &[ImportedSshConfigHost],
    existing_hosts: &[Value],
    existing_credentials: &[Value],
    existing_ssh_keys: &[Value],
) -> ImportPlan {
    let now = Utc::now().to_rfc3339();
    let mut existing_host_keys: HashMap<String, String> = HashMap::new();
    let mut existing_credential_keys: HashMap<String, String> = HashMap::new();
    let mut existing_ssh_key_keys: HashMap<String, String> = HashMap::new();

    for host in existing_hosts {
        let key = host_duplicate_key(
            host["label"].as_str().unwrap_or(""),
            host["host"].as_str().unwrap_or(""),
            host["port"].as_u64().unwrap_or(22) as u16,
            host["username"].as_str(),
        );
        if let Some(id) = host["id"].as_str() {
            existing_host_keys.insert(key, id.to_string());
        }
    }

    for credential in existing_credentials {
        let key = credential_duplicate_key(
            credential["label"].as_str().unwrap_or(""),
            credential["username"].as_str().unwrap_or(""),
            credential["authMethod"].as_str().unwrap_or("agent"),
            credential["keyId"].as_str(),
        );
        if let Some(id) = credential["id"].as_str() {
            existing_credential_keys.insert(key, id.to_string());
        }
    }

    for ssh_key in existing_ssh_keys {
        let key = ssh_key_duplicate_key(
            ssh_key["label"].as_str().unwrap_or(""),
            ssh_key["publicKeyContent"].as_str(),
        );
        if let Some(id) = ssh_key["id"].as_str() {
            existing_ssh_key_keys.insert(key, id.to_string());
        }
    }

    let mut hosts = Vec::new();
    let mut credentials = Vec::new();
    let mut ssh_keys = Vec::new();
    let mut preview_hosts = Vec::new();
    let mut jump_alias_by_host_id = HashMap::new();
    let mut skipped_count = 0;
    let mut source_path = None;

    for entry in entries {
        source_path.get_or_insert_with(|| entry.source_path.clone());
        let username = entry
            .username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let host_key = host_duplicate_key(&entry.alias, &entry.host, entry.port, username.as_deref());

        if existing_host_keys.contains_key(&host_key) {
            skipped_count += 1;
            continue;
        }

        let mut credential_id = None;
        let mut auth_method = "agent".to_string();

        if let Some(private_key_content) = entry
            .identity_file_content
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let ssh_key_label = format!("{} key", entry.alias);
            let ssh_key_key = ssh_key_duplicate_key(&ssh_key_label, entry.public_key_content.as_deref());
            let effective_key_id = if let Some(existing_id) = existing_ssh_key_keys.get(&ssh_key_key) {
                existing_id.clone()
            } else {
                let ssh_key_id = Uuid::new_v4().to_string();
                let ssh_key = json!({
                    "id": ssh_key_id,
                    "label": ssh_key_label,
                    "privateKeyContent": private_key_content,
                    "publicKeyContent": entry.public_key_content.as_deref().map(str::trim).filter(|value| !value.is_empty()),
                    "createdAt": now,
                    "updatedAt": now,
                });
                ssh_keys.push(ssh_key);
                existing_ssh_key_keys.insert(ssh_key_key, ssh_key_id.clone());
                ssh_key_id
            };

            let credential_label = format!("{} credential", entry.alias);
            let credential_key = credential_duplicate_key(
                &credential_label,
                username.as_deref().unwrap_or(""),
                "privateKey",
                Some(&effective_key_id),
            );
            credential_id = Some(if let Some(existing_id) = existing_credential_keys.get(&credential_key) {
                existing_id.clone()
            } else {
                let credential_id = Uuid::new_v4().to_string();
                let credential = json!({
                    "id": credential_id,
                    "label": credential_label,
                    "username": username.clone().unwrap_or_default(),
                    "authMethod": "privateKey",
                    "keyId": effective_key_id,
                    "createdAt": now,
                    "updatedAt": now,
                });
                credentials.push(credential);
                existing_credential_keys.insert(credential_key, credential_id.clone());
                credential_id
            });
            auth_method = "privateKey".to_string();
        } else if let Some(username_value) = username.as_deref() {
            let credential_label = format!("{} credential", entry.alias);
            let credential_key =
                credential_duplicate_key(&credential_label, username_value, "agent", None);
            credential_id = Some(if let Some(existing_id) = existing_credential_keys.get(&credential_key) {
                existing_id.clone()
            } else {
                let credential_id = Uuid::new_v4().to_string();
                let credential = json!({
                    "id": credential_id,
                    "label": credential_label,
                    "username": username_value,
                    "authMethod": "agent",
                    "createdAt": now,
                    "updatedAt": now,
                });
                credentials.push(credential);
                existing_credential_keys.insert(credential_key, credential_id.clone());
                credential_id
            });
        }

        let host_id = Uuid::new_v4().to_string();
        let host = json!({
            "id": host_id,
            "label": entry.alias,
            "host": entry.host,
            "port": entry.port,
            "username": username,
            "credentialId": credential_id,
            "authMethod": auth_method,
            "tags": ["ssh-config"],
            "notes": format!("Importado de {}", entry.source_path),
            "createdAt": now,
            "updatedAt": now,
            "sshCompat": { "preset": "modern" },
        });
        hosts.push(host);
        existing_host_keys.insert(host_key, host_id.clone());

        if let Some(jump_alias) = entry.proxy_jump.as_deref().and_then(normalize_jump_alias) {
            jump_alias_by_host_id.insert(host_id.clone(), jump_alias);
        }

        preview_hosts.push(ImportedSshConfigPreviewHost {
            alias: entry.alias.clone(),
            host: entry.host.clone(),
            port: entry.port,
            username: username.clone(),
            auth_method: auth_method.clone(),
            has_jump_host: jump_alias_by_host_id.contains_key(&host_id),
        });
    }

    let alias_to_host_id: HashMap<String, String> = hosts
        .iter()
        .filter_map(|host| {
            Some((
                host["label"].as_str()?.trim().to_lowercase(),
                host["id"].as_str()?.to_string(),
            ))
        })
        .collect();

    for host in &mut hosts {
        let Some(host_id) = host["id"].as_str() else {
            continue;
        };
        let Some(jump_alias) = jump_alias_by_host_id.get(host_id) else {
            continue;
        };
        if let Some(jump_host_id) = alias_to_host_id.get(&jump_alias.to_lowercase()) {
            if let Some(obj) = host.as_object_mut() {
                obj.insert("jumpHostId".to_string(), json!(jump_host_id));
            }
        }
    }

    ImportPlan {
        preview_hosts,
        source_path,
        skipped_count,
        credentials,
        ssh_keys,
        hosts,
    }
}

fn build_entry(
    alias: &str,
    settings: &BlockSettings,
    source_path: &Path,
) -> ImportedSshConfigHost {
    let host = settings
        .host_name
        .clone()
        .unwrap_or_else(|| alias.to_string());
    let identity_file_path = settings.identity_file.as_ref().map(|path| expand_home_tokens(path));
    let identity_file_content = identity_file_path
        .as_ref()
        .and_then(|path| read_optional_text(Path::new(path)));
    let public_key_content = identity_file_path.as_ref().and_then(|path| {
        let public_path = format!("{path}.pub");
        read_optional_text(Path::new(&public_path))
    });

    ImportedSshConfigHost {
        alias: alias.to_string(),
        host,
        port: settings.port.unwrap_or(22),
        username: settings.user.clone(),
        proxy_jump: settings.proxy_jump.clone(),
        identity_file_content,
        public_key_content,
        source_path: source_path.to_string_lossy().to_string(),
    }
}

fn flush_block(
    aliases: &[String],
    local: &BlockSettings,
    global: &BlockSettings,
    source_path: &Path,
    output: &mut Vec<ImportedSshConfigHost>,
) {
    if aliases.is_empty() {
        return;
    }
    let merged = merge_settings(global, local);
    for alias in aliases {
        output.push(build_entry(alias, &merged, source_path));
    }
}

fn parse_ssh_config_file(config_path: &Path) -> Result<Vec<ImportedSshConfigHost>, String> {
    let content = std::fs::read_to_string(config_path)
        .map_err(|e| format!("Falha ao ler {:?}: {e}", config_path))?;

    let mut output = Vec::new();
    let mut global_settings = BlockSettings::default();
    let mut current_aliases: Vec<String> = Vec::new();
    let mut current_settings = BlockSettings::default();

    for raw_line in content.lines() {
        let line = strip_inline_comment(raw_line);
        if line.is_empty() {
            continue;
        }

        let mut parts = line.split_whitespace();
        let Some(keyword) = parts.next() else {
            continue;
        };
        let value = line[keyword.len()..].trim();
        let key = keyword.to_ascii_lowercase();

        if key == "host" {
            flush_block(
                &current_aliases,
                &current_settings,
                &global_settings,
                config_path,
                &mut output,
            );
            current_aliases = parse_host_aliases(value);
            current_settings = BlockSettings::default();
            continue;
        }

        let target = if current_aliases.is_empty() {
            &mut global_settings
        } else {
            &mut current_settings
        };

        match key.as_str() {
            "hostname" => target.host_name = Some(strip_wrapping_quotes(value)),
            "user" => target.user = Some(strip_wrapping_quotes(value)),
            "port" => {
                target.port = strip_wrapping_quotes(value).parse::<u16>().ok();
            }
            "proxyjump" => target.proxy_jump = Some(strip_wrapping_quotes(value)),
            "identityfile" => {
                if target.identity_file.is_none() {
                    target.identity_file = Some(strip_wrapping_quotes(value));
                }
            }
            _ => {}
        }
    }

    flush_block(
        &current_aliases,
        &current_settings,
        &global_settings,
        config_path,
        &mut output,
    );

    let mut deduped = HashMap::new();
    for entry in output {
        deduped.insert(entry.alias.clone(), entry);
    }

    Ok(deduped.into_values().collect())
}

fn default_ssh_config_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Não foi possível determinar o diretório home do usuário")?;
    Ok(home.join(".ssh").join("config"))
}

#[tauri::command]
pub fn ssh_import_config(
    state: State<AppState>,
    path: Option<String>,
) -> Result<SshConfigImportPreview, String> {
    let config_path = path
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_ssh_config_path)?;

    if !config_path.exists() {
        return Err(format!(
            "Arquivo de configuração SSH não encontrado em {}",
            config_path.to_string_lossy()
        ));
    }

    let mut entries = parse_ssh_config_file(&config_path)?;
    entries.sort_by(|a, b| a.alias.to_lowercase().cmp(&b.alias.to_lowercase()));

    let conn = state
        .database
        .connection()
        .lock()
        .map_err(|e| e.to_string())?;
    let existing_hosts = load_values(&conn, "hosts")?;
    let existing_credentials = load_values(&conn, "credentials")?;
    let existing_ssh_keys = load_values(&conn, "ssh_keys")?;
    let plan = build_import_plan(&entries, &existing_hosts, &existing_credentials, &existing_ssh_keys);

    Ok(SshConfigImportPreview {
        imported_count: plan.hosts.len(),
        skipped_count: plan.skipped_count,
        credentials_count: plan.credentials.len(),
        ssh_keys_count: plan.ssh_keys.len(),
        source_path: plan.source_path,
        hosts: plan.preview_hosts,
    })
}

#[tauri::command]
pub fn ssh_apply_imported_config(
    state: State<AppState>,
    path: Option<String>,
) -> Result<SshConfigImportResult, String> {
    let config_path = path
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(default_ssh_config_path)?;

    if !config_path.exists() {
        return Err(format!(
            "Arquivo de configuração SSH não encontrado em {}",
            config_path.to_string_lossy()
        ));
    }

    let mut entries = parse_ssh_config_file(&config_path)?;
    entries.sort_by(|a, b| a.alias.to_lowercase().cmp(&b.alias.to_lowercase()));

    let conn = state
        .database
        .connection()
        .lock()
        .map_err(|e| e.to_string())?;
    let existing_hosts = load_values(&conn, "hosts")?;
    let existing_credentials = load_values(&conn, "credentials")?;
    let existing_ssh_keys = load_values(&conn, "ssh_keys")?;
    let plan = build_import_plan(&entries, &existing_hosts, &existing_credentials, &existing_ssh_keys);

    for ssh_key in &plan.ssh_keys {
        save_value(
            &conn,
            "ssh_keys",
            ssh_key["id"].as_str().ok_or("SshKey sem id")?,
            ssh_key["createdAt"].as_str().unwrap_or(""),
            ssh_key["updatedAt"].as_str().unwrap_or(""),
            ssh_key,
        )?;
    }

    for credential in &plan.credentials {
        save_value(
            &conn,
            "credentials",
            credential["id"].as_str().ok_or("Credential sem id")?,
            credential["createdAt"].as_str().unwrap_or(""),
            credential["updatedAt"].as_str().unwrap_or(""),
            credential,
        )?;
    }

    for host in &plan.hosts {
        save_value(
            &conn,
            "hosts",
            host["id"].as_str().ok_or("Host sem id")?,
            host["createdAt"].as_str().unwrap_or(""),
            host["updatedAt"].as_str().unwrap_or(""),
            host,
        )?;
    }

    Ok(SshConfigImportResult {
        imported_count: plan.hosts.len(),
        skipped_count: plan.skipped_count,
        credentials_count: plan.credentials.len(),
        ssh_keys_count: plan.ssh_keys.len(),
        source_path: plan.source_path,
    })
}

#[tauri::command]
pub async fn ssh_probe_host(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<SshProbeResult, String> {
    state.rate_limiter.check("ssh_probe_host", 20, std::time::Duration::from_secs(60))?;
    let started = Instant::now();
    let timeout_duration = Duration::from_millis(timeout_ms.unwrap_or(4000));

    match timeout(timeout_duration, TcpStream::connect((host.as_str(), port))).await {
        Ok(Ok(_stream)) => Ok(SshProbeResult {
            reachable: true,
            latency_ms: Some(started.elapsed().as_millis() as u64),
            error: None,
        }),
        Ok(Err(error)) => Ok(SshProbeResult {
            reachable: false,
            latency_ms: None,
            error: Some(error.to_string()),
        }),
        Err(_) => Ok(SshProbeResult {
            reachable: false,
            latency_ms: None,
            error: Some("timeout".to_string()),
        }),
    }
}
