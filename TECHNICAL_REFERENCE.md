# MPCM Workspace — Referência Técnica

Documento de referência para desenvolvimento e manutenção do MPCM Workspace no estado atual do projeto.

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
12. Laboratório RDP interno
13. Versionamento

## 1. Visão geral

O MPCM Workspace é uma aplicação desktop Tauri com frontend React e backend Rust para gerenciar:

- hosts `SSH`, `Telnet` e `RDP`
- credenciais reutilizáveis
- chaves SSH
- sessões de terminal multi-protocolo, sessões gráficas `RDP` e SFTP
- barra de abas de sessão com reorganização manual por drag and drop
- snippets, túneis e workspaces
- sincronização remota
- backup/restore
- importação em massa via `.csv`
- health check, inventário de fingerprints e edição manual do inventário `known_hosts`

O posicionamento atual do produto é `Multi-Protocol Connection Manager` e isso já se reflete na arquitetura de sessão: `SSH` e `Telnet` compartilham a camada de terminal, `RDP` usa uma rota e uma orquestração próprias para abrir o launcher nativo da plataforma ou, em modo experimental, o viewer interno empacotado com o app, e recursos específicos como `SFTP`, túneis, inventário de fingerprints, `~/.ssh/config` e MFA/TOTP continuam restritos a `SSH`.

No onboarding de hosts, o app agora combina três caminhos principais:

- cadastro individual pelo fluxo tradicional
- importação de `~/.ssh/config`
- importação em massa por `.csv` com preview e merge controlado

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
    NewConnectionSplitButton.tsx
    Sidebar/Sidebar.tsx
    SshConfigImportModal.tsx
    TabBar/TabBar.tsx
    Terminal/TerminalPane.tsx
    TotpDisplay/TotpDisplay.tsx
    ui/
  hooks/
    useAutoSync.ts
  lib/
    backup.ts
    csvHostImport.ts
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
    About.tsx
    CsvImportPage.tsx
    ConnectionLog.tsx
    CredentialEditor.tsx
    Credentials.tsx
    Dashboard.tsx
    Groups.tsx
    Health.tsx
    HostEditor.tsx
    Operations.tsx
    RdpPage.tsx
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
    rate_limit.rs
    rdp.rs
    sftp.rs
    session_bootstrap.rs
    ssh.rs
    ssh_common.rs
    ssh_config.rs
    storage.rs
    sync.rs
    telnet.rs
    totp.rs
    vnc.rs

experiments/
  internal-rdp-client/
    README.md
    src/
      bin/
        screenshot_mvp.rs
        viewer_mvp.rs
      mvp_runtime.rs
      viewer_input.rs
      viewer_renderer.rs
      protocol/
        tpkt.rs
        x224.rs
