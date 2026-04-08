# MPCM Workspace

MPCM Workspace é um `Multi-Protocol Connection Manager` local-first para organizar conexões remotas e operar infraestrutura a partir de um único workspace.

Stack principal: `Tauri 2` + `Rust` + `React 19` + `TypeScript` + `Zustand` + `Tailwind CSS`.

## Versão atual

`0.3.0`

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
- Operações com snippets, túneis e workspaces com compatibilidade por protocolo
- `Health check` de hosts e inventário de fingerprints salvas para hosts `SSH`
- Backup/restore com arquivo `.sshvault`, preservando o protocolo de cada host
- Sincronização remota com `GitHub Gist`, `S3/MinIO`, `WebDAV/Nextcloud` ou endpoint customizado
- Auto-sync periódico de estado portátil
- MFA/TOTP por host `SSH`
- Interface traduzida para `pt-BR` e `en-US`

Hoje o app já opera como `Multi-Protocol Connection Manager`, com `SSH` e `Telnet` compartilhando a infraestrutura de terminal e `RDP` sendo tratado como sessão gráfica aberta no cliente nativo da plataforma.

## Escopo por protocolo

- `SSH`
  Terminal completo, SFTP, snippets remotos, batch execution, túneis, health check, inventário de fingerprints, MFA/TOTP, import de `~/.ssh/config`, jump host e presets de compatibilidade.
- `Telnet`
  Terminal interativo com múltiplas abas, quick connect, workspaces e preservação de sessão entre trocas de aba.
- `RDP`
  Sessão gráfica via launcher nativo, quick connect, abertura em aba ou janela dedicada, escolha de cliente no Linux e opções globais de resolução, fullscreen, multimonitor, clipboard, áudio e certificado.
- `SFTP`
  Continua sendo um recurso derivado de `SSH`, então não aparece para hosts `Telnet`.

## Arquitetura em alto nível

- `Frontend`
  React Router organiza as páginas, Zustand mantém estado local e persistido, e a UI roda dentro do WebView do Tauri. O terminal do frontend foi neutralizado para servir `SSH` e `Telnet` com a mesma infraestrutura visual, enquanto `RDP` usa uma página de sessão própria para orquestrar o launcher nativo.
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
  hooks/
  lib/
  locales/
  pages/
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

## Arquivos de referência

- [README.md](/home/fernando/Documentos/ssh_vault/README.md)
- [TECHNICAL_REFERENCE.md](/home/fernando/Documentos/ssh_vault/TECHNICAL_REFERENCE.md)
- [melhorias.txt](/home/fernando/Documentos/ssh_vault/melhorias.txt)

## Situação atual

O projeto já cobre o núcleo operacional multi-protocolo atual e inclui:

- Quick Connect
- janelas dedicadas de sessão
- suporte consolidado a `Telnet`
- suporte inicial a `RDP` via launcher nativo
- seleção de cliente RDP no Linux
- opções globais de sessão RDP
- health check e inventário de fingerprints
- edição em massa de hosts
- sync/backup alinhados com hosts, credenciais, chaves SSH, protocolo e settings portáveis
- página `About` com identidade e posicionamento do produto

## Licença

Uso interno / conforme a política do repositório.
