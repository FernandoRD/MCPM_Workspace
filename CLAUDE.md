# CLAUDE.md — MPCM Workspace

Contexto de desenvolvimento para Claude Code neste projeto.

## Identidade do projeto

- **Nome do produto**: MPCM Workspace
- **Classificação**: Multi-Protocol Connection Manager
- **Versão atual**: 0.4.7
- **Diretório de dados em runtime**: `mpcm-workspace` (migração automática do legado `ssh-vault`)

## Stack e versões

| Camada | Tecnologia |
| --- | --- |
| Framework desktop | Tauri 2.x |
| Backend | Rust (edition 2021) |
| Frontend | React 19, TypeScript, Vite 7 |
| Estado | Zustand 5 |
| Terminal | xterm.js 6 (`@xterm/xterm`) |
| Roteamento | React Router 7 |
| Estilos | Tailwind CSS 3 |
| i18n | i18next + react-i18next |
| SSH/SFTP | russh 0.44 + russh-sftp 2 |
| Banco | rusqlite + SQLCipher (bundled-sqlcipher-vendored-openssl) |
| Crypto | aes-gcm + argon2 + zeroize |
| TOTP | totp-rs 5 |
| Sync HTTP | reqwest 0.12 (rustls-tls) |
| Keychain | keyring 3 |

## Comandos essenciais

```bash
# Instalar dependências
npm install

# Dev frontend (sem Tauri)
npm run dev

# Dev desktop (Tauri + React)
npm run tauri dev

# Build frontend
npm run build

# Build desktop
npm run tauri build

# Sincronizar versão após editar package.json
npm run version:sync

# Viewer RDP interno (desenvolvimento)
npm run rdp:viewer -- <host> <port> <user> <pass>
```

## Versionamento

`package.json` é a fonte única de versão. Após editar:

```bash
npm run version:sync
```

Isso propaga para `Cargo.toml`, `Cargo.lock` e `package-lock.json`.

## Estrutura de diretórios

```text
src/                          # Frontend React/TypeScript
  App.tsx                     # Rotas e bootstrap de stores
  components/
    Terminal/TerminalPane.tsx  # xterm.js, SSH/Telnet, clipboard, bracketed paste
    CommandPalette.tsx         # Quick Connect
    CredentialForm.tsx         # Formulário reutilizável de credencial
    Layout/AppLayout.tsx
    TabBar/TabBar.tsx          # Drag-and-drop de abas
  pages/                      # Uma página por rota
  store/                      # Zustand (hosts, settings, credentials, sessions…)
  lib/                        # Utilitários e lógica de domínio
  types/index.ts              # Tipos TypeScript centrais
  locales/                    # pt-BR e en-US

src-tauri/src/                # Backend Rust
  lib.rs                      # AppState + invoke_handler (registro de todos os comandos)
  database.rs                 # SQLCipher — hosts, settings, credentials, ssh_keys, logs
  ssh.rs                      # Sessões SSH (terminal, túneis, known_hosts, health)
  sftp.rs                     # Sessões SFTP
  telnet.rs                   # Sessões Telnet
  rdp.rs                      # RDP — launcher nativo + viewer interno
  vnc.rs                      # VNC — launcher externo
  app_logging.rs              # Logger persistente em arquivo
  app_clipboard.rs            # Clipboard nativo para terminal
  crypto.rs                   # AES-GCM + Argon2
  credentials.rs              # Keychain do OS via keyring
  ssh_common.rs               # Código compartilhado SSH/SFTP
  system_terminal.rs          # Launch de terminal do sistema
  session_bootstrap.rs        # Bootstrap para quick-connect
  sync.rs                     # Sync remoto (Gist, S3, WebDAV, custom)
  storage.rs                  # Diretório de dados
  rate_limit.rs               # Rate limiter por chave dinâmica
  totp.rs                     # TOTP/MFA
  ssh_config.rs               # Importação ~/.ssh/config

clients/internal-rdp-client/  # Crate Rust separada — viewer RDP experimental
scripts/                      # sync-version.mjs, prepare-internal-rdp-viewer.mjs
```

