mod credentials;
mod crypto;
mod database;
mod sftp;
mod ssh;
mod storage;
mod sync;
mod totp;

use database::Database;
use sftp::SftpManager;
use ssh::SshManager;
use storage::Storage;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub database: Database,
    pub ssh: Arc<tokio::sync::Mutex<SshManager>>,
    pub sftp: Arc<tokio::sync::Mutex<SftpManager>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let storage = Storage::new().expect("Falha ao inicializar storage");
    let database =
        Database::open(&storage.data_dir).expect("Falha ao inicializar banco de dados");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            storage: Mutex::new(storage),
            database,
            ssh: Arc::new(tokio::sync::Mutex::new(SshManager::new())),
            sftp: Arc::new(tokio::sync::Mutex::new(SftpManager::new())),
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
            ssh::ssh_copy_id,
            ssh::ssh_generate_key,
            sftp::sftp_connect,
            sftp::sftp_read_dir,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::sftp_mkdir,
            sftp::sftp_delete,
            sftp::sftp_rename,
            sftp::sftp_disconnect,
            database::db_get_hosts,
            database::db_save_host,
            database::db_delete_host,
            database::db_clear_hosts,
            database::db_get_settings,
            database::db_save_settings,
            database::db_get_credentials,
            database::db_save_credential,
            database::db_delete_credential,
            database::db_clear_credentials,
            database::db_get_ssh_keys,
            database::db_save_ssh_key,
            database::db_delete_ssh_key,
            database::db_clear_ssh_keys,
            database::db_add_connection_log,
            database::db_get_connection_logs,
            database::db_clear_connection_logs,
            sync::sync_gist_push,
            sync::sync_gist_pull,
            sync::sync_webdav_push,
            sync::sync_webdav_pull,
            sync::sync_s3_push,
            sync::sync_s3_pull,
            sync::sync_custom_push,
            sync::sync_custom_pull,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao inicializar SSH Vault");
}
