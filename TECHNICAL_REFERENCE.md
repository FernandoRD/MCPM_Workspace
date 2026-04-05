# SSH Vault — Referência Técnica

Documento de referência para desenvolvimento e manutenção do SSH Vault no estado atual do projeto.

## Sumário

1. Visão geral
2. Stack e dependências
3. Estrutura do projeto
4. Modelo de dados
5. Stores Zustand
6. Rotas React
7. Bibliotecas do frontend
8. Comandos Tauri
9. Sync e backup
10. Segurança e segredos
11. Fluxos importantes

## 1. Visão geral

O SSH Vault é uma aplicação desktop Tauri com frontend React e backend Rust para gerenciar:

- hosts SSH
- credenciais reutilizáveis
- chaves SSH
- sessões de terminal e SFTP
- snippets, túneis e workspaces
- sincronização remota
- backup/restore
- health check e inventário de fingerprints

O app segue uma abordagem `local-first`:

- o estado principal vive localmente
- a UI usa Zustand e reidrata a partir do banco local
- sync e backup são fluxos explícitos de exportação/importação do estado portátil

## 2. Stack e dependências

### Frontend

- `React 19`
- `TypeScript`
- `React Router`
- `Zustand`
- `Tailwind CSS`
- `xterm.js`
- `react-i18next`

### Backend

- `Tauri 2`
- `Rust`
- `russh`
- `russh-sftp`
- `reqwest`
- `serde`
- `tokio`

### Integrações Tauri

- `@tauri-apps/api`
- `@tauri-apps/plugin-dialog`
- `@tauri-apps/plugin-fs`
- `@tauri-apps/plugin-notification`
- `@tauri-apps/plugin-opener`

## 3. Estrutura do projeto

```text
src/
  App.tsx
  components/
    CommandPalette.tsx
    Layout/AppLayout.tsx
    Sidebar/Sidebar.tsx
    SshConfigImportModal.tsx
    TabBar/TabBar.tsx
    Terminal/SshPane.tsx
    TotpDisplay/TotpDisplay.tsx
    ui/
  hooks/
    useAutoSync.ts
  lib/
    backup.ts
    health.ts
    hostSearch.ts
    i18n.ts
    notifications.ts
    portableState.ts
    productivity.ts
    secrets.ts
    sessionLauncher.ts
    sshConfigImport.ts
    sync.ts
    syncProviders.ts
    tagColors.ts
    utils.ts
    windowMode.ts
  locales/
  pages/
    Backup.tsx
    ConnectionLog.tsx
    CredentialEditor.tsx
    Credentials.tsx
    Dashboard.tsx
    Groups.tsx
    Health.tsx
    HostEditor.tsx
    Operations.tsx
    Settings.tsx
    SftpPage.tsx
    SshKeyEditor.tsx
    SshKeys.tsx
    Sync.tsx
    TerminalPage.tsx
  store/
    connectionLogs.ts
    credentials.ts
    hosts.ts
    sessions.ts
    settings.ts
    sshKeys.ts
    tunnelRuntime.ts
    uiStore.ts
  themes/
  types/

src-tauri/
  src/
    credentials.rs
    crypto.rs
    database.rs
    lib.rs
    sftp.rs
    ssh.rs
    ssh_config.rs
    storage.rs
    sync.rs
    totp.rs
```

## 4. Modelo de dados

Arquivo-base: [index.ts](/home/fernando/Documentos/ssh_vault/src/types/index.ts)

### Entidades principais

- `SshHost`
  Host salvo no vault, com grupo, tags, notas, cor, TOTP, `jumpHostId`, preset SSH e vínculo opcional com `credentialId`.
- `Credential`
  Credencial reutilizável com `username`, `authMethod`, `password?` e `keyId?`.
- `SshKey`
  Chave SSH persistida separadamente com `privateKeyContent`, `publicKeyContent?` e `passphrase?`.
- `SessionTab`
  Estado volátil de sessão de terminal ou SFTP na janela atual.
- `AppSettings`
  Tema, idioma, terminal, SSH, segurança, sync, grupos e produtividade.

### AppSettings

`AppSettings` hoje inclui:

- `themeId`
- `locale`
- `terminal`
  `fontSize`, `fontFamily`, `cursorStyle`, `cursorBlink`, `scrollback`, `sessionOpenMode`
- `ssh`
  `keepAliveInterval`, `inactivityTimeout`
- `security`
  `masterPasswordSet`, `verificationPayload?`, `syncCredentials`
- `sync`
  `provider`, `autoSync`, `autoSyncIntervalMinutes?`, `lastSyncAt?`, configs por provider
- `groups`
- `productivity`
  `snippets`, `tunnels`, `workspaces`

### Estado portátil

Arquivo-chave: [portableState.ts](/home/fernando/Documentos/ssh_vault/src/lib/portableState.ts)

