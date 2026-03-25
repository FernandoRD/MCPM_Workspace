use std::path::PathBuf;
use tauri::AppHandle;

pub struct Storage {
    pub data_dir: PathBuf,
}

impl Storage {
    pub fn new() -> Result<Self, String> {
        let data_dir = dirs::data_dir()
            .ok_or("Não foi possível determinar o diretório de dados")?
            .join("ssh-vault");

        std::fs::create_dir_all(&data_dir)
            .map_err(|e| format!("Falha ao criar diretório de dados: {e}"))?;

        Ok(Self { data_dir })
    }
}

/// Retorna o diretório de dados da aplicação
#[tauri::command]
pub fn get_app_data_dir(_app: AppHandle) -> Result<String, String> {
    let dir = dirs::data_dir()
        .ok_or("Não foi possível determinar o diretório de dados")?
        .join("ssh-vault");
    Ok(dir.to_string_lossy().to_string())
}
