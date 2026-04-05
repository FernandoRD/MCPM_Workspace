use serde::{Deserialize, Serialize};
use tauri::State;

use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickConnectBootstrapPayload {
    pub host_id: String,
    pub host_label: String,
    pub host_address: String,
    pub connection_host: String,
    pub connection_port: u16,
    pub connection_username: String,
    pub connection_auth_method: String,
    pub connection_password: Option<String>,
    pub connection_private_key_content: Option<String>,
    pub connection_passphrase: Option<String>,
}

#[tauri::command]
pub fn store_quick_connect_bootstrap(
    state: State<AppState>,
    bootstrap_id: String,
    payload: QuickConnectBootstrapPayload,
) -> Result<(), String> {
    let mut bootstraps = state
        .quick_connect_bootstraps
        .lock()
        .map_err(|e| e.to_string())?;
    bootstraps.insert(bootstrap_id, payload);
    Ok(())
}

#[tauri::command]
pub fn get_quick_connect_bootstrap(
    state: State<AppState>,
    bootstrap_id: String,
) -> Result<Option<QuickConnectBootstrapPayload>, String> {
    let mut bootstraps = state
        .quick_connect_bootstraps
        .lock()
        .map_err(|e| e.to_string())?;
    Ok(bootstraps.remove(&bootstrap_id))
}
