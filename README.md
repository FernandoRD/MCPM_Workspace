# SSH Vault

Gerenciador de conexões SSH com sincronização remota e backup de configurações entre múltiplos computadores.

**Stack:** Tauri 2 (Rust) + React + TypeScript + Tailwind CSS

---

## Funcionalidades

- **Gerenciamento de hosts** — cadastro de servidores SSH com grupos, tags, notas e cores
- **Múltiplos métodos de autenticação** — senha, chave privada ou agente SSH
- **Jump Host** — conexão via host intermediário (bastião)
- **Terminal integrado** — emulador xterm.js com múltiplas abas
- **Temas visuais** — Dark, Light, Dracula, Nord, Catppuccin, Solarized Dark
- **Idiomas** — Português (BR) e English (US)
- **Sincronização remota** — GitHub Gist, S3/MinIO, WebDAV/Nextcloud ou endpoint customizado
- **Credenciais cifradas** — criptografia AES-256-GCM com chave derivada via Argon2id; senhas nunca viajam em claro
- **Backup e restauração** — exporta/importa um arquivo `.sshvault` com hosts, configurações e credenciais opcionalmente cifradas
- **MFA / TOTP** — autenticação de dois fatores por host (RFC 6238), compatível com Google Authenticator, Authy e Bitwarden; segredo sincronizado e cifrado junto com as demais credenciais

---

## Requisitos

### Sistema

- Linux, macOS ou Windows
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) (stable)

### Linux — dependências do sistema

```bash
# Arch / CachyOS / Manjaro
sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator base-devel

# Ubuntu / Debian
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
```

---

## Instalação e execução

```bash
# 1. Clonar o repositório
git clone <repo-url>
cd ssh_client_dev

# 2. Instalar dependências Node
npm install

# 3. Configurar Rust (se necessário)
source ~/.cargo/env   # ou reinicie o terminal após instalar via rustup

# 4. Rodar em modo desenvolvimento
npm run tauri dev
```

> Na **primeira execução**, o Rust compilará todas as dependências (~2–5 min). As execuções seguintes são muito mais rápidas.

---

## Como usar

### Adicionar um host

1. Clique em **"+ Nova Conexão"** no cabeçalho do Dashboard, ou no ícone `+` na sidebar
2. Preencha os campos na seção **Conexão**: nome, host/IP, porta e usuário
3. Na seção **Autenticação**, escolha o método:
   - **Senha** — informe a senha do servidor
   - **Chave Privada** — informe o caminho para o arquivo `.pem` / `id_rsa`
   - **Agente SSH** — usa o agente SSH já configurado no sistema
4. Na seção **Avançado** (opcional): grupo, tags, cor, jump host, notas
5. Clique em **Salvar**

### Conectar a um host

- No **Dashboard**: clique no botão **Conectar** no card do host
- Na **Sidebar**: passe o mouse sobre o host e clique no ícone de terminal

O terminal abre em uma nova aba. Você pode ter várias sessões abertas simultaneamente.

### Organizar com grupos

No formulário de host, preencha o campo **Grupo** (ex: `Produção`, `Dev`, `Clientes`).
Os hosts serão agrupados tanto na sidebar quanto no Dashboard.

### Configurar temas e idioma

1. Clique em **Configurações** na sidebar (ícone de engrenagem)
2. Em **Aparência**, clique no tema desejado para aplicar instantaneamente
3. Em **Idioma**, selecione `Português (BR)` ou `English (US)`
4. Clique em **Salvar**

### Configurar MFA (TOTP) em um host

O SSH Vault suporta autenticação de dois fatores por host usando TOTP (Time-based One-Time Password, RFC 6238).

1. Abra o formulário de um host (novo ou existente)
2. Expanda a seção **"Autenticação de Dois Fatores (MFA)"**
3. Ative o toggle **"Habilitar MFA para este host"**
4. Você tem duas opções para o segredo TOTP:
   - **Gerar automaticamente** — clique em **"Gerar novo segredo"**; um QR code aparecerá para escanear com seu app autenticador
   - **Inserir manualmente** — cole um segredo Base32 existente no campo
