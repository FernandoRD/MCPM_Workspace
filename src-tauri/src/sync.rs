use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::Client;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

// ── Helpers AWS Signature V4 ─────────────────────────────────────────────────

fn sha256_hex(data: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(data);
    hex::encode(h.finalize())
}

fn hmac_sha256(key: &[u8], data: &str) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key length ok");
    mac.update(data.as_bytes());
    mac.finalize().into_bytes().to_vec()
}

fn aws_signing_key(secret: &str, date: &str, region: &str) -> Vec<u8> {
    let k1 = hmac_sha256(format!("AWS4{secret}").as_bytes(), date);
    let k2 = hmac_sha256(&k1, region);
    let k3 = hmac_sha256(&k2, "s3");
    hmac_sha256(&k3, "aws4_request")
}

/// Gera os headers Authorization, x-amz-date e x-amz-content-sha256
/// necessários para uma requisição S3 (PutObject ou GetObject).
fn s3_auth_headers(
    method: &str,
    host: &str,
    path: &str,
    region: &str,
    access_key: &str,
    secret_key: &str,
    payload: &[u8],
) -> (String, String, String) {
    let now = Utc::now();
    let datetime = now.format("%Y%m%dT%H%M%SZ").to_string();
    let date = now.format("%Y%m%d").to_string();

    let payload_hash = sha256_hex(payload);

    // Canonical request
    let signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date";
    let canonical_headers = format!(
        "content-type:application/json\nhost:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{datetime}\n"
    );
    let canonical_request = format!(
        "{method}\n{path}\n\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );

    // String to sign
    let scope = format!("{date}/{region}/s3/aws4_request");
    let request_hash = sha256_hex(canonical_request.as_bytes());
    let string_to_sign = format!("AWS4-HMAC-SHA256\n{datetime}\n{scope}\n{request_hash}");

    // Signature
    let signing_key = aws_signing_key(secret_key, &date, region);
    let signature = hex::encode(hmac_sha256(&signing_key, &string_to_sign));

    let authorization = format!(
        "AWS4-HMAC-SHA256 Credential={access_key}/{scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );

    (authorization, datetime, payload_hash)
}

// ── GitHub Gist ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_gist_push(
    token: String,
    gist_id: Option<String>,
    payload_json: String,
) -> Result<String, String> {
    let client = build_client()?;

    let files = serde_json::json!({ "vault.json": { "content": payload_json } });
    let body = match &gist_id {
        None => serde_json::json!({
            "description": "SSH Vault Sync",
            "public": false,
            "files": files
        }),
        Some(_) => serde_json::json!({ "files": files }),
    };

    let (url, req) = match &gist_id {
        None => ("https://api.github.com/gists".to_string(), client.post("https://api.github.com/gists")),
        Some(id) => {
            let u = format!("https://api.github.com/gists/{id}");
            (u.clone(), client.patch(&u))
        }
    };

    let resp = req
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "SSH-Vault/1.0")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Erro de rede ao acessar {url}: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API {status}: {text}"));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Falha ao parsear resposta do Gist: {e}"))?;

    data["id"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Campo 'id' ausente na resposta do GitHub".to_string())
}

#[tauri::command]
pub async fn sync_gist_pull(token: String, gist_id: String) -> Result<String, String> {
    let client = build_client()?;
    let url = format!("https://api.github.com/gists/{gist_id}");

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.v3+json")
        .header("User-Agent", "SSH-Vault/1.0")
        .send()
        .await
        .map_err(|e| format!("Erro de rede: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub API {status}: {text}"));
    }

    let data: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Falha ao parsear resposta: {e}"))?;

    let file = &data["files"]["vault.json"];
    if file.is_null() {
        return Err("Arquivo vault.json não encontrado no Gist. Sincronize primeiro a partir do dispositivo de origem.".to_string());
    }

    // Se o conteúdo não estiver truncado, retorna diretamente
    if let Some(content) = file["content"].as_str() {
        if !file["truncated"].as_bool().unwrap_or(false) {
            return Ok(content.to_string());
        }
    }

    // Conteúdo truncado (arquivo > 1 MB): busca pelo raw_url
    let raw_url = file["raw_url"]
        .as_str()
        .ok_or_else(|| "raw_url ausente na resposta do Gist".to_string())?;

    let raw_resp = client
        .get(raw_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "SSH-Vault/1.0")
        .send()
        .await
        .map_err(|e| format!("Erro ao buscar conteúdo raw do Gist: {e}"))?;

    let raw_status = raw_resp.status();
    if !raw_status.is_success() {
        let text = raw_resp.text().await.unwrap_or_default();
        return Err(format!("GitHub raw {raw_status}: {text}"));
    }

    raw_resp
        .text()
        .await
        .map_err(|e| format!("Falha ao ler conteúdo raw do Gist: {e}"))
}