```

## 4. Modelo de dados

Arquivo-base: [index.ts](/home/fernando/Documentos/ssh_vault/src/types/index.ts)

### Entidades principais

- `HostEntry`
  Host salvo no vault, com `protocol`, grupo, tags, notas, cor, TOTP, `jumpHostId`, preset SSH e vínculo opcional com `credentialId`.
- `Credential`
  Credencial reutilizável com `username`, `authMethod`, `password?` e `keyId?`.
- `SshKey`
  Chave SSH persistida separadamente com `privateKeyContent`, `publicKeyContent?` e `passphrase?`.
- `SessionTab`
  Estado volátil de sessão de terminal, SFTP ou RDP na janela atual. A ordem do array também define a ordem visual das abas e pode ser reorganizada pelo usuário.
- `TerminalPaneState`
  Estado de cada pane de terminal, compartilhado por sessões `SSH` e `Telnet`.
- `AppSettings`
  Tema, idioma, terminal, SSH, RDP, segurança, sync, grupos e produtividade.

### AppSettings

`AppSettings` hoje inclui:

- `themeId`
- `locale`
- `terminal`
  `fontSize`, `fontFamily`, `cursorStyle`, `cursorBlink`, `scrollback`, `sessionOpenMode`
- `ssh`
  `keepAliveInterval`, `inactivityTimeout`
- `rdp`
  `launchMode`, `linuxClient`, `fullscreen`, `dynamicResolution`, `width`, `height`, `multimon`, `clipboard`, `audioMode`, `certificateMode`, `internalClientPerformance`
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

O campo `protocol` do host é parte desse estado portátil e é preservado em sync, backup e restore.

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
  Abas/sessões abertas na janela atual, incluindo a ordem visual usada pela `TabBar` e a ação de reordenação manual.
- [uiStore.ts](/home/fernando/Documentos/ssh_vault/src/store/uiStore.ts)
  Busca, filtros do dashboard e estado da command palette.
- [tunnelRuntime.ts](/home/fernando/Documentos/ssh_vault/src/store/tunnelRuntime.ts)
  Estado de túneis ativos em runtime.

## 6. Rotas React

Arquivo-base: [App.tsx](/home/fernando/Documentos/ssh_vault/src/App.tsx)

Rotas atuais:

- `/`
- `/hosts/new`
- `/hosts/import/csv`
- `/hosts/:id`
- `/terminal/:tabId`
- `/rdp/:tabId`
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
- `/about`

## 7. Bibliotecas do frontend

### Sessões e janelas

- [sessionLauncher.ts](/home/fernando/Documentos/ssh_vault/src/lib/sessionLauncher.ts)
  Decide entre abrir em aba ou janela dedicada para sessões de terminal e RDP.
- [windowMode.ts](/home/fernando/Documentos/ssh_vault/src/lib/windowMode.ts)
  Helpers para rotas e bootstrap de janelas standalone.
- [RdpPage.tsx](/home/fernando/Documentos/ssh_vault/src/pages/RdpPage.tsx)
  Orquestra a conexão RDP, exibe diagnósticos de launcher e acompanha o ciclo de vida da sessão.

### Branding e identidade

- O branding visível do app foi atualizado para `MPCM Workspace`
- O subtítulo usado na documentação e na página `About` é `Multi-Protocol Connection Manager`
- O diretório de dados atual é `mpcm-workspace`, com migração automática a partir do legado `ssh-vault`
- Identificadores internos legados como `name` do pacote, `identifier` do bundle e alguns marcadores de compatibilidade continuam preservados para evitar migrações destrutivas de dados existentes

### Consciência de protocolo

- [productivity.ts](/home/fernando/Documentos/ssh_vault/src/lib/productivity.ts)
  Centraliza capacidades por protocolo para snippets, workspaces, batch execution e túneis.
- [portableState.ts](/home/fernando/Documentos/ssh_vault/src/lib/portableState.ts)
  Normaliza e preserva `protocol` durante import/export e sync.
- [sessionLauncher.ts](/home/fernando/Documentos/ssh_vault/src/lib/sessionLauncher.ts)
  Lança janelas dedicadas de sessão usando fluxo compartilhado para terminal e RDP.
- [csvHostImport.ts](/home/fernando/Documentos/ssh_vault/src/lib/csvHostImport.ts)
  Centraliza parsing, validação, matching, template e plano de aplicação para importação em massa por `.csv`.

### RDP no app principal

- [rdp.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/rdp.rs)
  Gera arquivos `.rdp` temporários, aplica opções de sessão, traduz preferências visuais para launchers compatíveis, aciona o launcher nativo apropriado por plataforma e também expõe o comando `rdp_launch_internal_viewer` para o modo experimental.
- [RdpPage.tsx](/home/fernando/Documentos/ssh_vault/src/pages/RdpPage.tsx)
  Conecta a aba RDP ao backend, escolhe entre launcher nativo e viewer interno experimental conforme `launchMode`, e mostra launcher escolhido, preview dos argumentos e estado da sessão.
- [Settings.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Settings.tsx)
  Expõe preferências globais de `launchMode`, cliente Linux, resolução, fullscreen, multimonitor, clipboard, áudio, certificado e preferências visuais da sessão com indicação de compatibilidade.
- [internalRdpViewer.ts](/home/fernando/Documentos/ssh_vault/src/lib/internalRdpViewer.ts)
  Ponte do frontend para o comando Tauri que abre o viewer interno experimental.

### Base técnica do viewer RDP interno

- [experiments/internal-rdp-client/README.md](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/README.md)
  Documento-base do laboratório isolado que continua servindo como base técnica do viewer experimental usado pelo app principal.
- [experiments/internal-rdp-client/src/mvp_runtime.rs](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/src/mvp_runtime.rs)
  Contrato atual de conexão, perfil de sessão, loop ativo e coleta de regiões alteradas.
- [experiments/internal-rdp-client/src/viewer_input.rs](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/src/viewer_input.rs)
  Tradutor de input local do `minifb` para eventos FastPath do RDP.
- [experiments/internal-rdp-client/src/viewer_renderer.rs](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/src/viewer_renderer.rs)
  Buffer local e redraw parcial do viewer.
- [experiments/internal-rdp-client/src/settings_bridge.rs](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/src/settings_bridge.rs)
  Ponte entre o payload vindo do app principal e as configurações efetivamente consumidas pelo viewer experimental.
- [experiments/internal-rdp-client/src/bin/viewer_mvp.rs](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/src/bin/viewer_mvp.rs)
  Viewer MVP para conexão real.
- [experiments/internal-rdp-client/src/bin/screenshot_mvp.rs](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/src/bin/screenshot_mvp.rs)
  Captura de screenshot remoto.

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
- [csvHostImport.ts](/home/fernando/Documentos/ssh_vault/src/lib/csvHostImport.ts)
  Importação de hosts via `.csv`, geração de template/exemplo e definição do comportamento de `add` vs `merge`.
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
- `store_quick_connect_bootstrap`
- `get_quick_connect_bootstrap`

### SSH

- `ssh_connect`
- `ssh_send_input`
- `ssh_resize`
- `ssh_disconnect`
- `ssh_session_exists`
- `ssh_trust_host`
- `ssh_copy_id`
- `ssh_generate_key`
- `ssh_exec`
- `ssh_start_tunnel`
- `ssh_stop_tunnel`
- `ssh_list_known_hosts`
- `ssh_set_known_host`
- `ssh_delete_known_host`
- `ssh_health_check`

### Telnet

- `telnet_connect`
- `telnet_send_input`
- `telnet_resize`
- `telnet_disconnect`
- `telnet_session_exists`

### RDP

- `rdp_connect`
- `rdp_disconnect`
- `rdp_session_exists`

### SSH config

- `ssh_import_config`
- `ssh_apply_imported_config`
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
- `sftp_session_exists`

### Eventos de terminal

- `terminal-output`
  Canal compartilhado de saída para sessões `SSH` e `Telnet`.
- `terminal-status`
  Canal compartilhado de status para sessões `SSH` e `Telnet`, usado para `connecting`, `connected`, `error` e `disconnected`.

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

O `protocol` de cada host faz parte desse pacote e é preservado durante `push`, `pull` e merge local.

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

O campo `protocol` do host também é preservado no backup, então restores mantêm a diferenciação entre `SSH`, `Telnet` e `RDP`.

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

O backend mantém inventário TOFU em `known_hosts.json` e agora expõe leitura, criação, edição e remoção desse inventário, além do health check com comparação entre:

- fingerprint atual do host
- fingerprint armazenada localmente

Esse `known_hosts.json` é interno da aplicação e não substitui nem edita o arquivo `~/.ssh/known_hosts` do sistema operacional.

Esse fluxo continua sendo específico de `SSH`; hosts `Telnet` ficam fora do inventário e do health check de fingerprint.
Hosts `RDP` também ficam fora desse escopo.

Arquivo principal: [ssh.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh.rs)

### Módulo compartilhado SSH/SFTP

[ssh_common.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh_common.rs) centraliza o código compartilhado entre `ssh.rs` e `sftp.rs`:

- constantes de algoritmos legados (`LEGACY_KEX`, `LEGACY_CIPHER`, `LEGACY_MAC`, `LEGACY_KEY`, `LEGACY_COMPRESSION`)
- `build_ssh_config` — constrói a configuração `russh` por preset
- `KnownHostsHandler` — handler TOFU unificado para SSH e SFTP
- `load_known_hosts` / `save_known_hosts` — persistência do inventário de fingerprints
- utilitários: `trim_owned`, `trim_optional_owned`, `format_host_key`

### Rate limiting

[rate_limit.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/rate_limit.rs) implementa um rate limiter de janela deslizante por chave dinâmica. A chave aceita qualquer `&str`, permitindo granularidade por operação e alvo — por exemplo, `"ssh_connect:192.168.1.1"` limita tentativas por host individualmente.

## 11. Fluxos importantes

### Quick Connect

- UI: [CommandPalette.tsx](/home/fernando/Documentos/ssh_vault/src/components/CommandPalette.tsx)
- Abre sessão temporária para `SSH`, `Telnet` e `RDP`
- Não cria host salvo

Para `RDP`, o formato suportado é `rdp://usuario@host:porta` e a sessão usa o mesmo fluxo dos hosts persistidos, respeitando o `launchMode` ativo entre launcher nativo e viewer interno experimental.

