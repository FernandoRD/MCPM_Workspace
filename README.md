# MPCM Workspace

MPCM Workspace é um `Multi-Protocol Connection Manager` local-first para organizar conexões remotas e operar infraestrutura a partir de um único workspace.

Stack principal: `Tauri 2` + `Rust` + `React 19` + `TypeScript` + `Zustand` + `Tailwind CSS`.

## Versão atual

`0.3.2`

## Novidades da 0.3.2

- Importação em massa de hosts via `.csv`, com template, exemplo, preview por linha e aplicação controlada
- Novo fluxo de criação com `split button` em `+ Nova Conexão`, mantendo o cadastro individual rápido e adicionando atalhos para importações
- Tela dedicada para importação em massa por CSV, com modos `Adicionar novos` e `Atualizar existentes`
- Centralização prática do versionamento: `package.json` passou a ser a fonte principal e o projeto agora inclui um script de sincronização para `Cargo.toml`, `Cargo.lock` e `package-lock.json`
- Laboratório isolado para cliente RDP interno em `experiments/internal-rdp-client`, com viewer local, screenshot, input básico e tuning de fluidez sem impacto no app principal

## Novidades da 0.3.0

- Suporte nativo a `RDP` com abertura por launcher externo, mantendo `SSH` e `Telnet` no mesmo workspace
- `Quick Connect` para `rdp://usuario@host:porta`, além dos fluxos já existentes para `SSH` e `Telnet`
- Seleção de cliente RDP no Linux entre `Automático`, `xfreerdp`, `wlfreerdp`, `Remmina` e `KRDC`
- Opções globais de sessão RDP para resolução, fullscreen, multimonitor, clipboard, áudio e política de certificado
- Integração com `mstsc` no Windows e tentativa de pré-carregar credenciais antes da abertura da sessão
- Migração automática do diretório de dados legado `ssh-vault` para `mpcm-workspace`

## O que o app faz hoje

- Cadastro de hosts com protocolo `SSH`, `Telnet` ou `RDP`, além de `grupos`, `tags`, `notas`, `cores`, `jump host` e presets de compatibilidade SSH
- Credenciais reutilizáveis separadas dos hosts
- Chaves SSH próprias, com geração de fingerprint e vínculo por credencial
- Terminal integrado com `xterm.js`, múltiplas abas, split pane e reanexação de sessão por aba
- Página dedicada para sessões `RDP`, com monitoramento da sessão lançada no cliente nativo do sistema
- SFTP integrado para hosts `SSH`, com navegação remota, upload, download, rename, delete e mkdir
- `Quick Connect` na command palette para conexões temporárias `SSH`, `Telnet` e `RDP` sem salvar host
- Opção para abrir sessões na `mesma janela` ou em `janelas dedicadas`
- Dashboard com filtros por grupo/tag, ordenação e edição em massa de `credencial`, `grupo` e `tags`
- Importação em massa de hosts via `.csv`, com template/export de exemplo, preview e merge controlado
- Acesso às importações direto pelo `+ Nova Conexão`, sem atrapalhar o fluxo principal de cadastro individual
- Operações com snippets, túneis e workspaces com compatibilidade por protocolo
- `Health check` de hosts e inventário de fingerprints salvas para hosts `SSH`
- Backup/restore com arquivo `.sshvault`, preservando o protocolo de cada host
- Sincronização remota com `GitHub Gist`, `S3/MinIO`, `WebDAV/Nextcloud` ou endpoint customizado
- Auto-sync periódico de estado portátil
- MFA/TOTP por host `SSH`
- Interface traduzida para `pt-BR` e `en-US`

Hoje o app já opera como `Multi-Protocol Connection Manager`, com `SSH` e `Telnet` compartilhando a infraestrutura de terminal e `RDP` sendo tratado como sessão gráfica aberta no cliente nativo da plataforma.

Em paralelo, o repositório agora mantém um laboratório isolado para o futuro cliente RDP interno em [experiments/internal-rdp-client/README.md](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/README.md). Esse protótipo ainda não está integrado ao app principal, mas já consegue conectar, autenticar, renderizar a sessão remota, enviar input e capturar screenshots.

## Escopo por protocolo

- `SSH`
  Terminal completo, SFTP, snippets remotos, batch execution, túneis, health check, inventário de fingerprints, MFA/TOTP, import de `~/.ssh/config`, importação em massa via `.csv`, jump host e presets de compatibilidade.
- `Telnet`
  Terminal interativo com múltiplas abas, quick connect, workspaces, preservação de sessão entre trocas de aba e suporte ao cadastro/import em massa via `.csv`.
- `RDP`
  Sessão gráfica via launcher nativo, quick connect, abertura em aba ou janela dedicada, escolha de cliente no Linux, opções globais de resolução, fullscreen, multimonitor, clipboard, áudio e certificado, além de suporte ao cadastro/import em massa via `.csv`.
- `SFTP`
  Continua sendo um recurso derivado de `SSH`, então não aparece para hosts `Telnet`.

## Arquitetura em alto nível