Esse módulo centraliza a conversão entre:

- estado persistido completo do app
- representação portátil para sync/backup
- segredos cifrados transportáveis

Ele sanitiza e reidrata:

- hosts
- credenciais
- chaves SSH
- settings portáveis
- segredos de sync e backup

## 5. Stores Zustand

### Persistidos

- [hosts.ts](/home/fernando/Documentos/ssh_vault/src/store/hosts.ts)
  CRUD de hosts e `replaceHosts`.
- [credentials.ts](/home/fernando/Documentos/ssh_vault/src/store/credentials.ts)
  CRUD de credenciais e `replaceCredentials`.
- [sshKeys.ts](/home/fernando/Documentos/ssh_vault/src/store/sshKeys.ts)
  CRUD de chaves e `replaceSshKeys`.
- [settings.ts](/home/fernando/Documentos/ssh_vault/src/store/settings.ts)
  Inicialização, normalização, updates parciais e `replaceSettings`.
- [connectionLogs.ts](/home/fernando/Documentos/ssh_vault/src/store/connectionLogs.ts)
  Histórico local de conexões.

### Voláteis

- [sessions.ts](/home/fernando/Documentos/ssh_vault/src/store/sessions.ts)
  Abas/sessões abertas na janela atual.
- [uiStore.ts](/home/fernando/Documentos/ssh_vault/src/store/uiStore.ts)
  Busca, filtros do dashboard e estado da command palette.
- [tunnelRuntime.ts](/home/fernando/Documentos/ssh_vault/src/store/tunnelRuntime.ts)
  Estado de túneis ativos em runtime.

## 6. Rotas React

Arquivo-base: [App.tsx](/home/fernando/Documentos/ssh_vault/src/App.tsx)

Rotas atuais:

- `/`
- `/hosts/new`
- `/hosts/:id`
- `/terminal/:tabId`
- `/sftp/:tabId`
- `/settings`
- `/sync`
- `/backup`
- `/credentials`
- `/credentials/new`
- `/credentials/:id`
- `/ssh-keys`
- `/ssh-keys/new`
- `/ssh-keys/:id`
- `/groups`
- `/connection-log`
- `/operations`
- `/health`

## 7. Bibliotecas do frontend

### Sessões e janelas

- [sessionLauncher.ts](/home/fernando/Documentos/ssh_vault/src/lib/sessionLauncher.ts)
  Decide entre abrir em aba ou janela dedicada.
- [windowMode.ts](/home/fernando/Documentos/ssh_vault/src/lib/windowMode.ts)
  Helpers para rotas e bootstrap de janelas standalone.

### Sync / backup / estado portátil

- [sync.ts](/home/fernando/Documentos/ssh_vault/src/lib/sync.ts)
  `buildSyncPayload`, `parseSyncFile`, `applySyncPayload`.
- [syncProviders.ts](/home/fernando/Documentos/ssh_vault/src/lib/syncProviders.ts)
  Push/pull por provider.
- [backup.ts](/home/fernando/Documentos/ssh_vault/src/lib/backup.ts)
  Export/import `.sshvault`.
- [portableState.ts](/home/fernando/Documentos/ssh_vault/src/lib/portableState.ts)
  Sanitização, merge e reidratação.

### Operações auxiliares

- [health.ts](/home/fernando/Documentos/ssh_vault/src/lib/health.ts)
  Wrapper frontend para health check e inventário de fingerprints.
- [sshConfigImport.ts](/home/fernando/Documentos/ssh_vault/src/lib/sshConfigImport.ts)
  Importação de `~/.ssh/config` e probe TCP simples.
- [productivity.ts](/home/fernando/Documentos/ssh_vault/src/lib/productivity.ts)
  Resolução de snippets e lançamento de túneis.
- [tagColors.ts](/home/fernando/Documentos/ssh_vault/src/lib/tagColors.ts)
  Cores consistentes para tags.
- [hostSearch.ts](/home/fernando/Documentos/ssh_vault/src/lib/hostSearch.ts)
  Busca e utilitários de ordenação/último acesso.

## 8. Comandos Tauri

Arquivo-base: [lib.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/lib.rs)

### Storage / crypto / TOTP

- `get_app_data_dir`
- `encrypt_credentials`
- `decrypt_credentials`
- `verify_master_password`
- `generate_totp_code`
- `verify_totp_code`
- `generate_totp_secret`

### SSH

- `ssh_connect`
- `ssh_send_input`
- `ssh_resize`
- `ssh_disconnect`
- `ssh_copy_id`
- `ssh_generate_key`
- `ssh_exec`
- `ssh_start_tunnel`
- `ssh_stop_tunnel`
- `ssh_list_known_hosts`
- `ssh_health_check`

### SSH config