5. Escaneie o QR code com Google Authenticator, Authy, Bitwarden, etc.
6. O código atual (com contagem regressiva de 30 s) é exibido em tempo real como prévia
7. Clique em **Salvar**

> O segredo TOTP é armazenado cifrado e incluído nos backups/sync junto com as demais credenciais — protegido pela senha mestra.

### Configurar senha mestra (para backup e sync de credenciais)

A senha mestra é usada para cifrar suas credenciais antes de exportá-las.
**Ela nunca é enviada a nenhum servidor** — toda a criptografia ocorre localmente.

1. Acesse **Configurações → Segurança**
2. Clique em **Definir senha mestra**
3. Informe e confirme a senha (mínimo 8 caracteres)
4. Opcionalmente, ative **"Sincronizar credenciais"** para incluí-las no sync remoto

> Guarde a senha mestra em local seguro. Sem ela, as credenciais cifradas **não podem ser recuperadas**.

### Exportar backup

1. Clique em **Backup** na sidebar
2. Marque **"Incluir credenciais cifradas"** se desejar exportar senhas e chaves
   - Requer senha mestra configurada
   - As credenciais serão cifradas com **AES-256-GCM** antes de gravar no arquivo
3. Clique em **Exportar Backup**
4. Escolha onde salvar o arquivo `.sshvault`

O arquivo gerado contém:

| Campo                  | Tipo                  | Descrição                                              |
| ---------------------- | --------------------- | ------------------------------------------------------ |
| `hosts`                | Plaintext             | Metadados (host, porta, usuário, tags, mfaEnabled...)  |
| `settings`             | Plaintext             | Tema, idioma, configurações do terminal                |
| `encryptedCredentials` | AES-256-GCM cifrado   | Senhas, chaves e segredos TOTP — só presente se pedido |

### Importar backup

1. Clique em **Backup** na sidebar
2. Clique em **Selecionar arquivo...**
3. Escolha o arquivo `.sshvault`
4. Se o backup contiver credenciais cifradas, informe a senha mestra usada na exportação
5. Escolha o modo de importação:
   - **Adicionar aos existentes** — mantém hosts atuais e adiciona os do backup (duplicatas ignoradas por ID)
   - **Substituir tudo** — remove todos os hosts atuais e substitui pelos do backup (pede confirmação)
6. Marque/desmarque **"Restaurar configurações"** conforme necessidade
7. Clique em **Importar**

### Configurar sincronização remota

