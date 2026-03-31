# SSH Vault

Gerenciador de conexões SSH com sincronização remota e backup de configurações entre múltiplos computadores.

**Stack:** Tauri 2 (Rust) + React + TypeScript + Tailwind CSS

---

## Funcionalidades

- **Gerenciamento de hosts** — cadastro de servidores SSH com grupos, tags, notas e cores
- **Múltiplos métodos de autenticação** — senha, chave privada ou agente SSH
- **Jump Host** — conexão via host intermediário (bastião)
- **Terminal integrado** — emulador xterm.js com múltiplas abas
- **SFTP integrado** — navegador de arquivos remoto com upload, download, criação de diretórios, renomeação e exclusão
- **Temas visuais** — Dark, Light, Dracula, Nord, Catppuccin, Solarized Dark
- **Idiomas** — Português (BR) e English (US)
- **Banco de dados cifrado** — hosts, credenciais e configurações armazenados em SQLite cifrado com SQLCipher; chave de criptografia gerada aleatoriamente e protegida no keychain do SO
- **Sincronização remota** — GitHub Gist, S3/MinIO, WebDAV/Nextcloud ou endpoint customizado REST; sync bidirecional (enviar/importar)
- **Credenciais cifradas** — criptografia AES-256-GCM com chave derivada via Argon2id; senhas nunca viajam em claro
- **Backup e restauração** — exporta/importa um arquivo `.sshvault` com hosts, configurações e credenciais opcionalmente cifradas
- **MFA / TOTP** — autenticação de dois fatores por host (RFC 6238), compatível com Google Authenticator, Authy e Bitwarden; segredo sincronizado e cifrado junto com as demais credenciais

---

## Preparando o ambiente para build

> Siga as instruções da sua plataforma na ordem apresentada. Todos os passos são necessários para que `npm run tauri dev` e `npm run tauri build` funcionem corretamente.

---

### Linux

#### 1. Node.js 18+

A forma recomendada é usar o **nvm** (Node Version Manager), que evita conflitos com versões do sistema:

```bash
# Instalar o nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

# Recarregar o shell e instalar a versão LTS
nvm install --lts
nvm use --lts

# Verificar
node -v   # deve exibir v20.x.x ou superior
npm -v
```

Alternativamente, pelo gerenciador de pacotes da distro:

```bash
# Arch / CachyOS / Manjaro
sudo pacman -S nodejs npm

# Ubuntu / Debian (versão do repositório oficial da NodeSource)
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs

# Fedora
sudo dnf install nodejs npm

# openSUSE
sudo zypper install nodejs npm
```

#### 2. Rust (toolchain stable)

```bash
# Instalar o rustup (gerenciador oficial do Rust)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Escolha a opção 1 (instalação padrão) quando solicitado
# Ao final, ative o Rust no shell atual:

source ~/.cargo/env          # bash / zsh
source ~/.cargo/env.fish     # fish shell

# Verificar
rustc --version   # deve exibir rustc 1.7x.x ou superior
cargo --version
```

> Em sessões futuras do terminal o Rust já estará disponível automaticamente via `~/.profile` / `~/.bashrc`. No fish shell, adicione `source ~/.cargo/env.fish` ao seu `~/.config/fish/config.fish` se não for adicionado automaticamente.

#### 3. Dependências do sistema (WebKit, GTK, AppIndicator)

Estas bibliotecas são exigidas pelo Tauri para renderizar a interface e integrar com o ambiente desktop:

```bash
# Arch / CachyOS / Manjaro
sudo pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator base-devel

# Ubuntu 22.04+ / Debian 12+
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf

# Ubuntu 20.04 / Debian 11 (webkit2gtk ainda na versão 4.0)
sudo apt update
sudo apt install -y \
  build-essential \
  pkg-config \
  libwebkit2gtk-4.0-dev \
  libgtk-3-dev \
  libappindicator3-dev \
  librsvg2-dev

# Fedora
sudo dnf install -y \
  webkit2gtk4.1-devel \
  gtk3-devel \
  libappindicator-gtk3-devel \
  librsvg2-devel

# openSUSE Tumbleweed
sudo zypper install -y \
  webkit2gtk3-devel \
  gtk3-devel \
  libappindicator3-devel
```