### Sessões em janela dedicada

- Configuração em [Settings.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Settings.tsx)
- Lançamento e bootstrap em [sessionLauncher.ts](/home/fernando/Documentos/ssh_vault/src/lib/sessionLauncher.ts) e [windowMode.ts](/home/fernando/Documentos/ssh_vault/src/lib/windowMode.ts)

### Sessões RDP nativas

- Página: [RdpPage.tsx](/home/fernando/Documentos/ssh_vault/src/pages/RdpPage.tsx)
- Backend: [rdp.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/rdp.rs)
- Linux:
  `auto`, `xfreerdp`, `wlfreerdp`, `remmina` e `krdc`
- Windows:
  `mstsc`, com tentativa de pré-carregar credenciais via `cmdkey`
- macOS e outros ambientes:
  abertura do arquivo `.rdp` no app associado do sistema

#### Matriz de preferências visuais RDP

- `wallpaper`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário para clientes externos que respeitem esse atributo.
- `fullWindowDrag`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário.
- `menuAnimations`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário.
- `theming`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário.
- `cursorSettings`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário.
- `fontSmoothing`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário.
- `desktopComposition`
  Melhor com `xfreerdp` e `wlfreerdp`; também é serializado no `.rdp` temporário.
- `cursorShadow`
  No estado atual, tratado como `somente viewer interno`. Ainda não há mapeamento externo confiável no backend.

