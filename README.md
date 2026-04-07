# MPCM Workspace

MPCM Workspace é um `Multi-Protocol Connection Manager` local-first para organizar conexões remotas e operar infraestrutura a partir de um único workspace.

Stack principal: `Tauri 2` + `Rust` + `React 19` + `TypeScript` + `Zustand` + `Tailwind CSS`.

## Versão atual

`0.2.0`

## Novidades da 0.2.0

- Suporte inicial a múltiplos protocolos com `SSH` e `Telnet`
- Terminal unificado para sessões remotas, com nomenclatura e eventos internos neutros ao protocolo
- Áreas de `Operations`, `Workspaces`, `Health`, `Backup` e `About` ajustadas para operar com consciência de protocolo
- Reaproveitamento de sessões ao trocar de abas, evitando reconexão automática em SSH e SFTP
- Preservação melhor de estado visual entre abas, incluindo buffer recente do terminal e contexto do SFTP
- Correções acumuladas da série `0.1.x`, como sanitização de entradas, upload SFTP com nome correto, desconexão pelo SFTP e estabilização da primeira conexão SSH após confiança de fingerprint

## O que o app faz hoje

- Cadastro de hosts com protocolo `SSH` ou `Telnet`, além de `grupos`, `tags`, `notas`, `cores`, `jump host` e presets de compatibilidade SSH
- Credenciais reutilizáveis separadas dos hosts
- Chaves SSH próprias, com geração de fingerprint e vínculo por credencial
- Terminal integrado com `xterm.js`, múltiplas abas, split pane e reanexação de sessão por aba
- SFTP integrado para hosts `SSH`, com navegação remota, upload, download, rename, delete e mkdir
- `Quick Connect` na command palette para conexões temporárias sem salvar host
- Opção para abrir sessões na `mesma janela` ou em `janelas dedicadas`
- Dashboard com filtros por grupo/tag, ordenação e edição em massa de `credencial`, `grupo` e `tags`
- Operações com snippets, túneis e workspaces com compatibilidade por protocolo
- `Health check` de hosts e inventário de fingerprints salvas para hosts `SSH`
- Backup/restore com arquivo `.sshvault`, preservando o protocolo de cada host
- Sincronização remota com `GitHub Gist`, `S3/MinIO`, `WebDAV/Nextcloud` ou endpoint customizado
- Auto-sync periódico de estado portátil
- MFA/TOTP por host `SSH`
- Interface traduzida para `pt-BR` e `en-US`

Hoje o app já opera como `Multi-Protocol Connection Manager`, com `Telnet` entrando como protocolo de terminal e os recursos específicos de `SSH` continuando disponíveis apenas onde fazem sentido.

## Escopo por protocolo

- `SSH`
  Terminal completo, SFTP, snippets remotos, batch execution, túneis, health check, inventário de fingerprints, MFA/TOTP, import de `~/.ssh/config`, jump host e presets de compatibilidade.
- `Telnet`
  Terminal interativo com múltiplas abas, quick connect, workspaces e preservação de sessão entre trocas de aba.
- `SFTP`
  Continua sendo um recurso derivado de `SSH`, então não aparece para hosts `Telnet`.

## Arquitetura em alto nível

- `Frontend`
  React Router organiza as páginas, Zustand mantém estado local e persistido, e a UI roda dentro do WebView do Tauri. O terminal do frontend foi neutralizado para servir `SSH` e `Telnet` com a mesma infraestrutura visual.
- `Backend`
  O backend em Rust expõe comandos Tauri para terminal `SSH`/`Telnet`, SFTP, sync, criptografia, TOTP e persistência.
- `Persistência`
  Hosts, credenciais, chaves SSH, logs e settings ficam em SQLite; o host agora persiste também o `protocol`; estado volátil de sessão fica em memória por janela.
- `Segredos`
  Segredos sensíveis podem ser exportados/sincronizados de forma cifrada com senha mestra usando `Argon2id + AES-256-GCM`.

## Branding e compatibilidade

- O nome visível do produto agora é `MPCM Workspace`
- A classificação usada na documentação é `Multi-Protocol Connection Manager`
- Identificadores internos legados como chaves de storage, diretórios de dados e marcadores de sync/backup continuam preservados para manter compatibilidade com instalações e arquivos já existentes

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
  store/
  themes/
  types/
src-tauri/
  src/
    crypto.rs
    database.rs
    sftp.rs
    ssh.rs
    ssh_config.rs
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
- suporte inicial a `Telnet`
- health check e inventário de fingerprints
- edição em massa de hosts
- sync/backup alinhados com hosts, credenciais, chaves SSH, protocolo e settings portáveis
- página `About` com identidade e posicionamento do produto

## Licença

Uso interno / conforme a política do repositório.
