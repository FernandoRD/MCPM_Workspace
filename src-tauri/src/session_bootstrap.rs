use serde::{Deserialize, Serialize};
use tauri::State;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::AppState;

/// Payload de bootstrap de conexão rápida.
/// Campos sensíveis (senha, chave privada, passphrase) são zerados na memória
/// quando a struct é descartada, minimizando o tempo de exposição em RAM.
#[derive(Debug, Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct QuickConnectBootstrapPayload {
    #[zeroize(skip)]
    pub host_id: String,
    #[zeroize(skip)]
    pub host_label: String,
    #[zeroize(skip)]
    pub host_address: String,
    #[zeroize(skip)]
    pub connection_protocol: String,
    #[zeroize(skip)]
    pub connection_host: String,
    #[zeroize(skip)]
    pub connection_port: u16,
    #[zeroize(skip)]
    pub connection_username: String,
    #[zeroize(skip)]
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