Regras práticas:

- `xfreerdp` e `wlfreerdp`
  Recebem flags explícitas de linha de comando e são os clientes externos com melhor aderência a essas preferências.
- `mstsc`, `Remmina`, `KRDC` e abertura do `.rdp` no app associado
  Podem aproveitar parte das preferências serializadas no arquivo `.rdp`, mas o comportamento depende do cliente e da plataforma.

#### Checklist de fechamento do RDP

- [x] Definir o destino de `cursorShadow`
  Tratado oficialmente como `somente viewer interno`. A UI já sinaliza essa limitação e o backend nativo não tenta mapear essa preferência para launchers externos.
- [ ] Validar a matriz de suporte em clientes reais
  Confirmar comportamento prático em `xfreerdp`, `wlfreerdp`, `mstsc`, `Remmina` e `KRDC` para fullscreen, resolução, clipboard, áudio e preferências visuais. Este item ainda depende de ambientes com esses clientes instalados.
- [x] Decidir o status de produto do viewer interno
  O viewer interno permanece experimental. O caminho oficial do produto continua sendo o launcher nativo por plataforma.
- [x] Fechar distribuição/empacotamento do viewer interno
  O viewer interno agora pode ser empacotado como recurso do app compilado para a plataforma atual. Mesmo assim, ele continua classificado como experimental e o launcher nativo segue como caminho oficial recomendado.
- [x] Ampliar cobertura de testes do backend RDP
  O backend agora tem builders testáveis para argumentos do FreeRDP e serialização do arquivo `.rdp`, com testes unitários cobrindo display, áudio, preferências visuais, preview sanitizado e clamps de dimensão.
- [x] Consolidar documentação final para usuário e manutenção
  A matriz de compatibilidade e a política do viewer interno foram consolidadas nesta referência técnica, no README e na UI de configurações.

### Health check e fingerprints

- Página: [Health.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Health.tsx)
- Backend: [ssh.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh.rs)
- Escopo atual: somente hosts `SSH`
- O inventário é persistido em `known_hosts.json` dentro do diretório de dados do app
- A UI permite criar, editar e excluir entradas manualmente
- Entradas órfãs, que já não correspondem a hosts cadastrados, são destacadas para revisão/limpeza
- O health check continua comparando a fingerprint lida no host com a fingerprint armazenada localmente

