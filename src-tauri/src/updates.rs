use serde::Serialize;

/// Repositório oficial usado para checar novas versões.
const GITHUB_REPO: &str = "FernandoRD/MPCM_Workspace";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub release_name: String,
    pub published_at: String,
}

/// Consulta a última release publicada no GitHub e compara com a versão atual.
///
/// Usa a API pública (`/releases/latest`), que já ignora drafts e pré-releases.
/// Falhas de rede retornam `Err` — o frontend trata como "sem aviso" silenciosamente.
#[tauri::command]
pub async fn check_for_updates() -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "MPCM-Workspace")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Falha ao consultar releases: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub respondeu com status {}", response.status()));
    }

    let json: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Resposta inválida do GitHub: {e}"))?;

    let latest_version = json["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    let release_url = json["html_url"].as_str().unwrap_or("").to_string();
    let release_name = json["name"].as_str().unwrap_or("").to_string();
    let published_at = json["published_at"].as_str().unwrap_or("").to_string();

    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let update_available = is_newer(&latest_version, &current_version);

    Ok(UpdateInfo {
        current_version,
        latest_version,
        update_available,
        release_url,
        release_name,
        published_at,
    })
}

/// Compara duas versões `MAJOR.MINOR.PATCH` e indica se `latest` é maior que `current`.
fn is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .map(|part| {
                part.chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect::<String>()
                    .parse()
                    .unwrap_or(0)
            })
            .collect()
    };

    let latest = parse(latest);
    let current = parse(current);

    for i in 0..latest.len().max(current.len()) {
        let l = latest.get(i).copied().unwrap_or(0);
        let c = current.get(i).copied().unwrap_or(0);
        if l != c {
            return l > c;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn detects_newer_versions() {
        assert!(is_newer("0.4.9", "0.4.8"));
        assert!(is_newer("0.5.0", "0.4.8"));
        assert!(is_newer("1.0.0", "0.9.9"));
    }

    #[test]
    fn ignores_same_or_older() {
        assert!(!is_newer("0.4.8", "0.4.8"));
        assert!(!is_newer("0.4.7", "0.4.8"));
        assert!(!is_newer("0.3.0", "0.4.8"));
    }
}
