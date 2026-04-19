use std::backtrace::Backtrace;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use chrono::{DateTime, Local};
use log::{Level, LevelFilter, Log, Metadata, Record};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::AppState;

const LOG_DIR_NAME: &str = "logs";
const LOG_FILE_NAME: &str = "ssh_vault.log";
const ROTATED_LOG_FILE_NAME: &str = "ssh_vault.log.1";
const VIEWER_LOG_FILE_NAME: &str = "ssh_vault_viewer.log";
const LOG_SETTINGS_FILE_NAME: &str = "logging-settings.json";
const MAX_LOG_SIZE_BYTES: u64 = 5 * 1024 * 1024;
const MAX_READ_BYTES: usize = 512 * 1024;

static LOGGER: OnceLock<AppLogger> = OnceLock::new();

#[derive(Default, Serialize, Deserialize)]
struct LoggingConfigFile {
    directory: Option<String>,
}

struct LoggerOutput {
    directory: PathBuf,
    file_path: PathBuf,
    file: File,
}

struct AppLogger {
    output: Mutex<LoggerOutput>,
    level: LevelFilter,
    config_path: PathBuf,
    default_directory: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSettingsInfo {
    current_directory: String,
    default_directory: String,
    using_custom_directory: bool,
    log_file_path: String,
    rotated_log_file_path: String,
    viewer_log_file_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileSummary {
    name: String,
    path: String,
    size_bytes: u64,
    modified_at: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogFileContent {
    name: String,
    path: String,
    size_bytes: u64,
    modified_at: Option<String>,
    content: String,
    truncated: bool,
}

impl AppLogger {
    fn new(data_dir: &Path, level: LevelFilter) -> Result<Self, String> {
        let config_path = logging_config_path(data_dir);
        let default_directory = default_log_directory(data_dir);
        let configured_directory = configured_directory_from_file(data_dir)?.unwrap_or_else(|| default_directory.clone());
        let output = open_logger_output(&configured_directory)?;

        Ok(Self {
            output: Mutex::new(output),
            level,
            config_path,
            default_directory,
        })
    }

    fn write_line(&self, line: &str) {
        if let Ok(mut output) = self.output.lock() {
            let _ = writeln!(output.file, "{line}");
            let _ = output.file.flush();
        }
    }

    fn flush_output(&self) {
        if let Ok(mut output) = self.output.lock() {
            let _ = output.file.flush();
        }
    }

    fn format_record(record: &Record<'_>) -> String {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f%:z");
        format!(
            "{timestamp} [{}] {} - {}",
            record.level(),
            record.target(),
            record.args()
        )
    }

    fn settings_info(&self) -> Result<LogSettingsInfo, String> {
        let output = self.output.lock().map_err(|e| e.to_string())?;
        Ok(LogSettingsInfo {
            current_directory: output.directory.to_string_lossy().to_string(),
            default_directory: self.default_directory.to_string_lossy().to_string(),
            using_custom_directory: normalize_path_string(&output.directory) != normalize_path_string(&self.default_directory),
            log_file_path: output.file_path.to_string_lossy().to_string(),
            rotated_log_file_path: rotated_log_file_path(&output.directory)
                .to_string_lossy()
                .to_string(),
            viewer_log_file_path: viewer_log_file_path(&output.directory)
                .to_string_lossy()
                .to_string(),
        })
    }

    fn list_log_files(&self) -> Result<Vec<LogFileSummary>, String> {
        let directory = self
            .output
            .lock()
            .map_err(|e| e.to_string())?
            .directory
            .clone();
        list_log_files_in_directory(&directory)
    }

    fn read_log_file(&self, file_name: &str) -> Result<LogFileContent, String> {
        let directory = self
            .output
            .lock()
            .map_err(|e| e.to_string())?
            .directory
            .clone();
        read_log_file_from_directory(&directory, file_name)
    }

    fn reconfigure_directory(&self, directory: Option<String>) -> Result<LogSettingsInfo, String> {
        let normalized_directory = normalize_configured_directory(directory)?;
        persist_logging_config(&self.config_path, normalized_directory.as_deref())?;
        let target_directory = normalized_directory
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or_else(|| self.default_directory.clone());
        let new_output = open_logger_output(&target_directory)?;
        let mut output = self.output.lock().map_err(|e| e.to_string())?;
        *output = new_output;
        drop(output);

        self.settings_info()
    }

    fn current_directory(&self) -> Option<PathBuf> {
        self.output.lock().ok().map(|output| output.directory.clone())
    }

    fn current_log_file_path(&self) -> Option<PathBuf> {
        self.output.lock().ok().map(|output| output.file_path.clone())
    }
}

impl Log for AppLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= self.level
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let line = Self::format_record(record);
        self.write_line(&line);

        if record.level() <= Level::Warn {
            eprintln!("{line}");
        }
    }

    fn flush(&self) {
        self.flush_output();
    }
}

fn default_level() -> LevelFilter {
    if cfg!(debug_assertions) {
        LevelFilter::Debug
    } else {
        LevelFilter::Info
    }
}

fn default_log_directory(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_DIR_NAME)
}