### Edição em massa de hosts

- Página: [Dashboard.tsx](/home/fernando/Documentos/ssh_vault/src/pages/Dashboard.tsx)
- Escopo atual:
  - credencial
  - grupo
  - tags (`replace`, `add`, `remove`)

### Importação de `~/.ssh/config`

- UI: [SshConfigImportModal.tsx](/home/fernando/Documentos/ssh_vault/src/components/SshConfigImportModal.tsx)
- Parser/probe: [sshConfigImport.ts](/home/fernando/Documentos/ssh_vault/src/lib/sshConfigImport.ts) e [ssh_config.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/ssh_config.rs)

### Importação em massa por CSV

- UI: [CsvImportPage.tsx](/home/fernando/Documentos/ssh_vault/src/pages/CsvImportPage.tsx)
- Entrada principal: [NewConnectionSplitButton.tsx](/home/fernando/Documentos/ssh_vault/src/components/NewConnectionSplitButton.tsx)
- Parser e plano de aplicação: [csvHostImport.ts](/home/fernando/Documentos/ssh_vault/src/lib/csvHostImport.ts)

Fluxo atual:

- o CTA principal `+ Nova Conexão` continua abrindo `/hosts/new`
- o menu secundário expõe `Importar via CSV` e `Importar ~/.ssh/config`
- a tela CSV permite salvar template vazio, salvar exemplo preenchido e importar um arquivo
- o preview classifica linhas como `new`, `matched` ou `invalid`
- o usuário escolhe entre `add` e `merge` antes de aplicar

Regras da importação CSV:

- obrigatórios: `label`, `protocol`, `host`
- opcionais: `id`, `port`, `username`, `authMethod`, `group`, `tags`, `notes`, `color`, `keepAliveInterval`, `connectionTimeout`, `sshCompatPreset`
- `tags` aceitam `;` ou `,`
- defaults de porta: `22` para `ssh`, `23` para `telnet`, `3389` para `rdp`
- defaults de `authMethod`: `agent` para `ssh`, `password` para `telnet` e `rdp`
- matching de atualização:
  - primeiro por `id`, quando informado
  - depois por `protocol + host + port + username`
- segredos não entram no CSV v1:
  - senha
  - chave privada
  - passphrase
  - TOTP

### Auto-sync

- Hook: [useAutoSync.ts](/home/fernando/Documentos/ssh_vault/src/hooks/useAutoSync.ts)
- Dispara push periódico com base nas settings atuais

## 12. Laboratório RDP interno

O cliente RDP interno já pode ser acionado pelo app principal em modo experimental. Ainda assim, o repositório mantém um laboratório isolado em [experiments/internal-rdp-client/README.md](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/README.md) para permitir evolução técnica contínua sem acoplar toda a experimentação diretamente ao restante da aplicação.

Decisão atual de produto:

- o launcher RDP nativo continua sendo o caminho oficial recomendado
- o viewer interno permanece experimental
- o binário do protótipo pode ser incluído no app compilado por meio do empacotamento de recursos do Tauri
- o app principal pode abrir esse viewer quando `launchMode = internalExperimental`

Estado atual desse laboratório:

- conexão real com servidor RDP usando `IronRDP`
- autenticação com usuário e senha
- viewer local em janela nativa com `minifb`
- screenshot remoto em `.png`
- input básico de teclado e mouse
- scroll vertical e horizontal
- ponteiro remoto visível no viewer
- redraw parcial e tuning de fluidez no loop de render
- parâmetros de resolução, profundidade de cor e compressão no CLI
- suporte a múltiplos monitores (multimon)

### Suporte a múltiplos monitores

O servidor recebe o layout de monitores via `--monitor left:top:width:height[:primary]` e renderiza um único desktop em bounding box cobrindo todos os monitores. O viewer fatia esse buffer por monitor, usando `ViewerBuffer::slice` para extrair as linhas de cada tela.

#### Modo janela com multimon

O viewer cria uma única janela no tamanho configurado pelo app (ou no tamanho do bounding box se não houver override). O mouse funciona imediatamente ao passar por cima, sem necessidade de clicar. A janela mostra o desktop completo; as coordenadas de mouse são mapeadas de volta para o espaço global do bounding box usando `normalize_mouse_position` com o offset de cada monitor.

