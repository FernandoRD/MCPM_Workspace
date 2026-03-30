mod credentials;
mod crypto;
mod ssh;
mod storage;
mod totp;

use ssh::SshManager;
use storage::Storage;
use std::sync::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub ssh: Arc<tokio::sync::Mutex<SshManager>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage = Storage::new().expect("Falha ao inicializar storage");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            storage: Mutex::new(storage),
            ssh: Arc::new(tokio::sync::Mutex::new(SshManager::new())),
        })
        .invoke_handler(tauri::generate_handler![
            storage::get_app_data_dir,
            credentials::save_credential,
            credentials::get_credential,
            credentials::delete_credential,
            crypto::encrypt_credentials,
            crypto::decrypt_credentials,
            crypto::verify_master_password,
            totp::generate_totp_code,
            totp::verify_totp_code,
            totp::generate_totp_secret,
            ssh::ssh_connect,
            ssh::ssh_send_input,
            ssh::ssh_resize,
            ssh::ssh_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao inicializar SSH Vault");
}
