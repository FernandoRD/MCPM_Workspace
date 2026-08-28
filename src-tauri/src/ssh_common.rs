//! Utilitários SSH compartilhados entre `ssh.rs` e `sftp.rs`.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::{cipher, client, compression, kex, mac, Preferred};
use russh_keys::key::PublicKey;

// ─── Algoritmos legado ────────────────────────────────────────────────────────

// KEX: inclui DH-Group14-SHA1 para servidores com OpenSSH ≤ 7
static LEGACY_KEX: &[kex::Name] = &[
    kex::CURVE25519,
    kex::CURVE25519_PRE_RFC_8731,
    kex::DH_G16_SHA512,
    kex::DH_G14_SHA256,
    kex::ECDH_SHA2_NISTP256,
    kex::ECDH_SHA2_NISTP384,
    kex::ECDH_SHA2_NISTP521,
    kex::DH_G14_SHA1,
];

// KEX muito legado: adiciona DH-Group1-SHA1 (CentOS 5, RHEL 5)
static VERY_LEGACY_KEX: &[kex::Name] = &[
    kex::CURVE25519,
    kex::CURVE25519_PRE_RFC_8731,
    kex::DH_G16_SHA512,
    kex::DH_G14_SHA256,
    kex::ECDH_SHA2_NISTP256,
    kex::ECDH_SHA2_NISTP384,
    kex::ECDH_SHA2_NISTP521,
    kex::DH_G14_SHA1,
    kex::DH_G1_SHA1,
];

static LEGACY_CIPHER: &[cipher::Name] = &[
    cipher::CHACHA20_POLY1305,
    cipher::AES_256_GCM,
    cipher::AES_256_CTR,
    cipher::AES_192_CTR,
    cipher::AES_128_CTR,
    cipher::AES_256_CBC,
    cipher::AES_192_CBC,
    cipher::AES_128_CBC,
];

static LEGACY_MAC: &[mac::Name] = &[
    mac::HMAC_SHA256_ETM,
    mac::HMAC_SHA512_ETM,
    mac::HMAC_SHA256,
    mac::HMAC_SHA512,
    mac::HMAC_SHA1_ETM,
    mac::HMAC_SHA1,
];

static LEGACY_KEY: &[russh_keys::key::Name] = &[
    russh_keys::key::ED25519,
    russh_keys::key::ECDSA_SHA2_NISTP256,
    russh_keys::key::ECDSA_SHA2_NISTP384,
    russh_keys::key::ECDSA_SHA2_NISTP521,
    russh_keys::key::RSA_SHA2_256,
    russh_keys::key::RSA_SHA2_512,
    russh_keys::key::SSH_RSA,
];

static LEGACY_COMPRESSION: &[compression::Name] = &[compression::NONE];

// ─── Configuração SSH ─────────────────────────────────────────────────────────

/// Constrói um `client::Config` com preset de compatibilidade, keepalive e timeout.
/// Compartilhado entre sessões SSH de terminal e SFTP.
pub fn build_ssh_config(
    preset: &str,
    keepalive_secs: u32,
    timeout_secs: u32,
) -> Arc<client::Config> {
    let mut config = client::Config::default();

    match preset {
        "legacy" => {
            config.preferred = Preferred {
                kex: Cow::Borrowed(LEGACY_KEX),
                key: Cow::Borrowed(LEGACY_KEY),
                cipher: Cow::Borrowed(LEGACY_CIPHER),
                mac: Cow::Borrowed(LEGACY_MAC),
                compression: Cow::Borrowed(LEGACY_COMPRESSION),
            };
        }
        "very-legacy" => {
            config.preferred = Preferred {
                kex: Cow::Borrowed(VERY_LEGACY_KEX),
                key: Cow::Borrowed(LEGACY_KEY),
                cipher: Cow::Borrowed(LEGACY_CIPHER),
                mac: Cow::Borrowed(LEGACY_MAC),
                compression: Cow::Borrowed(LEGACY_COMPRESSION),
            };
        }
        _ => {} // "modern" ou desconhecido → padrão seguro
    }

    if keepalive_secs > 0 {
        config.keepalive_interval = Some(Duration::from_secs(keepalive_secs as u64));
        config.keepalive_max = 3;
    }

    if timeout_secs > 0 {
        config.inactivity_timeout = Some(Duration::from_secs(timeout_secs as u64));
    }

    Arc::new(config)
}