- `ssh_import_config`
- `ssh_probe_host`

### SFTP

- `sftp_connect`
- `sftp_read_dir`
- `sftp_download`
- `sftp_upload`
- `sftp_mkdir`
- `sftp_delete`
- `sftp_rename`
- `sftp_disconnect`

### Banco

- `db_get_hosts`
- `db_save_host`
- `db_delete_host`
- `db_clear_hosts`
- `db_get_settings`
- `db_save_settings`
- `db_get_credentials`
- `db_save_credential`
- `db_delete_credential`
- `db_clear_credentials`
- `db_get_ssh_keys`
- `db_save_ssh_key`
- `db_delete_ssh_key`
- `db_clear_ssh_keys`
- `db_add_connection_log`
- `db_get_connection_logs`
- `db_clear_connection_logs`

### Sync remoto

- `sync_gist_push`
- `sync_gist_pull`
- `sync_webdav_push`
- `sync_webdav_pull`
- `sync_s3_push`
- `sync_s3_pull`
- `sync_custom_push`
- `sync_custom_pull`

## 9. Sync e backup

### Sync

Arquivos principais:

- [Sync.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Sync.tsx)
- [sync.ts](/home/fernando/Documentos/ssh_vault/src/lib/sync.ts)
- [syncProviders.ts](/home/fernando/Documentos/ssh_vault/src/lib/syncProviders.ts)

O pacote de sync atual inclui:

- `hosts`
- `credentials`
- `sshKeys`
- `settings` portáveis
- `encryptedSecrets?`

Observações:

- `push` envia snapshot local atual
- `pull` importa/mescla conteúdo remoto nas stores locais
- `autoSync` só faz push em background
- segredos cifrados dependem da senha mestra informada no fluxo manual

### Backup

Arquivos principais:

- [Backup.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Backup.tsx)
- [backup.ts](/home/fernando/Documentos/ssh_vault/src/lib/backup.ts)

O arquivo `.sshvault` hoje pode transportar:

- hosts
- credenciais
- chaves SSH
- settings portáveis
- segredos cifrados opcionais

O restore preserva IDs e restaura entidades com `replace*`, evitando perder vínculos entre host, credencial e chave.

## 10. Segurança e segredos

### Onde vivem os segredos

- em memória durante uso
- no banco local para entidades persistidas
- cifrados em sync/backup quando o fluxo usa senha mestra

### O que é sanitizado antes de transportar

- `password` de credenciais
- `totpSecret` de hosts
- `privateKeyContent` e `passphrase` de chaves
- partes sensíveis da configuração de sync

### Fingerprints

O backend mantém inventário TOFU em `known_hosts.json` e agora expõe leitura desse inventário e health check com comparação entre:

- fingerprint atual do host
- fingerprint armazenada localmente

Arquivo principal: [ssh.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh.rs)

## 11. Fluxos importantes

### Quick Connect

- UI: [CommandPalette.tsx](/home/fernando/Documentos/ssh_vault/src/components/CommandPalette.tsx)
- Abre sessão temporária com `user@host[:port]`
- Não cria host salvo

### Sessões em janela dedicada

- Configuração em [Settings.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Settings.tsx)
- Lançamento e bootstrap em [sessionLauncher.ts](/home/fernando/Documentos/ssh_vault/src/lib/sessionLauncher.ts) e [windowMode.ts](/home/fernando/Documentos/ssh_vault/src/lib/windowMode.ts)

### Health check e fingerprints

- Página: [Health.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Health.tsx)
- Backend: [ssh.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh.rs)

### Edição em massa de hosts

- Página: [Dashboard.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Dashboard.tsx)
- Escopo atual:
  - credencial
  - grupo
  - tags (`replace`, `add`, `remove`)

### Importação de `~/.ssh/config`

- UI: [SshConfigImportModal.tsx](/home/fernando/Documentos/ssh_vault/src/components/SshConfigImportModal.tsx)
- Parser/probe: [sshConfigImport.ts](/home/fernando/Documentos/ssh_vault/src/lib/sshConfigImport.ts) e [ssh_config.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh_config.rs)

### Auto-sync

- Hook: [useAutoSync.ts](/home/fernando/Documentos/ssh_vault/src/hooks/useAutoSync.ts)
- Dispara push periódico com base nas settings atuais

---

Se este documento voltar a divergir do código, priorize sempre:

1. [App.tsx](/home/fernando/Documentos/ssh_vault/src/App.tsx)
2. [index.ts](/home/fernando/Documentos/ssh_vault/src/types/index.ts)
3. [lib.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/lib.rs)
4. [sync.ts](/home/fernando/Documentos/ssh_vault/src/lib/sync.ts)
5. [backup.ts](/home/fernando/Documentos/ssh_vault/src/lib/backup.ts)