#### Modo fullscreen com multimon

O viewer cria uma janela por monitor, cada uma no tamanho exato do respectivo monitor. As janelas recebem títulos com número do monitor e resolução para facilitar identificação.

- **Windows**: `set_position()` e `topmost()` são chamados após a criação de cada janela, posicionando-as automaticamente sobre os monitores físicos correspondentes.
- **Linux/Wayland**: o protocolo `xdg_toplevel` não suporta posicionamento explícito de janela; o compositor posiciona as janelas à sua escolha. O usuário precisa arrastar cada janela para o monitor correto manualmente.

#### Estado de mouse por janela

Cada janela mantém seu próprio `MouseInputState`, eliminando o problema de oscilação de cursor entre janelas sobrepostas que ocorria com estado compartilhado. No modo fullscreen, as janelas estão em monitores físicos separados, então não há sobreposição e o input de cada janela é processado independentemente.

#### Diagnóstico

O stderr do viewer é redirecionado para `/tmp/ssh_vault_viewer.log` em modo append. O viewer imprime no stderr:

- tamanho do desktop e número de monitores
- layout de cada monitor (posição, dimensões, primary)
- confirmação de criação de cada janela

Separação interna atual do protótipo:

- `mvp_runtime`
  conexão, handshake, perfil de sessão, loop ativo e resumo de regiões alteradas
- `viewer_input`
  tradução de input local para eventos FastPath; `normalize_mouse_position` escala coordenadas de display para buffer e aplica offset global de monitor
- `viewer_renderer`
  buffer local e atualização parcial do frame; `ViewerBuffer::slice` extrai sub-região por monitor para o modo multimon
- `bin/viewer_mvp`
  composição do viewer; `run_single_window` para janela única, `run_multi_window` para fullscreen multimon
- `bin/screenshot_mvp`
  composição do fluxo de captura

Essa separação é intencional: o objetivo é chegar a um contrato claro para integração futura com `Tauri`, em vez de acoplar cedo demais um MVP experimental ao app principal.

## 13. Versionamento

Arquivos principais:

- [package.json](/home/fernando/Documentos/ssh_vault/package.json)
- [scripts/sync-version.mjs](/home/fernando/Documentos/ssh_vault/scripts/sync-version.mjs)
- [src-tauri/tauri.conf.json](/home/fernando/Documentos/ssh_vault/src-tauri/tauri.conf.json)
- [src/lib/appInfo.ts](/home/fernando/Documentos/ssh_vault/src/lib/appInfo.ts)

Estado atual:

- versão de referência atual do app: `0.3.8`
- `package.json` é a fonte principal da versão do app
- `tauri.conf.json` lê a versão a partir de `../package.json`
- o frontend lê a versão a partir de `package.json` via `appInfo.ts`
- `Cargo.toml`, `Cargo.lock` e `package-lock.json` continuam precisando de sincronização física no repositório

Fluxo recomendado para bump de versão:

1. Atualizar `version` em [package.json](/home/fernando/Documentos/ssh_vault/package.json).
2. Rodar `npm run version:sync`.
3. Validar com `npm run build`.

O script [sync-version.mjs](/home/fernando/Documentos/ssh_vault/scripts/sync-version.mjs) hoje sincroniza:

- [package-lock.json](/home/fernando/Documentos/ssh_vault/package-lock.json)
- [src-tauri/Cargo.toml](/home/fernando/Documentos/ssh_vault/src-tauri/Cargo.toml)
- [src-tauri/Cargo.lock](/home/fernando/Documentos/ssh_vault/src-tauri/Cargo.lock)

---

Se este documento voltar a divergir do código, priorize sempre:

1. [App.tsx](/home/fernando/Documentos/ssh_vault/src/App.tsx)
2. [index.ts](/home/fernando/Documentos/ssh_vault/src/types/index.ts)
3. [lib.rs](/home/fernando/Documentos/ssh_vault/src-tauri/src/lib.rs)
4. [sync.ts](/home/fernando/Documentos/ssh_vault/src/lib/sync.ts)
5. [backup.ts](/home/fernando/Documentos/ssh_vault/src/lib/backup.ts)
