use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use base64::Engine;
use rand::Rng;
use russh_keys::key::KeyPair;
use serde::Serialize;
use zeroize::Zeroizing;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemTerminalLaunchResult {
    pub terminal: String,
    pub command_preview: String,
}

struct TerminalEmulator {
    name: String,
    exec_flag: Vec<String>,
}

// ─── Detecção de terminal ─────────────────────────────────────────────────────

fn find_in_path(name: &str) -> bool {
    let path_var = std::env::var("PATH").unwrap_or_default();
    let sep = if cfg!(windows) { ';' } else { ':' };
    path_var.split(sep).any(|dir| {
        let mut p = PathBuf::from(dir);
        p.push(name);
        #[cfg(windows)]
        p.set_extension("exe");
        p.is_file()
    })
}

#[cfg(target_os = "linux")]
fn detect_terminal() -> Option<TerminalEmulator> {
    if let Ok(terminal) = std::env::var("TERMINAL") {
        let terminal = terminal.trim().to_string();
        if !terminal.is_empty() && find_in_path(&terminal) {
            return Some(TerminalEmulator {
                name: terminal,
                exec_flag: vec!["-e".to_string()],
            });
        }
    }

    let candidates: &[(&str, &[&str])] = &[
        ("x-terminal-emulator", &["-e"]),
        ("gnome-terminal", &["--"]),
        ("konsole", &["-e"]),
        ("xfce4-terminal", &["-e"]),
        ("alacritty", &["-e"]),
        ("wezterm", &["start", "--"]),
        ("kitty", &["--"]),
        ("xterm", &["-e"]),
        ("uxterm", &["-e"]),
        ("rxvt", &["-e"]),
    ];

    for (name, flags) in candidates {
        if find_in_path(name) {
            return Some(TerminalEmulator {
                name: name.to_string(),
                exec_flag: flags.iter().map(|s| s.to_string()).collect(),
            });
        }
    }

    None
}

#[cfg(target_os = "macos")]
fn detect_terminal() -> Option<TerminalEmulator> {
    Some(TerminalEmulator {
        name: "Terminal.app".to_string(),
        exec_flag: vec![],
    })
}

#[cfg(windows)]
fn detect_terminal() -> Option<TerminalEmulator> {
    if find_in_path("wt") {
        return Some(TerminalEmulator {
            name: "wt".to_string(),
            exec_flag: vec!["--".to_string()],
        });
    }
    Some(TerminalEmulator {
        name: "cmd".to_string(),
        exec_flag: vec![
            "/c".to_string(),
            "start".to_string(),
            "cmd".to_string(),
            "/k".to_string(),
        ],
    })
}

// ─── Codificação de chave no formato OpenSSH nativo ──────────────────────────
//
// O formato PKCS#8 gerado pelo app (-----BEGIN PRIVATE KEY-----) é rejeitado
// por algumas versões do OpenSSH com "error in libcrypto: unsupported".
// O formato nativo OpenSSH (-----BEGIN OPENSSH PRIVATE KEY-----) é aceito por
// todas as versões modernas do cliente ssh.

fn write_ssh_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_be_bytes());
}

fn write_ssh_string(buf: &mut Vec<u8>, s: &[u8]) {
    write_ssh_u32(buf, s.len() as u32);
    buf.extend_from_slice(s);
}

fn encode_openssh_ed25519(signing_key: &ed25519_dalek::SigningKey) -> String {
    let seed = signing_key.to_bytes();
    let pub_bytes = signing_key.verifying_key().to_bytes();

    // Blob da chave pública (wire format SSH)
    let mut pub_blob = Vec::<u8>::new();
    write_ssh_string(&mut pub_blob, b"ssh-ed25519");
    write_ssh_string(&mut pub_blob, &pub_bytes);

    // Blob privado
    let checkint: u32 = rand::thread_rng().gen();
    let mut priv_blob = Vec::<u8>::new();
    write_ssh_u32(&mut priv_blob, checkint);
    write_ssh_u32(&mut priv_blob, checkint);
    write_ssh_string(&mut priv_blob, b"ssh-ed25519");
    write_ssh_string(&mut priv_blob, &pub_bytes);
    // 64 bytes: seed || public — formato exigido pelo OpenSSH para Ed25519
    let mut key64 = [0u8; 64];
    key64[..32].copy_from_slice(&seed);
    key64[32..].copy_from_slice(&pub_bytes);
    write_ssh_string(&mut priv_blob, &key64);
    write_ssh_string(&mut priv_blob, b""); // comment vazio

    // Padding até múltiplo de 8 (OpenSSH exige isso mesmo sem cifração)
    let mut pad = 1u8;
    while priv_blob.len() % 8 != 0 {
        priv_blob.push(pad);
        pad += 1;
    }

    // Blob completo
    let mut blob = Vec::<u8>::new();
    blob.extend_from_slice(b"openssh-key-v1\0"); // magic
    write_ssh_string(&mut blob, b"none");          // ciphername
    write_ssh_string(&mut blob, b"none");          // kdfname
    write_ssh_string(&mut blob, b"");              // kdfoptions
    write_ssh_u32(&mut blob, 1);                   // nkeys = 1
    write_ssh_string(&mut blob, &pub_blob);
    write_ssh_string(&mut blob, &priv_blob);

    let b64 = base64::engine::general_purpose::STANDARD.encode(&blob);
    let lines = b64
        .as_bytes()
        .chunks(70)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("\n");

    format!("-----BEGIN OPENSSH PRIVATE KEY-----\n{lines}\n-----END OPENSSH PRIVATE KEY-----\n")
}