fn logging_config_path(data_dir: &Path) -> PathBuf {
    data_dir.join(LOG_SETTINGS_FILE_NAME)
}

fn main_log_file_path(directory: &Path) -> PathBuf {
    directory.join(LOG_FILE_NAME)
}

fn rotated_log_file_path(directory: &Path) -> PathBuf {
    directory.join(ROTATED_LOG_FILE_NAME)
}

fn viewer_log_file_path(directory: &Path) -> PathBuf {
    directory.join(VIEWER_LOG_FILE_NAME)
}

fn normalize_path_string(path: &Path) -> String {
    path.components()
        .collect::<PathBuf>()
        .to_string_lossy()
        .to_string()
}

fn open_log_file(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| format!("Falha ao abrir arquivo de log {}: {e}", path.display()))
}

fn rotate_log_if_needed(path: &Path) -> Result<(), String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(err) => {
            return Err(format!(
                "Falha ao obter metadados do log {}: {err}",
                path.display()
            ))
        }
    };

    if metadata.len() < MAX_LOG_SIZE_BYTES {
        return Ok(());
    }

    let parent = path
        .parent()
        .ok_or_else(|| format!("Caminho de log inválido: {}", path.display()))?;
    let rotated_path = rotated_log_file_path(parent);

    if rotated_path.exists() {
        fs::remove_file(&rotated_path).map_err(|e| {
            format!(
                "Falha ao remover log rotacionado {}: {e}",
                rotated_path.display()
            )
        })?;
    }

    fs::rename(path, &rotated_path).map_err(|e| {
        format!(
            "Falha ao rotacionar log {} -> {}: {e}",
            path.display(),
            rotated_path.display()
        )
    })
}

fn open_logger_output(directory: &Path) -> Result<LoggerOutput, String> {
    fs::create_dir_all(directory).map_err(|e| {
        format!(
            "Falha ao criar diretório de logs {}: {e}",
            directory.display()
        )
    })?;

    let file_path = main_log_file_path(directory);
    rotate_log_if_needed(&file_path)?;
    let file = open_log_file(&file_path)?;

    Ok(LoggerOutput {
        directory: directory.to_path_buf(),
        file_path,
        file,
    })
}

fn configured_directory_from_file(data_dir: &Path) -> Result<Option<PathBuf>, String> {
    let path = logging_config_path(data_dir);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(err) => {
            return Err(format!(
                "Falha ao ler configuração de logging {}: {err}",
                path.display()
            ))
        }
    };

    let config: LoggingConfigFile = serde_json::from_str(&text).map_err(|e| {
        format!(
            "Falha ao interpretar configuração de logging {}: {e}",
            path.display()
        )
    })?;

    Ok(config.directory.and_then(|directory| {
        let trimmed = directory.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    }))
}

fn normalize_configured_directory(directory: Option<String>) -> Result<Option<String>, String> {
    match directory {
        Some(directory) => {
            let trimmed = directory.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                let path = PathBuf::from(trimmed);
                if !path.is_absolute() {
                    return Err("O diretório de logs precisa ser um caminho absoluto.".to_string());
                }
                Ok(Some(path.to_string_lossy().to_string()))
            }
        }
        None => Ok(None),
    }
}

fn persist_logging_config(path: &Path, directory: Option<&str>) -> Result<(), String> {
    let payload = LoggingConfigFile {
        directory: directory.map(|value| value.to_string()),
    };
    let json = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| {
        format!(
            "Falha ao salvar configuração de logging {}: {e}",
            path.display()
        )
    })
}

fn write_direct(path: &Path, line: &str) {
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

fn current_main_log_file_path() -> Option<PathBuf> {
    LOGGER.get().and_then(|logger| logger.current_log_file_path())
}

fn panic_payload(info: &std::panic::PanicHookInfo<'_>) -> String {
    if let Some(message) = info.payload().downcast_ref::<&str>() {
        (*message).to_string()
    } else if let Some(message) = info.payload().downcast_ref::<String>() {
        message.clone()
    } else {
        "panic sem payload textual".to_string()
    }
}

fn install_panic_hook() {
    std::panic::set_hook(Box::new(move |info| {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S%.3f%:z");
        let location = info
            .location()
            .map(|loc| format!("{}:{}:{}", loc.file(), loc.line(), loc.column()))
            .unwrap_or_else(|| "local desconhecido".to_string());
        let payload = panic_payload(info);
        let backtrace = Backtrace::force_capture();
        let line = format!(
            "{timestamp} [ERROR] panic - panic em {location}: {payload}\n{backtrace}"
        );

        if let Some(path) = current_main_log_file_path() {
            write_direct(&path, &line);
        }
        eprintln!("{line}");
    }));
}

fn metadata_modified_iso(metadata: &fs::Metadata) -> Option<String> {
    metadata
        .modified()
        .ok()
        .map(DateTime::<Local>::from)
        .map(|dt| dt.to_rfc3339())
}

fn is_managed_log_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    matches!(
        name,
        LOG_FILE_NAME | ROTATED_LOG_FILE_NAME | VIEWER_LOG_FILE_NAME
    )
}

