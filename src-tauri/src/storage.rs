use std::path::PathBuf;
use tauri::AppHandle;

const APP_DATA_DIR_NAME: &str = "mpcm-workspace";
const LEGACY_APP_DATA_DIR_NAME: &str = "ssh-vault";

pub struct Storage {
    pub data_dir: PathBuf,
}

fn resolve_app_data_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir()
        .ok_or("Não foi possível determinar o diretório de dados")?;
    let data_dir = base_dir.join(APP_DATA_DIR_NAME);
    let legacy_dir = base_dir.join(LEGACY_APP_DATA_DIR_NAME);

    if data_dir.exists() {
        return Ok(data_dir);
    }

    if legacy_dir.exists() {
        std::fs::rename(&legacy_dir, &data_dir)
            .or_else(|_| {
                std::fs::create_dir_all(&data_dir)?;
                for entry in std::fs::read_dir(&legacy_dir)? {
                    let entry = entry?;
                    let target = data_dir.join(entry.file_name());
                    if target.exists() {
                        continue;
                    }
                    std::fs::rename(entry.path(), target)?;
                }
                std::fs::remove_dir_all(&legacy_dir)
            })
            .map_err(|e| format!("Falha ao migrar diretório legado da aplicação: {e}"))?;

        return Ok(data_dir);
    }

    Ok(data_dir)
}

impl Storage {
    pub fn new() -> Result<Self, String> {
        let data_dir = resolve_app_data_dir()?;

        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Falha ao criar diretório de dados: {e}"))?;

        Ok(Self { data_dir })
    }
}

/// Retorna o diretório de dados da aplicação
#[tauri::command]
pub fn get_app_data_dir(_app: AppHandle) -> Result<String, String> {
    let dir = resolve_app_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}