#### 4. Tauri CLI

O Tauri CLI já está listado como devDependency em `package.json` — o `npm install` na próxima seção o instala automaticamente. **Não é necessário instalar via `cargo install`.**

> **Importante:** sempre use `npm run tauri dev` e `npm run tauri build` (nunca `cargo tauri` diretamente), pois o script npm embute as variáveis de ambiente necessárias (`NO_STRIP=1`, `APPIMAGE_EXTRACT_AND_RUN=1`) para builds corretos no Linux.

---

### Windows

#### 1. Visual C++ Build Tools

O Rust no Windows exige o compilador MSVC. A forma mais simples é instalar as **Build Tools for Visual Studio**:

1. Acesse [visualstudio.microsoft.com/visual-cpp-build-tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
2. Baixe e execute o instalador
3. Na tela de cargas de trabalho, marque **"Desenvolvimento para desktop com C++"**
4. Clique em **Instalar** (download ~3–6 GB)

> Se você já tiver o **Visual Studio 2019/2022** completo instalado, os Build Tools já estão incluídos — não precisa instalar novamente.

#### 2. Node.js 18+

1. Acesse [nodejs.org](https://nodejs.org/) e baixe o instalador LTS (`.msi`)
2. Execute o instalador e siga os passos (marque "Add to PATH" se solicitado)
3. Verifique no PowerShell:

```powershell
node -v
npm -v
```

#### 3. Rust (toolchain stable)

1. Acesse [rustup.rs](https://rustup.rs/) e baixe o `rustup-init.exe`
2. Execute e escolha a opção **1 (instalação padrão)**
3. O instalador detectará automaticamente o MSVC e configurará a toolchain correta
4. Após concluir, **feche e reabra o PowerShell**, depois verifique:

```powershell
rustc --version
cargo --version
```

#### 4. Perl (exigido pelo OpenSSL)

A crate `rusqlite` com SQLCipher compila o OpenSSL como dependência, e o script de build do OpenSSL requer Perl. A opção mais simples é o **Strawberry Perl**:

1. Acesse [strawberryperl.com](https://strawberryperl.com/) e baixe o instalador (`.msi`)
2. Execute e siga o assistente (instalação padrão)
3. **Feche e reabra o PowerShell** para que o PATH seja atualizado
4. Verifique:

```powershell
perl -v
```

> Sem o Perl, o `cargo build` falhará com um erro semelhante a `Could not find Perl`.

#### 5. WebView2

- **Windows 11**: já vem instalado por padrão — nenhuma ação necessária
- **Windows 10**: baixe o instalador Evergreen em [developer.microsoft.com/microsoft-edge/webview2](https://developer.microsoft.com/microsoft-edge/webview2/) e execute-o

#### 6. Tauri CLI — Windows

O Tauri CLI é instalado automaticamente via `npm install` (devDependency). Nenhuma instalação manual necessária.

---

### macOS

#### 1. Xcode Command Line Tools

Necessário para compilar código Rust e dependências nativas:

```bash
xcode-select --install
```

Uma janela de diálogo abrirá pedindo confirmação — clique em **Instalar**. O processo leva alguns minutos.

Verifique a instalação:

```bash
xcode-select -p   # deve retornar /Library/Developer/CommandLineTools
```

#### 2. Homebrew (recomendado)

O Homebrew simplifica a instalação das demais ferramentas:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Siga as instruções ao final do instalador para adicionar o Homebrew ao PATH (especialmente em Macs com Apple Silicon).

#### 3. Node.js 18+

```bash
brew install node

# Verificar
node -v
npm -v
```

Ou via nvm (recomendado para gerenciar múltiplas versões):

```bash
brew install nvm
nvm install --lts
nvm use --lts
```

#### 4. Rust (toolchain stable)

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Escolha a opção 1 (instalação padrão)

# Ativar no shell atual
source ~/.cargo/env

# Verificar
rustc --version
cargo --version
```

Em Macs com **Apple Silicon (M1/M2/M3)**, adicione o target para ARM se necessário:

```bash
rustup target add aarch64-apple-darwin
```

#### 5. Tauri CLI — macOS

O Tauri CLI é instalado automaticamente via `npm install` (devDependency). Nenhuma instalação manual necessária.

---

## Requisitos resumidos

| Requisito | Linux | Windows | macOS |
| --- | --- | --- | --- |
| Node.js 18+ | nvm ou gerenciador de pacotes | nodejs.org (instalador MSI) | Homebrew ou nvm |
| Rust stable | rustup.rs | rustup-init.exe | rustup.rs |
| Compilador C/C++ | `base-devel` / `build-essential` | Visual C++ Build Tools | Xcode Command Line Tools |
| Perl | não necessário | Strawberry Perl (para OpenSSL) | não necessário |
| WebKit / WebView | `webkit2gtk-4.1-dev` + GTK3 | WebView2 (incluso no Win 11) | Nativo no macOS |
| Tauri CLI | devDependency (via `npm install`) | devDependency (via `npm install`) | devDependency (via `npm install`) |

---

## Instalação e execução

### Linux / macOS — Execução

```bash
# 1. Clonar o repositório
git clone <repo-url>
cd ssh_client_dev

# 2. Instalar dependências Node (inclui o Tauri CLI e o cross-env)
npm install

# 3. Rodar em modo desenvolvimento
npm run tauri dev
```

> Se o comando `cargo` não for encontrado (instalação recém-feita do Rust), execute `source ~/.cargo/env` (bash/zsh) ou `source ~/.cargo/env.fish` (fish) e tente novamente.

### Windows — Execução

```powershell
# 1. Clonar o repositório
git clone <repo-url>
cd ssh_client_dev

# 2. Instalar dependências Node (inclui o Tauri CLI e o cross-env)
npm install

# 3. Rodar em modo desenvolvimento
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
2. Escolha o provedor desejado e preencha os campos conforme as instruções abaixo
3. Clique em **Salvar** e depois **Sincronizar Agora**

Se **"Sincronizar credenciais"** estiver ativo em Configurações → Segurança, será solicitada a senha mestra a cada sync — as credenciais são cifradas antes de sair do dispositivo.

> S3/MinIO, WebDAV/Nextcloud e endpoint customizado estão planejados para a Fase 4.

---

### Configurar GitHub Gist (passo a passo)

O GitHub Gist é o provedor recomendado para uso pessoal: gratuito, sem servidor próprio e com versionamento automático.

#### 1. Criar o Personal Access Token (PAT)

1. Acesse **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
   (ou use o link direto: [github.com/settings/tokens](https://github.com/settings/tokens))
2. Clique em **Generate new token**
3. Preencha:
   - **Token name**: `SSH Vault Sync` (ou qualquer nome descritivo)
   - **Expiration**: escolha conforme sua preferência (recomendado: sem expiração ou 1 ano)
   - **Repository access**: nenhum necessário
4. Em **Account permissions**, expanda **Gists** e selecione **Read and write**
5. Clique em **Generate token**
6. **Copie o token gerado agora** — ele não será exibido novamente

> Se preferir tokens clássicos: acesse **Tokens (classic)**, marque apenas o escopo **`gist`** e gere o token.

#### 2. Configurar no SSH Vault

1. Abra o SSH Vault e clique em **Sincronização** na sidebar
2. Selecione o card **GitHub Gist**
3. No campo **Token**, cole o token copiado no passo anterior
4. No campo **Gist ID**:
   - **Deixe em branco** → um novo Gist privado será criado automaticamente na primeira sincronização
   - **Informe um ID existente** → o app usará aquele Gist (útil para migrar de outro dispositivo ou continuar um Gist já existente)
5. Clique em **Salvar**
6. Clique em **Sincronizar Agora**

#### 3. Sincronizar em um segundo dispositivo

Para usar o mesmo Gist em outro computador, você precisa do **Gist ID** gerado na primeira sincronização:

1. No dispositivo original, após a primeira sincronização bem-sucedida, volte à tela **Sincronização**
2. O campo **Gist ID** estará preenchido com o ID do Gist criado (formato: `abc123def456...`)
3. Copie esse ID
4. No segundo dispositivo, repita o **Passo 2** acima informando esse ID no campo **Gist ID**
5. Clique em **Sincronizar Agora** — os hosts e configurações serão importados

> O Gist criado pelo SSH Vault é **privado** por padrão. Você pode visualizá-lo em [gist.github.com](https://gist.github.com) e verificar o conteúdo sincronizado (que conterá apenas metadados — credenciais ficam cifradas se a opção estiver ativa).

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
│   │   ├── Terminal/         # SshPane — painel xterm.js por aba
│   │   ├── TotpDisplay/      # Código TOTP ao vivo + countdown
│   │   └── ui/               # Button, Input, Modal, Badge...
│   ├── pages/                # Páginas da aplicação
│   │   ├── Dashboard.tsx     # Grid de hosts
│   │   ├── HostEditor.tsx    # Formulário de host
│   │   ├── TerminalPage.tsx  # Terminal xterm.js
│   │   ├── SftpPage.tsx      # Navegador de arquivos SFTP
│   │   ├── Settings.tsx      # Configurações + senha mestra
│   │   ├── Sync.tsx          # Sincronização remota (todos os providers)
│   │   ├── Backup.tsx        # Export / Import de backup
│   │   ├── Credentials.tsx   # Lista de credenciais reutilizáveis
│   │   └── CredentialEditor.tsx # Formulário de credencial
│   ├── lib/
│   │   ├── backup.ts         # Lógica de export/import de backup
│   │   ├── sync.ts           # Montagem e aplicação de pacotes de sync
│   │   ├── i18n.ts           # Configuração react-i18next
│   │   └── utils.ts          # Utilitários gerais
│   ├── store/                # Estado global (Zustand → SQLite via Tauri)
│   │   ├── hosts.ts          # CRUD de hosts + init() + replaceHosts()
│   │   ├── sessions.ts       # Abas de terminal (volátil)
│   │   ├── settings.ts       # Tema, idioma, segurança, sync
│   │   └── credentials.ts    # CRUD de credenciais + init()
│   ├── themes/               # CSS variables por tema
│   └── locales/              # Traduções pt-BR e en-US
│
└── src-tauri/                # Backend Rust (Tauri)
    └── src/
        ├── lib.rs            # Entry point e registro de comandos
        ├── storage.rs        # Diretório de dados da aplicação
        ├── database.rs       # SQLCipher: init, schema, CRUD (hosts/settings/credentials)
        ├── credentials.rs    # Keychain do sistema operacional
        ├── crypto.rs         # Argon2id + AES-256-GCM
        ├── totp.rs           # TOTP/MFA — RFC 6238 (totp-rs)
        ├── ssh.rs            # Sessões SSH reais (russh)
        ├── sftp.rs           # Sessões SFTP (russh-sftp): listar, download, upload, mkdir, rename, delete
        └── sync.rs           # Provedores de sync: Gist, WebDAV, S3, Custom
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

| Fase | Status | Conteúdo |
| --- | --- | --- |
| 1 | ✅ Completo | Estrutura, temas, i18n, CRUD de hosts, terminal demo |
| 1.5 | ✅ Completo | Senha mestra, AES-256-GCM, backup/restore `.sshvault` |
| 1.6 | ✅ Completo | MFA/TOTP por host (RFC 6238), QR code, código ao vivo, cifrado no sync/backup |
| 2 | ✅ Completo | Sessões SSH reais via Rust (`russh`), múltiplas abas |
| 3 | ✅ Completo | Banco SQLCipher cifrado; migração automática do localStorage; chave no keychain do SO |
| 4 | ✅ Completo | Sync remoto funcional: GitHub Gist, S3/MinIO (Sig V4), WebDAV, Custom REST; bidirecional |
| 5 | ✅ Completo | SFTP integrado: navegador de arquivos, upload/download com barra de progresso, mkdir, rename, delete recursivo; suporte a Jump Host; known hosts TOFU; botões Terminal↔SFTP |
| 6 | 📋 Planejado | Compatibilidade SSH: presets legado/muito-legado, KEX, ciphers, MACs e host-key por host |
| 7 | ✅ Completo | Gerenciador de chaves SSH: gerar Ed25519/ECDSA/RSA 2048-4096, fingerprint, deploy via ssh-copy-id, tipo de chave detectado na listagem |

---

## Versão da aplicação

A versão é definida em dois arquivos que devem ser mantidos sincronizados:

| Arquivo | Campo |
| --- | --- |
| `src-tauri/tauri.conf.json` | `"version": "0.1.0"` |
| `src-tauri/Cargo.toml` | `version = "0.1.0"` |

Altere os dois ao mesmo tempo ao fazer um release. A versão do `tauri.conf.json` é a que aparece no instalador e na tela "Sobre" da aplicação.

---

## Build para produção

> **Importante:** o Tauri não suporta cross-compile — cada plataforma precisa ser buildada em uma máquina com o mesmo sistema operacional (ou via CI).

### Build no Linux

```bash
npm run tauri build
```

Pacotes gerados em `src-tauri/target/release/bundle/`:

| Formato | Caminho |
| --- | --- |
| `.deb` | `deb/SSH Vault_0.1.0_amd64.deb` |
| `.rpm` | `rpm/SSH Vault-0.1.0-1.x86_64.rpm` |
| `.AppImage` | `appimage/SSH Vault_0.1.0_amd64.AppImage` |

> **Nota (Arch / CachyOS e outros Linux):** as bibliotecas do sistema usam o formato de relocação `.relr.dyn`, incompatível com o `strip` antigo empacotado no linuxdeploy. O script npm já inclui `NO_STRIP=1` e `APPIMAGE_EXTRACT_AND_RUN=1` para contornar isso — nenhuma ação adicional é necessária.

### Build no Windows

```powershell
npm run tauri build
```

Pacotes gerados em `src-tauri\target\release\bundle\`:

| Formato | Caminho |
| --- | --- |
| `.exe` (NSIS) | `nsis\SSH Vault_0.1.0_x64-setup.exe` |
| `.msi` | `msi\SSH Vault_0.1.0_x64_en-US.msi` |

### Build no macOS

```bash
npm run tauri build
```

Pacotes gerados em `src-tauri/target/release/bundle/`:

| Formato | Caminho |
| --- | --- |
| `.dmg` | `dmg/SSH Vault_0.1.0_x64.dmg` |
| `.app` | `macos/SSH Vault.app` |

---

## Instalando os pacotes gerados

### Linux — `.deb` (Ubuntu, Debian, Linux Mint)

```bash
sudo dpkg -i "SSH Vault_0.1.0_amd64.deb"
```

> Se houver dependências faltando após o `dpkg`, corrija com `sudo apt-get install -f`.

### Linux — `.rpm` (Fedora, RHEL, openSUSE)

```bash
# Fedora / RHEL
sudo rpm -i "SSH Vault-0.1.0-1.x86_64.rpm"

# Ou com DNF (resolve dependências automaticamente)
sudo dnf install "SSH Vault-0.1.0-1.x86_64.rpm"
```

### Linux — `.AppImage` (qualquer distro)

```bash
# Tornar executável e rodar diretamente — não requer instalação
chmod +x "SSH Vault_0.1.0_amd64.AppImage"
./"SSH Vault_0.1.0_amd64.AppImage"
```

> O AppImage é portátil: funciona em qualquer distro Linux x86_64 sem instalar nada.

### Windows — `.exe` (instalador NSIS)

1. Dê dois cliques em `SSH Vault_0.1.0_x64-setup.exe`
2. Se o Windows Defender SmartScreen avisar, clique em **"Mais informações" → "Executar assim mesmo"**
3. Siga o assistente de instalação — o app aparecerá no Menu Iniciar

### Windows — `.msi`

1. Dê dois cliques em `SSH Vault_0.1.0_x64_en-US.msi`
2. Siga o assistente do Windows Installer
3. Para instalar silenciosamente via linha de comando:

```powershell
msiexec /i "SSH Vault_0.1.0_x64_en-US.msi" /quiet
```

---

## CI/CD com GitHub Actions

O repositório inclui um workflow em [`.github/workflows/build.yml`](.github/workflows/build.yml) que builda automaticamente para **Linux, Windows e macOS** em paralelo.

**Disparar o build:**

```bash
git tag v0.1.0
git push origin v0.1.0
```

Os instaladores ficam disponíveis na aba **Actions → seu workflow → Artifacts** do repositório no GitHub.

Você também pode disparar manualmente pela interface do GitHub em **Actions → Build → Run workflow**.
