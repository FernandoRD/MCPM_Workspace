mod credentials;
mod crypto;
mod database;
mod rate_limit;
mod rdp;
mod session_bootstrap;
mod sftp;
mod ssh;
mod ssh_config;
mod storage;
mod sync;
mod telnet;
mod totp;
mod vnc;

use database::Database;
use session_bootstrap::QuickConnectBootstrapPayload;
use rdp::RdpManager;
use sftp::SftpManager;
use ssh::SshManager;
use storage::Storage;
use telnet::TelnetManager;
use vnc::VncManager;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct AppState {
    pub storage: Mutex<Storage>,
    pub database: Database,
    pub quick_connect_bootstraps: Mutex<HashMap<String, QuickConnectBootstrapPayload>>,
    pub ssh: Arc<tokio::sync::Mutex<SshManager>>,
    pub telnet: Arc<tokio::sync::Mutex<TelnetManager>>,
    pub sftp: Arc<tokio::sync::Mutex<SftpManager>>,
    pub rdp: Arc<tokio::sync::Mutex<RdpManager>>,
    pub vnc: Arc<tokio::sync::Mutex<VncManager>>,
    pub rate_limiter: rate_limit::RateLimiter,
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
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            storage: Mutex::new(storage),
            database,
            quick_connect_bootstraps: Mutex::new(HashMap::new()),
            ssh: Arc::new(tokio::sync::Mutex::new(SshManager::new())),
            telnet: Arc::new(tokio::sync::Mutex::new(TelnetManager::new())),
            sftp: Arc::new(tokio::sync::Mutex::new(SftpManager::new())),
            rdp: Arc::new(tokio::sync::Mutex::new(RdpManager::new())),
            vnc: Arc::new(tokio::sync::Mutex::new(VncManager::new())),
            rate_limiter: rate_limit::RateLimiter::new(),
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
            session_bootstrap::store_quick_connect_bootstrap,
            session_bootstrap::get_quick_connect_bootstrap,
            ssh::ssh_connect,
            ssh::ssh_send_input,
            ssh::ssh_resize,
            ssh::ssh_disconnect,
            ssh::ssh_session_exists,
            ssh::ssh_trust_host,
            ssh::ssh_copy_id,
            ssh::ssh_generate_key,
            ssh::ssh_exec,
            ssh::ssh_start_tunnel,
            ssh::ssh_stop_tunnel,
            ssh::ssh_list_known_hosts,
            ssh::ssh_set_known_host,
            ssh::ssh_delete_known_host,
            ssh::ssh_health_check,
            telnet::telnet_connect,
            telnet::telnet_send_input,
            telnet::telnet_resize,
            telnet::telnet_disconnect,
            telnet::telnet_session_exists,
            rdp::rdp_connect,
            rdp::rdp_launch_internal_viewer,
            rdp::rdp_disconnect,
            rdp::rdp_session_exists,
            vnc::vnc_connect,
            vnc::vnc_disconnect,
            vnc::vnc_session_exists,
            ssh_config::ssh_import_config,
            ssh_config::ssh_apply_imported_config,
            ssh_config::ssh_probe_host,
            sftp::sftp_connect,
            sftp::sftp_read_dir,
            sftp::sftp_download,
            sftp::sftp_upload,
            sftp::sftp_mkdir,
            sftp::sftp_delete,
            sftp::sftp_rename,
            sftp::sftp_disconnect,
            sftp::sftp_session_exists,
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
        .expect("Erro ao inicializar MPCM Workspace");
}
