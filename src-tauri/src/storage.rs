use std::path::PathBuf;
use tauri::AppHandle;

const APP_DATA_DIR_NAME: &str = "mpcm-workspace";
const LEGACY_APP_DATA_DIR_NAME: &str = "ssh-vault";
pub const INTERNAL_RDP_SETTINGS_FILE_NAME: &str = "internal-rdp-client-settings.json";

pub struct Storage {
    pub data_dir: PathBuf,
}

fn resolve_app_data_dir() -> Result<PathBuf, String> {
    let base_dir = dirs::data_dir().ok_or("Não foi possível determinar o diretório de dados")?;
    resolve_app_data_dir_in(&base_dir)
}

fn resolve_app_data_dir_in(base_dir: &std::path::Path) -> Result<PathBuf, String> {
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

pub fn internal_rdp_settings_path(data_dir: &std::path::Path) -> PathBuf {
    data_dir.join(INTERNAL_RDP_SETTINGS_FILE_NAME)
}

/// Retorna o diretório de dados da aplicação
#[tauri::command]
pub fn get_app_data_dir(_app: AppHandle) -> Result<String, String> {
    let dir = resolve_app_data_dir()?;
    Ok(dir.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_base_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("mpcm-storage-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn returns_existing_data_dir_without_touching_legacy() {
        let base = temp_base_dir();
        let data_dir = base.join(APP_DATA_DIR_NAME);
        let legacy_dir = base.join(LEGACY_APP_DATA_DIR_NAME);
        std::fs::create_dir_all(&data_dir).unwrap();
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(legacy_dir.join("legacy.txt"), "legado").unwrap();

        let resolved = resolve_app_data_dir_in(&base).unwrap();

        assert_eq!(resolved, data_dir);
        // Diretório legado permanece intacto quando o novo já existe
        assert!(legacy_dir.join("legacy.txt").exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn migrates_legacy_dir_when_data_dir_is_missing() {
        let base = temp_base_dir();
        let legacy_dir = base.join(LEGACY_APP_DATA_DIR_NAME);
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(legacy_dir.join("vault.db"), "conteudo").unwrap();

        let resolved = resolve_app_data_dir_in(&base).unwrap();

        assert_eq!(resolved, base.join(APP_DATA_DIR_NAME));
        assert_eq!(
            std::fs::read_to_string(resolved.join("vault.db")).unwrap(),
            "conteudo"
        );
        assert!(!legacy_dir.exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn returns_data_dir_path_without_creating_it_when_nothing_exists() {
        let base = temp_base_dir();

        let resolved = resolve_app_data_dir_in(&base).unwrap();

        assert_eq!(resolved, base.join(APP_DATA_DIR_NAME));
        assert!(!resolved.exists());

        let _ = std::fs::remove_dir_all(&base);
    }

    #[test]
    fn internal_rdp_settings_path_joins_file_name() {
        let path = internal_rdp_settings_path(std::path::Path::new("/tmp/data"));
        assert_eq!(
            path,
            PathBuf::from("/tmp/data").join(INTERNAL_RDP_SETTINGS_FILE_NAME)
        );
    }
}
