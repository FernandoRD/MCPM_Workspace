# SSH Vault

SSH Vault é um cliente desktop local-first para operação SSH, SFTP e organização de acesso a infraestrutura.

Stack principal: `Tauri 2` + `Rust` + `React 19` + `TypeScript` + `Zustand` + `Tailwind CSS`.

## O que o app faz hoje

- Cadastro de hosts com `grupos`, `tags`, `notas`, `cores`, `jump host` e presets de compatibilidade SSH
- Credenciais reutilizáveis separadas dos hosts
- Chaves SSH próprias, com geração de fingerprint e vínculo por credencial
- Terminal integrado com `xterm.js`, múltiplas abas e split pane
- SFTP integrado com navegação remota, upload, download, rename, delete e mkdir
- `Quick Connect` na command palette para conexões temporárias sem salvar host
- Opção para abrir sessões na `mesma janela` ou em `janelas dedicadas`
- Dashboard com filtros por grupo/tag, ordenação e edição em massa de `credencial`, `grupo` e `tags`
- Operações com snippets, túneis e workspaces
- `Health check` de hosts e inventário de fingerprints salvas
- Backup/restore com arquivo `.sshvault`
- Sincronização remota com `GitHub Gist`, `S3/MinIO`, `WebDAV/Nextcloud` ou endpoint customizado
- Auto-sync periódico de estado portátil
- MFA/TOTP por host
- Interface traduzida para `pt-BR` e `en-US`

## Arquitetura em alto nível

- `Frontend`
  React Router organiza as páginas, Zustand mantém estado local e persistido, e a UI roda dentro do WebView do Tauri.
- `Backend`
  O backend em Rust expõe comandos Tauri para SSH, SFTP, sync, criptografia, TOTP e persistência.
- `Persistência`
  Hosts, credenciais, chaves SSH, logs e settings ficam em SQLite; estado volátil de sessão fica em memória por janela.
- `Segredos`
  Segredos sensíveis podem ser exportados/sincronizados de forma cifrada com senha mestra usando `Argon2id + AES-256-GCM`.

## Sync e backup

### Sync

- O payload de sync inclui hosts, credenciais, chaves SSH e configurações portáveis
- O `push` publica o snapshot local atual no provider
- O `pull` importa/mescla o conteúdo remoto no estado local
- Auto-sync faz `push` em background sem prompt de senha mestra, então segredos cifrados dependentes da senha não entram nesse fluxo

### Backup

- Exporta para arquivo `.sshvault`
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

O projeto já cobre o núcleo operacional do fluxo SSH/SFTP e agora também inclui:

- Quick Connect
- janelas dedicadas de sessão
- health check e inventário de fingerprints
- edição em massa de hosts
- sync/backup alinhados com hosts, credenciais, chaves SSH e settings portáveis

## Licença

Uso interno / conforme a política do repositório.