fn list_log_files_in_directory(directory: &Path) -> Result<Vec<LogFileSummary>, String> {
    let mut files = Vec::new();
    if !directory.exists() {
        return Ok(files);
    }

    for entry in fs::read_dir(directory).map_err(|e| {
        format!(
            "Falha ao listar diretório de logs {}: {e}",
            directory.display()
        )
    })? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() || !is_managed_log_file(&path) {
            continue;
        }

        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        files.push(LogFileSummary {
            name: path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_string(),
            path: path.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
            modified_at: metadata_modified_iso(&metadata),
        });
    }

    files.sort_by(|a, b| {
        b.modified_at
            .cmp(&a.modified_at)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(files)
}

fn read_log_file_from_directory(directory: &Path, file_name: &str) -> Result<LogFileContent, String> {
    let trimmed = file_name.trim();
    if trimmed.is_empty()
        || Path::new(trimmed)
            .components()
            .count()
            != 1
    {
        return Err("Nome de arquivo de log inválido.".to_string());
    }
    let path = directory.join(trimmed);
    if !is_managed_log_file(&path) {
        return Err("Arquivo de log não permitido.".to_string());
    }

    let metadata = fs::metadata(&path).map_err(|e| {
        format!("Falha ao obter metadados do arquivo {}: {e}", path.display())
    })?;
    let bytes = fs::read(&path).map_err(|e| {
        format!("Falha ao ler arquivo de log {}: {e}", path.display())
    })?;

    let (slice, truncated) = if bytes.len() > MAX_READ_BYTES {
        (&bytes[bytes.len() - MAX_READ_BYTES..], true)
    } else {
        (&bytes[..], false)
    };

    Ok(LogFileContent {
        name: trimmed.to_string(),
        path: path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified_at: metadata_modified_iso(&metadata),
        content: String::from_utf8_lossy(slice).to_string(),
        truncated,
    })
}

pub fn init(data_dir: &Path) -> Result<PathBuf, String> {
    if LOGGER.get().is_none() {
        let logger = AppLogger::new(data_dir, default_level())?;
        let _ = LOGGER.set(logger);
    }

    if let Some(logger) = LOGGER.get() {
        let _ = log::set_logger(logger);
        log::set_max_level(logger.level);
        install_panic_hook();
        return logger
            .current_log_file_path()
            .ok_or_else(|| "Logger sem caminho de arquivo ativo".to_string());
    }

    Err("Logger global não foi inicializado".to_string())
}

pub fn viewer_log_path() -> Option<PathBuf> {
    LOGGER
        .get()
        .and_then(|logger| logger.current_directory())
        .map(|directory| viewer_log_file_path(&directory))
}

#[tauri::command]
pub fn write_frontend_log(
    level: String,
    source: String,
    message: String,
    context: Option<Value>,
) -> Result<(), String> {
    let source = {
        let trimmed = source.trim();
        if trimmed.is_empty() {
            "frontend".to_string()
        } else {
            trimmed.to_string()
        }
    };
    let message = message.trim();
    let mut composed = message.to_string();

    if let Some(context) = context.filter(|value| !value.is_null()) {
        composed.push_str(" | context=");
        composed.push_str(&context.to_string());
    }

    match level.trim().to_ascii_lowercase().as_str() {
        "trace" => log::trace!(target: &source, "{composed}"),
        "debug" => log::debug!(target: &source, "{composed}"),
        "warn" | "warning" => log::warn!(target: &source, "{composed}"),
        "error" => log::error!(target: &source, "{composed}"),
        _ => log::info!(target: &source, "{composed}"),
    }

    Ok(())
}

#[tauri::command]
pub fn app_get_log_settings(state: State<'_, AppState>) -> Result<LogSettingsInfo, String> {
    let _ = state;
    LOGGER
        .get()
        .ok_or_else(|| "Logger não inicializado".to_string())?
        .settings_info()
}

#[tauri::command]
pub fn app_set_log_directory(
    state: State<'_, AppState>,
    directory: Option<String>,
) -> Result<LogSettingsInfo, String> {
    let _ = state;
    let info = LOGGER
        .get()
        .ok_or_else(|| "Logger não inicializado".to_string())?
        .reconfigure_directory(directory)?;
    log::info!(
        "logging: diretório atualizado para {}",
        info.current_directory
    );
    Ok(info)
}

#[tauri::command]
pub fn app_list_log_files(state: State<'_, AppState>) -> Result<Vec<LogFileSummary>, String> {
    let _ = state;
    LOGGER
        .get()
        .ok_or_else(|| "Logger não inicializado".to_string())?
        .list_log_files()
}

#[tauri::command]
pub fn app_read_log_file(
    state: State<'_, AppState>,
    file_name: String,
) -> Result<LogFileContent, String> {
    let _ = state;
    LOGGER
        .get()
        .ok_or_else(|| "Logger não inicializado".to_string())?
        .read_log_file(&file_name)
}