- `Frontend`
  React Router organiza as páginas, Zustand mantém estado local e persistido, e a UI roda dentro do WebView do Tauri. O terminal do frontend foi neutralizado para servir `SSH` e `Telnet` com a mesma infraestrutura visual, enquanto `RDP` usa uma página de sessão própria para orquestrar o launcher nativo. Os fluxos de onboarding agora incluem cadastro único, importação de `~/.ssh/config` e importação em massa por `.csv`.
- `Backend`
  O backend em Rust expõe comandos Tauri para terminal `SSH`/`Telnet`, SFTP, `RDP`, sync, criptografia, TOTP e persistência.
- `Persistência`
  Hosts, credenciais, chaves SSH, logs e settings ficam em SQLite; o host persiste o `protocol`; estado volátil de sessão fica em memória por janela; arquivos temporários `.rdp` e metadados de sessão ficam no diretório de dados da aplicação.
- `Segredos`
  Segredos sensíveis podem ser exportados/sincronizados de forma cifrada com senha mestra usando `Argon2id + AES-256-GCM`.

## Branding e compatibilidade

- O nome visível do produto é `MPCM Workspace`
- A classificação usada na documentação é `Multi-Protocol Connection Manager`
- O diretório de dados atual é `mpcm-workspace`, com migração automática do legado `ssh-vault`
- Identificadores internos legados como `name`, `identifier` e alguns marcadores de compatibilidade continuam preservados para evitar quebra de instalações e dados existentes

## Sync e backup

### Sync

- O payload de sync inclui hosts, credenciais, chaves SSH e configurações portáveis
- O protocolo do host viaja no payload portátil e é restaurado em import, restore e sync
- O `push` publica o snapshot local atual no provider
- O `pull` importa/mescla o conteúdo remoto no estado local
- Auto-sync faz `push` em background sem prompt de senha mestra, então segredos cifrados dependentes da senha não entram nesse fluxo

### Backup

- Exporta para arquivo `.sshvault`
- Preserva o protocolo de cada host no backup
- Pode incluir segredos cifrados quando a senha mestra é informada
- Restore preserva IDs de hosts, credenciais e chaves, evitando quebrar vínculos internos

## Estrutura principal

```text
src/
  components/
    NewConnectionSplitButton.tsx
  hooks/
  lib/
    csvHostImport.ts
  locales/
  pages/
    CsvImportPage.tsx
    RdpPage.tsx
  store/
  themes/
  types/
src-tauri/
  src/
    crypto.rs
    database.rs
    rdp.rs
    sftp.rs
    ssh.rs
    ssh_config.rs
    storage.rs
    sync.rs
    telnet.rs
    totp.rs
scripts/
  sync-version.mjs
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
```

## Rodando o projeto

### Requisitos

- `Node.js 18+`
- `Rust stable`
- Dependências nativas exigidas pelo Tauri para a sua plataforma

### Instalação

```bash
npm install
```

### Desenvolvimento web

```bash
npm run dev
```

### Desenvolvimento desktop com Tauri

```bash
npm run tauri dev
```

### Build do frontend

```bash
npm run build
```

### Build desktop

```bash
npm run tauri build
```

## Versionamento

O projeto agora usa o [package.json](/home/fernando/Documentos/ssh_vault/package.json) como fonte principal da versão da aplicação.

Arquivos sincronizados a partir dele:

- [package-lock.json](/home/fernando/Documentos/ssh_vault/package-lock.json)
- [src-tauri/Cargo.toml](/home/fernando/Documentos/ssh_vault/src-tauri/Cargo.toml)
- [src-tauri/Cargo.lock](/home/fernando/Documentos/ssh_vault/src-tauri/Cargo.lock)
- [src-tauri/tauri.conf.json](/home/fernando/Documentos/ssh_vault/src-tauri/tauri.conf.json) já aponta para o `package.json`
- [src/lib/appInfo.ts](/home/fernando/Documentos/ssh_vault/src/lib/appInfo.ts) lê a versão direto do `package.json`

Fluxo recomendado para atualizar a versão:

1. Edite o campo `version` em [package.json](/home/fernando/Documentos/ssh_vault/package.json).
2. Rode `npm run version:sync`.
3. Se quiser validar o pacote final, rode `npm run build`.

## Arquivos de referência

- [README.md](/home/fernando/Documentos/ssh_vault/README.md)
- [TECHNICAL_REFERENCE.md](/home/fernando/Documentos/ssh_vault/TECHNICAL_REFERENCE.md)
- [experiments/internal-rdp-client/README.md](/home/fernando/Documentos/ssh_vault/experiments/internal-rdp-client/README.md)
- [melhorias.txt](/home/fernando/Documentos/ssh_vault/melhorias.txt)

## Situação atual

O projeto já cobre o núcleo operacional multi-protocolo atual e inclui:

- Quick Connect
- janelas dedicadas de sessão
- suporte consolidado a `Telnet`
- suporte inicial a `RDP` via launcher nativo
- importação em massa via `.csv`
- fluxo de `+ Nova Conexão` com menu de ações
- seleção de cliente RDP no Linux
- opções globais de sessão RDP
- health check e inventário de fingerprints
- edição em massa de hosts
- sync/backup alinhados com hosts, credenciais, chaves SSH, protocolo e settings portáveis
- página `About` com identidade e posicionamento do produto

## Licença

Uso interno / conforme a política do repositório.
