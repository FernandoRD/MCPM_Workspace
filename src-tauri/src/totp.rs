/// Módulo TOTP (Time-based One-Time Password — RFC 6238)
///
/// Compatível com Google Authenticator, Authy, Bitwarden, etc.
/// Segredos são sempre armazenados cifrados via crypto.rs.

use serde::{Deserialize, Serialize};
use totp_rs::{Algorithm, Secret, TOTP};

const STEP: u64 = 30; // janela de 30 segundos (padrão RFC 6238)
const DIGITS: usize = 6;

#[derive(Debug, Serialize, Deserialize)]
pub struct TotpCode {
    /// Código atual de 6 dígitos
    pub code: String,
    /// Segundos restantes até o código expirar
    pub remaining_seconds: u64,
    /// Timestamp Unix do início da janela atual
    pub valid_from: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TotpSetup {
    /// Segredo em Base32 gerado aleatoriamente
    pub secret: String,
    /// URI otpauth:// para gerar QR code
    pub otpauth_url: String,
    /// Algoritmo usado para novos segredos gerados pelo app
    pub algorithm: String,
}

fn normalize_algorithm(algorithm: Option<&str>) -> Result<Algorithm, String> {
    match algorithm.unwrap_or("SHA1").to_uppercase().as_str() {
        "SHA1" => Ok(Algorithm::SHA1),
        "SHA256" => Ok(Algorithm::SHA256),
        other => Err(format!("Algoritmo TOTP não suportado: {other}")),
    }
}

fn build_totp(secret_base32: &str, algorithm: Option<&str>) -> Result<TOTP, String> {
    let secret = Secret::Encoded(secret_base32.to_uppercase())
        .to_bytes()
        .map_err(|e| format!("Segredo TOTP inválido: {e}"))?;
    let algorithm = normalize_algorithm(algorithm)?;

    TOTP::new(algorithm, DIGITS, 1, STEP, secret, None, String::new())
        .map_err(|e| format!("Falha ao criar TOTP: {e}"))
}

/// Gera o código TOTP atual para o segredo fornecido (Base32).
#[tauri::command]
pub fn generate_totp_code(secret_base32: String, totp_algorithm: Option<String>) -> Result<TotpCode, String> {
    let totp = build_totp(&secret_base32, totp_algorithm.as_deref())?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let code = totp
        .generate(now)
        ;

    let valid_from = (now / STEP) * STEP;
    let remaining_seconds = STEP - (now % STEP);

    Ok(TotpCode {
        code,
        remaining_seconds,
        valid_from,
    })
}

/// Valida se um código TOTP de 6 dígitos está correto para o segredo.
/// Aceita a janela atual ± 1 (tolerância de clock).
#[tauri::command]
pub fn verify_totp_code(secret_base32: String, code: String, totp_algorithm: Option<String>) -> Result<bool, String> {
    let totp = build_totp(&secret_base32, totp_algorithm.as_deref())?;
    Ok(totp.check_current(&code).unwrap_or(false))
}

/// Gera um novo segredo TOTP aleatório e retorna o segredo Base32
/// junto com a URI otpauth:// para exibição de QR code.
#[tauri::command]
pub fn generate_totp_secret(
    issuer: String,
    account_name: String,
) -> Result<TotpSetup, String> {
    // Gera 20 bytes aleatórios (160 bits — padrão RFC 4226)
    let secret_bytes = Secret::generate_secret();
    let secret_base32 = secret_bytes.to_encoded().to_string();

    let secret_raw = secret_bytes
        .to_bytes()
        .map_err(|e| format!("Erro ao converter segredo: {e}"))?;

    let totp = TOTP::new_unchecked(
        Algorithm::SHA256,
        DIGITS,
        1,
        STEP,
        secret_raw,
        Some(issuer.clone()),
        account_name.clone(),
    );

    let otpauth_url = totp
        .get_url();

    Ok(TotpSetup {
        secret: secret_base32,
        otpauth_url,
        algorithm: "SHA256".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_and_verify() {
        // Segredo de teste em Base32
        let secret = "JBSWY3DPEHPK3PXP";
        let result = generate_totp_code(secret.to_string(), None).expect("deve gerar código");
        assert_eq!(result.code.len(), 6);
        assert!(result.remaining_seconds <= 30);
        assert!(result.remaining_seconds > 0);
    }

    #[test]
    fn test_invalid_secret_returns_error() {
        let result = generate_totp_code("!!!INVALID!!!".to_string(), None);
        assert!(result.is_err());
    }

    #[test]
    fn test_generate_secret() {
        let setup = generate_totp_secret(
            "SSH Vault".to_string(),
            "user@server".to_string(),
        )
        .expect("deve gerar segredo");

        assert!(!setup.secret.is_empty());
        assert!(setup.otpauth_url.starts_with("otpauth://totp/"));
        assert!(setup.otpauth_url.contains("algorithm=SHA256"));
        assert_eq!(setup.algorithm, "SHA256");
        // Segredo gerado deve ser utilizável
        let code = generate_totp_code(setup.secret, Some(setup.algorithm)).expect("deve gerar código do segredo novo");
        assert_eq!(code.code.len(), 6);
    }
}
