use std::io::Write;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub async fn terminal_clipboard_write(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || write_clipboard(&text))
        .await
        .map_err(|e| format!("clipboard: tarefa interrompida: {e}"))?
}

#[tauri::command]
pub async fn terminal_clipboard_read() -> Result<String, String> {
    tokio::task::spawn_blocking(read_clipboard)
        .await
        .map_err(|e| format!("clipboard: tarefa interrompida: {e}"))?
}

fn command_exists(command: &str) -> bool {
    let mut cmd = Command::new(command);
    cmd.arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    prepare_command(&mut cmd);
    cmd.status().is_ok()
}

#[cfg(target_os = "windows")]
fn prepare_command(command: &mut Command) {
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn prepare_command(_command: &mut Command) {
}

fn run_with_stdin(command: &str, args: &[&str], input: &str) -> Result<(), String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    prepare_command(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{command}: {e}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| format!("{command}: falha ao escrever stdin: {e}"))?;
    }
    drop(child.stdin.take());

    let started_at = Instant::now();
    loop {
        match child.try_wait().map_err(|e| format!("{command}: {e}"))? {
            Some(status) if status.success() => return Ok(()),
            Some(status) => return Err(format!("{command}: saiu com status {status}")),
            None if started_at.elapsed() >= Duration::from_millis(500) => {
                // wl-copy/xclip/xsel podem permanecer vivos para servir o
                // clipboard. Depois que o stdin foi entregue, não esperamos
                // indefinidamente para não travar a aplicação.
                return Ok(());
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }
}

fn run_capture(command: &str, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new(command);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    prepare_command(&mut cmd);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("{command}: {e}"))?;

    let started_at = Instant::now();
    loop {
        match child.try_wait().map_err(|e| format!("{command}: {e}"))? {
            Some(_) => break,
            None if started_at.elapsed() >= Duration::from_secs(2) => {
                let _ = child.kill();
                return Err(format!("{command}: timeout ao ler clipboard"));
            }
            None => std::thread::sleep(Duration::from_millis(25)),
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("{command}: {e}"))?;

    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|e| format!("{command}: clipboard não é UTF-8 válido: {e}"));
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
        format!("{command}: saiu com status {}", output.status)
    } else {
        format!("{command}: {stderr}")
    })
}

#[cfg(target_os = "linux")]
fn write_clipboard(text: &str) -> Result<(), String> {
    let candidates: &[(&str, &[&str])] = &[
        ("wl-copy", &[]),
        ("xclip", &["-selection", "clipboard"]),
        ("xsel", &["--clipboard", "--input"]),
    ];

    let mut errors = Vec::new();
    for (command, args) in candidates {
        if !command_exists(command) {
            continue;
        }
        match run_with_stdin(command, args, text) {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(error),
        }
    }

    Err(if errors.is_empty() {
        "Nenhum utilitário de clipboard encontrado. Instale wl-clipboard, xclip ou xsel.".to_string()
    } else {
        errors.join("; ")
    })
}

#[cfg(target_os = "linux")]
fn read_clipboard() -> Result<String, String> {
    let candidates: &[(&str, &[&str])] = &[
        ("wl-paste", &["--no-newline"]),
        ("xclip", &["-selection", "clipboard", "-out"]),
        ("xsel", &["--clipboard", "--output"]),
    ];

    let mut errors = Vec::new();
    for (command, args) in candidates {
        if !command_exists(command) {
            continue;
        }
        match run_capture(command, args) {
            Ok(text) => return Ok(text),
            Err(error) => errors.push(error),
        }
    }

    Err(if errors.is_empty() {
        "Nenhum utilitário de clipboard encontrado. Instale wl-clipboard, xclip ou xsel.".to_string()
    } else {
        errors.join("; ")
    })
}

#[cfg(target_os = "macos")]
fn write_clipboard(text: &str) -> Result<(), String> {
    run_with_stdin("pbcopy", &[], text)
}

#[cfg(target_os = "macos")]
fn read_clipboard() -> Result<String, String> {
    run_capture("pbpaste", &[])
}

#[cfg(target_os = "windows")]
fn write_clipboard(text: &str) -> Result<(), String> {
    run_with_stdin(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Set-Clipboard -Value ([Console]::In.ReadToEnd())",
        ],
        text,
    )
}

#[cfg(target_os = "windows")]
fn read_clipboard() -> Result<String, String> {
    run_capture(
        "powershell",
        &[
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false); [Console]::Out.Write((Get-Clipboard -Raw))",
        ],
    )
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn write_clipboard(_text: &str) -> Result<(), String> {
    Err("Clipboard nativo não suportado nesta plataforma.".to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "windows")))]
fn read_clipboard() -> Result<String, String> {
    Err("Clipboard nativo não suportado nesta plataforma.".to_string())
}