// ── WebDAV ────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_webdav_push(
    url: String,
    username: String,
    password: String,
    path: String,
    payload_json: String,
) -> Result<(), String> {
    let client = build_client()?;
    let base_url = ensure_https_url(&url, "WebDAV")?;
    let full_url = format!(
        "{}/{}",
        base_url.as_str().trim_end_matches('/'),
        path.trim_start_matches('/')
    );

    let resp = client
        .put(&full_url)
        .basic_auth(&username, Some(&password))
        .header("Content-Type", "application/json")
        .body(payload_json)
        .send()
        .await
        .map_err(|e| format!("Erro de rede WebDAV: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("WebDAV {status}: {text}"));
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_webdav_pull(
    url: String,
    username: String,
    password: String,
    path: String,
) -> Result<String, String> {
    let client = build_client()?;
    let base_url = ensure_https_url(&url, "WebDAV")?;
    let full_url = format!(
        "{}/{}",
        base_url.as_str().trim_end_matches('/'),
        path.trim_start_matches('/')
    );

    let resp = client
        .get(&full_url)
        .basic_auth(&username, Some(&password))
        .send()
        .await
        .map_err(|e| format!("Erro de rede WebDAV: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("WebDAV {status}: {text}"));
    }

    resp.text()
        .await
        .map_err(|e| format!("Falha ao ler resposta WebDAV: {e}"))
}

// ── S3 / MinIO ────────────────────────────────────────────────────────────────

const S3_OBJECT_KEY: &str = "vault.json";

/// Constrói o host e a URL para uma operação S3.
/// Se `endpoint` for vazio, usa o endpoint regional da AWS.
fn s3_url(endpoint: &str, bucket: &str, region: &str) -> Result<(String, String), String> {
    if endpoint.is_empty() {
        let host = format!("s3.{region}.amazonaws.com");
        let url = format!("https://{host}/{bucket}/{S3_OBJECT_KEY}");
        Ok((host, url))
    } else {
        let base_url = ensure_https_url(endpoint, "S3 endpoint")?;
        let base = base_url.as_str().trim_end_matches('/').to_string();
        let host = base_url
            .host_str()
            .ok_or_else(|| "S3 endpoint inválido: host ausente.".to_string())?
            .to_string();
        let url = format!("{base}/{bucket}/{S3_OBJECT_KEY}");
        Ok((host, url))
    }
}

#[tauri::command]
pub async fn sync_s3_push(
    endpoint: String,
    bucket: String,
    region: String,
    access_key: String,
    secret_key: String,
    payload_json: String,
) -> Result<(), String> {
    let client = build_client()?;
    let payload = payload_json.as_bytes();
    let (host, url) = s3_url(&endpoint, &bucket, &region)?;
    let path = format!("/{bucket}/{S3_OBJECT_KEY}");

    let (auth, amz_date, content_sha256) =
        s3_auth_headers("PUT", &host, &path, &region, &access_key, &secret_key, payload);

    let resp = client
        .put(&url)
        .header("Authorization", auth)
        .header("x-amz-date", amz_date)
        .header("x-amz-content-sha256", content_sha256)
        .header("Content-Type", "application/json")
        .body(payload_json)
        .send()
        .await
        .map_err(|e| format!("Erro de rede S3: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("S3 {status}: {text}"));
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_s3_pull(
    endpoint: String,
    bucket: String,
    region: String,
    access_key: String,
    secret_key: String,
) -> Result<String, String> {
    let client = build_client()?;
    let (host, url) = s3_url(&endpoint, &bucket, &region)?;
    let path = format!("/{bucket}/{S3_OBJECT_KEY}");

    let (auth, amz_date, content_sha256) =
        s3_auth_headers("GET", &host, &path, &region, &access_key, &secret_key, b"");

    let resp = client
        .get(&url)
        .header("Authorization", auth)
        .header("x-amz-date", amz_date)
        .header("x-amz-content-sha256", content_sha256)
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("Erro de rede S3: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("S3 {status}: {text}"));
    }

    resp.text()
        .await
        .map_err(|e| format!("Falha ao ler resposta S3: {e}"))
}

// ── Endpoint Customizado ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn sync_custom_push(url: String, payload_json: String) -> Result<(), String> {
    let client = build_client()?;
    let validated_url = ensure_https_url(&url, "endpoint customizado")?;

    let resp = client
        .put(validated_url)
        .header("Content-Type", "application/json")
        .body(payload_json)
        .send()
        .await
        .map_err(|e| format!("Erro de rede: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Custom endpoint {status}: {text}"));
    }

    Ok(())
}

#[tauri::command]
pub async fn sync_custom_pull(url: String) -> Result<String, String> {
    let client = build_client()?;
    let validated_url = ensure_https_url(&url, "endpoint customizado")?;

    let resp = client
        .get(validated_url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Erro de rede: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Custom endpoint {status}: {text}"));
    }

    resp.text()
        .await
        .map_err(|e| format!("Falha ao ler resposta: {e}"))
}

// ── Utilitários ───────────────────────────────────────────────────────────────

fn ensure_https_url(raw_url: &str, label: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw_url.trim())
        .map_err(|e| format!("{label} inválido: {e}"))?;

    if url.scheme() != "https" {
        return Err(format!(
            "{label} deve usar HTTPS. URLs HTTP expõem credenciais e tokens em texto claro na rede."
        ));
    }

    Ok(url)
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Falha ao criar cliente HTTP: {e}"))
}