// ─── Known hosts (TOFU) ───────────────────────────────────────────────────────

fn known_hosts_path(data_dir: &Path) -> PathBuf {
    data_dir.join("known_hosts.json")
}

pub fn load_known_hosts(data_dir: &Path) -> HashMap<String, String> {
    let path = known_hosts_path(data_dir);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save_known_hosts(data_dir: &Path, hosts: &HashMap<String, String>) {
    let path = known_hosts_path(data_dir);
    if let Ok(json) = serde_json::to_string_pretty(hosts) {
        let _ = std::fs::write(path, json);
    }
}

// ─── Utilitários de string ────────────────────────────────────────────────────

pub fn trim_owned(value: String) -> String {
    value.trim().to_string()
}

pub fn trim_optional_owned(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

pub fn format_host_key(host: &str, port: u16) -> String {
    format!("[{}]:{}", host, port)
}

// ─── Handler TOFU para known_hosts ───────────────────────────────────────────

#[derive(Debug, PartialEq, Eq)]
enum HostKeyVerification {
    Trusted,
    Unknown,
    Mismatch,
}

fn classify_host_key(stored: Option<&str>, fingerprint: &str) -> HostKeyVerification {
    match stored {
        None => HostKeyVerification::Unknown,
        Some(stored) if stored == fingerprint => HostKeyVerification::Trusted,
        Some(_) => HostKeyVerification::Mismatch,
    }
}

/// Handler russh que valida a chave apresentada contra `known_hosts`.
///
/// `new` mantém o comportamento legado de TOFU para fluxos que fazem uma
/// sondagem explícita antes de conectar. `new_strict` rejeita hosts desconhecidos
/// e captura a fingerprint para o chamador solicitar confirmação ao usuário.
pub struct KnownHostsHandler {
    pub host_key: String,
    pub known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>,
    unknown_fingerprint: Option<Arc<std::sync::Mutex<Option<String>>>>,
}

impl KnownHostsHandler {
    pub fn new(
        host: &str,
        port: u16,
        known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>,
    ) -> Self {
        Self {
            host_key: format_host_key(host, port),
            known_hosts,
            unknown_fingerprint: None,
        }
    }

    pub fn new_strict(
        host: &str,
        port: u16,
        known_hosts: Arc<std::sync::Mutex<HashMap<String, String>>>,
        unknown_fingerprint: Arc<std::sync::Mutex<Option<String>>>,
    ) -> Self {
        Self {
            host_key: format_host_key(host, port),
            known_hosts,
            unknown_fingerprint: Some(unknown_fingerprint),
        }
    }
}

#[async_trait]
impl client::Handler for KnownHostsHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        let fingerprint = server_public_key.fingerprint();
        let mut kh = self
            .known_hosts
            .lock()
            .expect("known_hosts mutex não pode ser envenenado");
        match classify_host_key(kh.get(&self.host_key).map(String::as_str), &fingerprint) {
            HostKeyVerification::Trusted => Ok(true),
            HostKeyVerification::Mismatch => {
                // Fingerprint diferente — possível MITM
                Err(russh::Error::WrongServerSig)
            }
            HostKeyVerification::Unknown => match &self.unknown_fingerprint {
                Some(captured) => {
                    *captured
                        .lock()
                        .expect("fingerprint desconhecida mutex não pode ser envenenado") =
                        Some(fingerprint);
                    Err(russh::Error::WrongServerSig)
                }
                None => {
                    // Compatibilidade com fluxos que já fazem confirmação prévia.
                    kh.insert(self.host_key.clone(), fingerprint);
                    Ok(true)
                }
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{classify_host_key, HostKeyVerification};

    #[test]
    fn classifies_unknown_host_without_trusting_it() {
        assert_eq!(
            classify_host_key(None, "SHA256:new"),
            HostKeyVerification::Unknown
        );
    }

    #[test]
    fn accepts_matching_fingerprint() {
        assert_eq!(
            classify_host_key(Some("SHA256:known"), "SHA256:known"),
            HostKeyVerification::Trusted
        );
    }

    #[test]
    fn rejects_mismatching_fingerprint() {
        assert_eq!(
            classify_host_key(Some("SHA256:known"), "SHA256:changed"),
            HostKeyVerification::Mismatch
        );
    }
}
