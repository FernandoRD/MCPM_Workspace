use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

#[derive(Debug, Clone, Default)]
struct BlockSettings {
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    proxy_jump: Option<String>,
    identity_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportedSshConfigHost {
    pub alias: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub proxy_jump: Option<String>,
    pub identity_file_path: Option<String>,
    pub identity_file_content: Option<String>,
    pub public_key_content: Option<String>,
    pub source_path: String,
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
        identity_file_path,
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
pub fn ssh_import_config(path: Option<String>) -> Result<Vec<ImportedSshConfigHost>, String> {
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
    Ok(entries)
}

#[tauri::command]
pub async fn ssh_probe_host(
    host: String,
    port: u16,
    timeout_ms: Option<u64>,
) -> Result<SshProbeResult, String> {
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
