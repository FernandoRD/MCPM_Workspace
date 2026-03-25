/// Módulo de criptografia do SSH Vault
///
/// Fluxo:
///   1. Usuário define uma senha mestra
///   2. Argon2id deriva uma chave de 256 bits a partir da senha + salt aleatório
///   3. AES-256-GCM cifra o payload com essa chave + nonce aleatório
///   4. O resultado (salt + nonce + ciphertext) é enviado ao provedor de sync
///   5. Na importação: mesma senha → mesma chave → decifra
///
/// A senha mestra NUNCA sai do dispositivo.

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Key, Nonce,
};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

// Parâmetros Argon2id (OWASP mínimo recomendado para autenticação)
const ARGON2_MEM_COST: u32 = 65536; // 64 MB
const ARGON2_TIME_COST: u32 = 3;
const ARGON2_PARALLELISM: u32 = 1;
const ARGON2_OUTPUT_LEN: usize = 32; // 256 bits → chave AES-256

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EncryptedPayload {
    /// Versão do esquema (para migração futura)
    pub version: u8,
    /// Salt Argon2id codificado em Base64
    pub salt: String,
    /// Nonce AES-GCM codificado em Base64
    pub nonce: String,
    /// Ciphertext + tag GCM codificados em Base64
    pub ciphertext: String,
}

/// Deriva uma chave AES-256 a partir da senha mestra e do salt.
/// Retorna a chave encapsulada em Zeroizing para limpeza automática da memória.
fn derive_key(password: &str, salt: &[u8]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(
        ARGON2_MEM_COST,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
        Some(ARGON2_OUTPUT_LEN),
    )
    .map_err(|e| format!("Parâmetros Argon2 inválidos: {e}"))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|e| format!("Falha na derivação de chave: {e}"))?;

    Ok(key)
}

/// Cifra um payload de texto com a senha mestra.
/// Retorna um `EncryptedPayload` pronto para serializar e enviar ao sync.
pub fn encrypt(plaintext: &str, password: &str) -> Result<EncryptedPayload, String> {
    // Salt e nonce aleatórios a cada cifragem
    let mut salt = [0u8; SALT_LEN];
    let mut nonce_bytes = [0u8; NONCE_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    rand::thread_rng().fill_bytes(&mut nonce_bytes);

    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(key_bytes.as_ref());
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| format!("Falha na cifragem: {e}"))?;

    Ok(EncryptedPayload {
        version: 1,
        salt: B64.encode(salt),
        nonce: B64.encode(nonce_bytes),
        ciphertext: B64.encode(ciphertext),
    })
}

/// Decifra um `EncryptedPayload` com a senha mestra.
/// Retorna o plaintext original ou erro se a senha estiver errada / dados corrompidos.
pub fn decrypt(payload: &EncryptedPayload, password: &str) -> Result<String, String> {
    if payload.version != 1 {
        return Err(format!(
            "Versão de payload não suportada: {}",
            payload.version
        ));
    }

    let salt = B64
        .decode(&payload.salt)
        .map_err(|e| format!("Salt inválido: {e}"))?;
    let nonce_bytes = B64
        .decode(&payload.nonce)
        .map_err(|e| format!("Nonce inválido: {e}"))?;
    let ciphertext = B64
        .decode(&payload.ciphertext)
        .map_err(|e| format!("Ciphertext inválido: {e}"))?;

    let key_bytes = derive_key(password, &salt)?;
    let key = Key::<Aes256Gcm>::from_slice(key_bytes.as_ref());
    let cipher = Aes256Gcm::new(key);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        // Mensagem genérica para não vazar info sobre o erro (timing attack)
        .map_err(|_| "Senha incorreta ou dados corrompidos".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("Payload não é UTF-8: {e}"))
}

/// Verifica se uma senha consegue decifrar o payload (sem retornar o conteúdo).
/// Usado para validar a senha mestra antes de operações de sync.
pub fn verify_password(payload: &EncryptedPayload, password: &str) -> bool {
    decrypt(payload, password).is_ok()
}

// ─── Comandos Tauri ─────────────────────────────────────────────────────────

/// Cifra um JSON de credenciais com a senha mestra.
/// Retorna o `EncryptedPayload` serializado como JSON.
#[tauri::command]
pub fn encrypt_credentials(credentials_json: String, master_password: String) -> Result<String, String> {
    let payload = encrypt(&credentials_json, &master_password)?;
    serde_json::to_string(&payload).map_err(|e| e.to_string())
}

/// Decifra um `EncryptedPayload` JSON com a senha mestra.
/// Retorna o JSON de credenciais original.
#[tauri::command]
pub fn decrypt_credentials(
    encrypted_payload_json: String,
    master_password: String,
) -> Result<String, String> {
    let payload: EncryptedPayload = serde_json::from_str(&encrypted_payload_json)
        .map_err(|e| format!("Payload inválido: {e}"))?;
    decrypt(&payload, &master_password)
}

/// Verifica se a senha mestra consegue decifrar o payload (retorna bool).
#[tauri::command]
pub fn verify_master_password(
    encrypted_payload_json: String,
    master_password: String,
) -> Result<bool, String> {
    let payload: EncryptedPayload = serde_json::from_str(&encrypted_payload_json)
        .map_err(|e| format!("Payload inválido: {e}"))?;
    Ok(verify_password(&payload, &master_password))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let plaintext = r#"{"host1":{"password":"s3cr3t"}}"#;
        let password = "minha-senha-mestra";

        let payload = encrypt(plaintext, password).expect("cifragem falhou");
        let recovered = decrypt(&payload, password).expect("decifragem falhou");

        assert_eq!(plaintext, recovered);
    }

    #[test]
    fn test_wrong_password_fails() {
        let plaintext = "dados secretos";
        let payload = encrypt(plaintext, "senha-correta").expect("cifragem falhou");
        let result = decrypt(&payload, "senha-errada");

        assert!(result.is_err());
    }

    #[test]
    fn test_each_encrypt_produces_unique_ciphertext() {
        let plaintext = "mesmo texto";
        let password = "mesma senha";

        let p1 = encrypt(plaintext, password).unwrap();
        let p2 = encrypt(plaintext, password).unwrap();

        // Salt e nonce são aleatórios → ciphertexts diferentes
        assert_ne!(p1.ciphertext, p2.ciphertext);
        assert_ne!(p1.salt, p2.salt);
    }
}
