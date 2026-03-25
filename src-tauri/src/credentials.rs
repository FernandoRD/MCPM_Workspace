use keyring::Entry;

const SERVICE: &str = "ssh-vault";

/// Salva uma credencial no keychain do sistema operacional
#[tauri::command]
pub fn save_credential(key: String, value: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

/// Recupera uma credencial do keychain
#[tauri::command]
pub fn get_credential(key: String) -> Result<String, String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

/// Remove uma credencial do keychain
#[tauri::command]
pub fn delete_credential(key: String) -> Result<(), String> {
    let entry = Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.delete_credential().map_err(|e| e.to_string())
}