/// Decodifica a chave privada (qualquer formato suportado) e re-serializa em
/// formato compatível com o cliente ssh do sistema.
fn normalize_private_key(content: &str, passphrase: Option<&str>) -> Result<String, String> {
    let pair = russh_keys::decode_secret_key(content, passphrase)
        .map_err(|e| format!("Falha ao decodificar chave privada: {e}"))?;

    match &pair {
        KeyPair::Ed25519(signing_key) => Ok(encode_openssh_ed25519(signing_key)),
        _ => {
            // RSA / ECDSA: PKCS#8 funciona na maioria dos sistemas modernos
            let mut buf = Vec::new();
            russh_keys::encode_pkcs8_pem(&pair, &mut buf)
                .map_err(|e| format!("Falha ao serializar chave: {e}"))?;
            String::from_utf8(buf).map_err(|e| e.to_string())
        }
    }
}

// ─── Arquivo de chave temporário ─────────────────────────────────────────────

fn temp_key_dir() -> PathBuf {
    std::env::temp_dir().join("ssh_vault_keys")
}

fn write_temp_key(content: &str) -> io::Result<PathBuf> {
    let dir = temp_key_dir();
    fs::create_dir_all(&dir)?;

    let id = uuid::Uuid::new_v4().to_string();
    let path = dir.join(format!("key_{id}"));

    fs::write(&path, content)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
    }

    Ok(path)
}

pub fn cleanup_old_temp_keys() {
    let dir = temp_key_dir();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let _ = fs::remove_file(entry.path());
        }
    }
}

// ─── Construção do comando SSH / Telnet ───────────────────────────────────────

fn build_connection_command(
    protocol: &str,
    host: &str,
    port: u16,
    username: &str,
    auth_method: &str,
    private_key_path: Option<&Path>,
) -> Vec<String> {
    if protocol == "telnet" {
        return vec!["telnet".to_string(), host.to_string(), port.to_string()];
    }

    let mut cmd = vec!["ssh".to_string()];

    if port != 22 {
        cmd.push("-p".to_string());
        cmd.push(port.to_string());
    }

    if auth_method == "privateKey" {
        if let Some(key_path) = private_key_path {
            cmd.push("-i".to_string());
            cmd.push(key_path.to_string_lossy().to_string());
        }
    }

    let target = if username.is_empty() {
        host.to_string()
    } else {
        format!("{username}@{host}")
    };
    cmd.push(target);

    cmd
}

// ─── Spawn no terminal do sistema ────────────────────────────────────────────

#[cfg(not(target_os = "macos"))]
fn spawn_in_terminal(terminal: &TerminalEmulator, cmd: &[String]) -> io::Result<()> {
    let mut all_args: Vec<&str> = terminal.exec_flag.iter().map(String::as_str).collect();
    all_args.extend(cmd.iter().map(String::as_str));

    Command::new(&terminal.name)
        .args(&all_args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    Ok(())
}

#[cfg(target_os = "macos")]
fn spawn_in_terminal(_terminal: &TerminalEmulator, cmd: &[String]) -> io::Result<()> {
    let cmd_str = cmd
        .iter()
        .map(|arg| {
            if arg.contains(' ') || arg.contains('"') || arg.contains('\'') {
                format!("'{}'", arg.replace('\'', "'\\''"))
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    let script = format!(
        "tell application \"Terminal\"\n\
             do script \"{}\"\n\
             activate\n\
         end tell",
        cmd_str.replace('"', "\\\"")
    );

    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    Ok(())
}

// ─── Comando Tauri ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn ssh_launch_system_terminal(
    protocol: String,
    host: String,
    port: u16,
    username: String,
    auth_method: String,
    private_key_content: Option<String>,
    private_key_passphrase: Option<String>,
) -> Result<SystemTerminalLaunchResult, String> {
    let host = host.trim().to_string();
    let username = username.trim().to_string();

    let private_key_content = private_key_content.map(Zeroizing::new);
    let private_key_passphrase = private_key_passphrase.map(Zeroizing::new);

    let terminal = detect_terminal().ok_or_else(|| {
        "Nenhum emulador de terminal compatível encontrado.\n\
         Instale um dos seguintes: gnome-terminal, konsole, xfce4-terminal, xterm, alacritty."
            .to_string()
    })?;

    // Prepara arquivo de chave no formato OpenSSH nativo (se necessário)
    let temp_key_path = if auth_method == "privateKey" {
        match private_key_content.as_deref() {
            Some(content) => {
                let passphrase = private_key_passphrase.as_deref();
                let normalized = normalize_private_key(content, passphrase.map(|x| x.as_str()))?;
                let path = write_temp_key(&normalized)
                    .map_err(|e| format!("Falha ao gravar chave SSH temporária: {e}"))?;
                Some(path)
            }
            None => None,
        }
    } else {
        None
    };

    let cmd = build_connection_command(
        &protocol,
        &host,
        port,
        &username,
        &auth_method,
        temp_key_path.as_deref(),
    );

    let command_preview = cmd
        .iter()
        .map(|arg| {
            if arg.contains(' ') {
                format!("{arg:?}")
            } else {
                arg.clone()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");

    spawn_in_terminal(&terminal, &cmd)
        .map_err(|e| format!("Falha ao abrir {}: {e}", terminal.name))?;

    Ok(SystemTerminalLaunchResult {
        terminal: terminal.name,
        command_preview,
    })
}