1. Clique em **Sincronização** na sidebar (ícone de nuvem)
2. Escolha o provedor:
   - **GitHub Gist** *(recomendado para uso pessoal)*: crie um [Personal Access Token](https://github.com/settings/tokens) com escopo `gist` e cole no campo Token
   - **S3 / MinIO**: informe endpoint, bucket, região e credenciais
   - **WebDAV / Nextcloud**: informe URL, usuário e senha
3. Clique em **Salvar** e depois **Sincronizar Agora**

Se **"Sincronizar credenciais"** estiver ativo em Configurações → Segurança, será solicitada a senha mestra a cada sync — as credenciais são cifradas antes de sair do dispositivo.

---

## Segurança das credenciais

```text
Senha mestra
    │
    ▼ Argon2id (64 MB RAM, 3 iterações)
Chave AES-256
    │
    ▼ AES-256-GCM + salt e nonce aleatórios
Ciphertext { salt, nonce, ciphertext } ──► arquivo .sshvault / provedor de sync
```

- A senha mestra **nunca sai do dispositivo**
- Salt e nonce são gerados aleatoriamente a cada cifragem
- A tag GCM autentica os dados — qualquer adulteração é detectada
- Sem a senha mestra correta, os dados são computacionalmente irrecuperáveis

---

## Estrutura do projeto

```text
ssh_client_dev/
├── src/                      # Frontend React + TypeScript
│   ├── components/           # Componentes reutilizáveis
│   │   ├── Layout/           # AppLayout principal
│   │   ├── Sidebar/          # Navegação e lista de hosts
│   │   ├── TabBar/           # Abas de sessões abertas
│   │   └── ui/               # Button, Input, Modal, Badge...
│   ├── pages/                # Páginas da aplicação
│   │   ├── Dashboard.tsx     # Grid de hosts
│   │   ├── HostEditor.tsx    # Formulário de host
│   │   ├── TerminalPage.tsx  # Terminal xterm.js
│   │   ├── Settings.tsx      # Configurações + senha mestra
│   │   ├── Sync.tsx          # Sincronização remota
│   │   └── Backup.tsx        # Export / Import de backup
│   ├── lib/
│   │   ├── backup.ts         # Lógica de export/import de backup
│   │   ├── i18n.ts           # Configuração react-i18next
│   │   └── utils.ts          # Utilitários gerais
│   ├── store/                # Estado global (Zustand)
│   │   ├── hosts.ts          # CRUD de hosts
│   │   ├── sessions.ts       # Abas de terminal
│   │   └── settings.ts       # Tema, idioma, segurança, sync
│   ├── themes/               # CSS variables por tema
│   └── locales/              # Traduções pt-BR e en-US
│
└── src-tauri/                # Backend Rust (Tauri)
    └── src/
        ├── lib.rs            # Entry point e registro de comandos
        ├── storage.rs        # Diretório de dados da aplicação
        ├── credentials.rs    # Keychain do sistema operacional
        ├── crypto.rs         # Argon2id + AES-256-GCM
        └── totp.rs           # TOTP/MFA — RFC 6238 (totp-rs)
```

---

## Formato do arquivo de backup (`.sshvault`)

```json
{
  "app": "ssh-vault",
  "version": 1,
  "exportedAt": "2026-03-24T12:00:00.000Z",
  "hosts": [
    {
      "id": "uuid",
      "label": "Servidor de Produção",
      "host": "192.168.1.10",
      "port": 22,
      "username": "ubuntu",
      "authMethod": "privateKey",
      "group": "Produção",
      "tags": ["web", "linux"],
      "mfaEnabled": true
    }
  ],
  "settings": {
    "themeId": "dark",
    "locale": "pt-BR",
    "terminal": { "fontSize": 14, "cursorStyle": "block" }
  },
  "encryptedCredentials": {
    "version": 1,
    "salt": "<base64>",
    "nonce": "<base64>",
    "ciphertext": "<base64 de { hostId: { password, passphrase, privateKeyPath, totpSecret } }>"
  }
}
```

---

## Temas disponíveis

| Nome           | Estilo               |
| -------------- | -------------------- |
| Dark           | Escuro estilo GitHub |
| Light          | Claro estilo GitHub  |
| Dracula        | Roxo clássico        |
| Nord           | Azul ártico          |
| Catppuccin     | Roxo suave (Mocha)   |
| Solarized Dark | Verde/azul clássico  |

---

## Fases de desenvolvimento

| Fase | Status       | Conteúdo                                                                        |
| ---- | ------------ | ------------------------------------------------------------------------------- |
| 1    | ✅ Completo  | Estrutura, temas, i18n, CRUD de hosts, terminal demo                            |
| 1.5  | ✅ Completo  | Senha mestra, AES-256-GCM, backup/restore `.sshvault`                           |
| 1.6  | ✅ Completo  | MFA/TOTP por host (RFC 6238), QR code, código ao vivo, cifrado no sync/backup   |
| 2    | 🔜 Próxima   | Sessões SSH reais via Rust (`russh`), múltiplas abas                            |
| 3    | 📋 Planejado | Criptografia local do banco (SQLCipher)                                         |
| 4    | 📋 Planejado | Sync remoto funcional (Gist, S3, WebDAV) com credenciais cifradas               |
| 5    | 📋 Planejado | SFTP integrado, split de terminal                                               |

---

## Build para produção

```bash
npm run tauri build
```

O instalador será gerado em `src-tauri/target/release/bundle/`.