## Protocolos e funcionalidades

- **SSH**: terminal com splits, SFTP embutido ou em aba, túneis, known_hosts, health check, MFA/TOTP, jump host, presets de compat
- **Telnet**: terminal com splits
- **RDP**: launcher nativo (xfreerdp/remmina/mstsc) ou viewer interno experimental
- **VNC**: launcher externo (tigervnc/remmina/krdc/vinagre)
- **SFTP**: derivado de SSH — navegação, upload, download, mkdir, delete, rename

## Terminal — comportamentos importantes

### Modo copyPaste (PuTTY style)

- **Seleção automática copia**: `xterm.onSelectionChange` dispara `writeClipboardText` quando `rightClickBehavior === "copyPaste"`.
- **Clique direito sempre cola**: `handleContextMenu` chama `xterm.paste(text)` — NÃO chama `invoke(ssh_send_input)` diretamente.
- **Bracketed paste**: `xterm.paste()` envolve automaticamente o texto com `\e[200~...\e[201~` quando o editor remoto (vim, nano) ativou bracketed paste mode via `\e[?2004h`. Isso impede que linhas se misturem ao colar em editores.
- `rightClickBehaviorRef` (ref) espelha a setting e é lido nos handlers para evitar re-criação do terminal ao mudar a preferência.

### Clipboard nativo

`app_clipboard.rs` usa ferramentas do sistema: `wl-copy`/`wl-paste` (Wayland), `xclip`/`xsel` (X11), `pbcopy`/`pbpaste` (macOS), PowerShell (Windows). Operações rodam em `spawn_blocking`.

## Banco de dados

- SQLCipher em `<data_dir>/vault.db`
- Chave gerada aleatoriamente e armazenada no keychain do OS (via `keyring`)
- WAL mode ativo
- Migrações automáticas em `Database::migrate()`

## Estado portátil (sync/backup)

`portableState.ts` define o que viaja em sync e backup:

- hosts, credentials, sshKeys
- settings portáveis (tema, locale, terminal, SSH, RDP, VNC, grupos, produtividade, `rightClickBehavior`, `cardMode`, `sftpOpenMode`)
- `sync.deletedHosts` (tombstones para propagar remoções)

## Logging

- Arquivo principal: `<data_dir>/logs/ssh_vault.log`
- Rotação simples para `ssh_vault.log.1` em ~5 MB
- Frontend: `logFrontendError` em `src/lib/logger.ts`
- Backend: crate `log` com `log::info!`, `log::warn!`, `log::error!`

## Convenções do projeto

- Tipos centrais em `src/types/index.ts` — não duplicar tipos em componentes
- Stores Zustand são a fonte de verdade do estado persistido — não usar localStorage diretamente
- `invoke()` direto nas páginas/componentes — não criar wrappers desnecessários
- Commits em português, prefixo semântico (`feat:`, `fix:`, `docs:`, `refactor:`)
- Versão sempre editada em `package.json` + `npm run version:sync`
- Não commitar binários nem `dist/` nem `target/` (cobertos pelo `.gitignore`)

## Estado atual (0.4.7)

Funcional e estável:

- Multi-protocolo SSH/Telnet/RDP/VNC
- Terminal com splits, reconexão, links, copyPaste com auto-copy e bracketed paste
- SFTP embutido lado a lado ou em aba
- Quick Connect via command palette
- Sync (Gist, S3, WebDAV, custom) com propagação de remoções
- Backup/restore `.sshvault`
- Logging persistente com visualizador in-app
- Grupos hierárquicos, tags, cores, notas, jump host
- MFA/TOTP por host
- Senha mestra + cifração de segredos no sync/backup
- Health check e inventário known_hosts editável
- Importação CSV e ~/.ssh/config
- i18n pt-BR / en-US
