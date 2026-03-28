# SSH Vault — Referência Técnica

> Documento de referência para desenvolvedores. Cobre arquitetura, tipos, comandos Tauri, stores, componentes, roteamento e configuração.

---

## Sumário

1. [Visão geral da arquitetura](#1-visão-geral-da-arquitetura)
2. [Estrutura de diretórios](#2-estrutura-de-diretórios)
3. [Tipos TypeScript](#3-tipos-typescript)
4. [Stores Zustand](#4-stores-zustand)
5. [Comandos Tauri (Rust)](#5-comandos-tauri-rust)
6. [Páginas React](#6-páginas-react)
7. [Componentes reutilizáveis](#7-componentes-reutilizáveis)
8. [Roteamento](#8-roteamento)
9. [Internacionalização (i18n)](#9-internacionalização-i18n)
10. [Módulo de backup](#10-módulo-de-backup)
11. [Temas](#11-temas)
12. [Configuração do Tauri](#12-configuração-do-tauri)
13. [Dependências Rust](#13-dependências-rust)
14. [Segurança — fluxo de dados sensíveis](#14-segurança--fluxo-de-dados-sensíveis)
15. [Build e empacotamento](#15-build-e-empacotamento)

---

## 1. Visão geral da arquitetura

```
┌─────────────────────────────────────────────┐
│                  Frontend                   │
│   React 19 + TypeScript + Tailwind CSS      │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  Zustand │  │  React   │  │ i18next  │   │
│  │  Stores  │  │  Router  │  │ pt-BR/en │   │
│  └──────────┘  └──────────┘  └──────────┘   │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │            xterm.js                  │   │
│  │        (terminal emulator)           │   │
│  └──────────────────────────────────────┘   │
└────────────────────┬────────────────────────┘
                     │ @tauri-apps/api (invoke)
┌────────────────────▼────────────────────────┐
│               Backend Rust                  │
│                                             │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │  crypto  │  │   totp   │  │credentials│  │
│  │ AES-GCM  │  │  RFC6238 │  │ keychain  │  │
│  │ Argon2id │  │  totp-rs │  │  keyring  │  │
│  └──────────┘  └──────────┘  └───────────┘  │
│                                             │
│  ┌──────────────────────────────────────┐   │
│  │              storage                 │   │
│  │   dirs::data_local_dir / ssh-vault   │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

**Camada de comunicação:** `invoke()` do `@tauri-apps/api/core` — IPC síncrono entre frontend e Rust.

**Persistência de estado:** Zustand com middleware `persist` → `localStorage` (fases 1–1.6). Credenciais sensíveis nunca vão para o localStorage — ficam no keychain do SO ou cifradas em arquivo.

---

## 2. Estrutura de diretórios

```
ssh_client_dev/
├── .github/
│   └── workflows/
│       └── build.yml               # CI: Linux + Windows + macOS
├── src/                            # Frontend React + TypeScript
│   ├── components/
│   │   ├── Layout/
│   │   │   └── AppLayout.tsx       # Shell: Sidebar + TabBar + <Outlet>
│   │   ├── Sidebar/
│   │   │   └── Sidebar.tsx         # Navegação + lista de hosts
│   │   ├── TabBar/
│   │   │   └── TabBar.tsx          # Abas de sessões abertas
│   │   ├── TotpDisplay/
│   │   │   └── TotpDisplay.tsx     # Código TOTP ao vivo + countdown
│   │   └── ui/
│   │       ├── Badge.tsx
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       ├── Select.tsx
│   │       └── Textarea.tsx
│   ├── lib/
│   │   ├── backup.ts               # Export/import de .sshvault
│   │   ├── i18n.ts                 # Configuração react-i18next
│   │   └── utils.ts                # cn(), formatDate(), getHostColor()
│   ├── locales/
│   │   ├── en-US/translation.json
│   │   └── pt-BR/translation.json
│   ├── pages/
│   │   ├── Backup.tsx
│   │   ├── Dashboard.tsx
│   │   ├── HostEditor.tsx
│   │   ├── Settings.tsx
│   │   ├── Sync.tsx
│   │   └── TerminalPage.tsx
│   ├── store/
│   │   ├── hosts.ts                # CRUD de hosts
│   │   ├── sessions.ts             # Abas de terminal
│   │   └── settings.ts             # Tema, idioma, segurança, sync
│   ├── themes/
│   │   ├── index.ts                # THEMES, ThemeId, applyTheme()
│   │   └── themes.css              # CSS variables por tema
│   ├── types/
│   │   └── index.ts                # Todos os tipos compartilhados
│   ├── App.tsx                     # Rotas
│   └── index.css                   # Tailwind + estilos globais
└── src-tauri/                      # Backend Rust (Tauri)
    ├── src/
    │   ├── lib.rs                  # Entry point + registro de comandos
    │   ├── storage.rs              # get_app_data_dir
    │   ├── credentials.rs          # Keychain do SO (keyring)
    │   ├── crypto.rs               # Argon2id + AES-256-GCM
    │   └── totp.rs                 # RFC 6238 (totp-rs)
    ├── Cargo.toml
    └── tauri.conf.json
```

---

## 3. Tipos TypeScript

**Arquivo:** `src/types/index.ts`

### `AuthMethod`

```typescript
type AuthMethod = "password" | "privateKey" | "agent";
```

---

### `SshHost`

Campo central da aplicação. Armazenado em `localStorage` via Zustand.

```typescript
interface SshHost {
  id: string;                    // UUID v4
  label: string;                 // Nome exibido
  host: string;                  // IP ou hostname
  port: number;                  // 1–65535
  username: string;
  authMethod: AuthMethod;

  // Credenciais — nunca persistidas em claro no localStorage
  passwordRef?: string;          // Referência à senha no keychain
  privateKeyPath?: string;       // Caminho para o arquivo .pem / id_rsa
  passphrase?: string;           // Frase-senha da chave privada

  // MFA / TOTP
  mfaEnabled?: boolean;
  totpSecret?: string;           // Segredo Base32 — cifrado no sync/backup

  // Organização
  group?: string;
  tags: string[];
  notes?: string;
  color?: string;                // Hex color (#rrggbb)

  // Conexão avançada
  jumpHostId?: string;           // ID de outro SshHost usado como bastião
  keepAliveInterval?: number;    // Segundos; 0 = desativado
  connectionTimeout?: number;    // Segundos

  // Metadados
  lastConnectedAt?: string;      // ISO 8601
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
}
```

---

### `SessionTab`

```typescript
interface SessionTab {
  id: string;                    // UUID v4
  hostId: string;
  hostLabel: string;
  hostAddress: string;           // "username@host"
  status: "connecting" | "connected" | "disconnected" | "error";
  createdAt: string;             // ISO 8601
}
```

---

### `AppSettings`

```typescript
interface AppSettings {
  themeId: string;               // Ver ThemeId
  locale: string;                // "pt-BR" | "en-US"
  terminal: {
    fontSize: number;
    fontFamily: string;
    cursorStyle: "block" | "underline" | "bar";
    cursorBlink: boolean;
    scrollback: number;
  };
  security: {
    masterPasswordSet: boolean;
    verificationPayload?: string; // Ciphertext para validar senha na próxima sessão
    syncCredentials: boolean;
  };
  sync: {
    provider: SyncProvider;
    autoSync: boolean;
    lastSyncAt?: string;
    gist?: GistSyncConfig;
    s3?: S3SyncConfig;
    webdav?: WebDavSyncConfig;
  };
}
```

---

### Tipos de sincronização

```typescript
type SyncProvider = "githubGist" | "s3" | "webdav" | "custom" | null;
type SyncStatus  = "idle" | "syncing" | "synced" | "error" | "notConfigured";

interface GistSyncConfig {
  token: string;   // Personal Access Token com escopo "gist"
  gistId?: string; // Vazio = cria automaticamente
}

interface S3SyncConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

interface WebDavSyncConfig {
  url: string;
  username: string;
  password: string;
  path: string;
}
```

---

### Tipos de criptografia e backup

```typescript
interface EncryptedCredentials {
  version: number;    // Sempre 1
  salt: string;       // Base64, 16 bytes aleatórios
  nonce: string;      // Base64, 12 bytes aleatórios
  ciphertext: string; // Base64, AES-256-GCM
}

interface SyncPackage {
  version: 1;
  exportedAt: string;
  hosts: SshHost[];
  encryptedCredentials?: EncryptedCredentials;
}
```

---

## 4. Stores Zustand

Todos os stores usam `persist` do `zustand/middleware` com `localStorage`.

### `useHostsStore`

**Arquivo:** `src/store/hosts.ts` | **Chave localStorage:** `ssh-vault-hosts`

```typescript
interface HostsStore {
  hosts: SshHost[];
  addHost    (data: Omit<SshHost, "id" | "createdAt" | "updatedAt">): void;
  updateHost (id: string, data: Partial<SshHost>): void;
  deleteHost (id: string): void;
  duplicateHost (id: string): void;
  setLastConnected (id: string): void;
  getHost    (id: string): SshHost | undefined;
  getGroups  (): string[];
}
```

`addHost` gera `id` (UUID v4) e timestamps automaticamente.
`duplicateHost` cria cópia com novo `id` e sufixo `" (cópia)"` no label.

---

### `useSessionsStore`

**Arquivo:** `src/store/sessions.ts` | **Persistência:** nenhuma (volátil)

```typescript
interface SessionsStore {
  tabs: SessionTab[];
  activeTabId: string | null;
  openSession   (hostId: string, hostLabel: string, hostAddress: string): string; // retorna tabId
  closeSession  (tabId: string): void;
  setActiveTab  (tabId: string): void;
  updateTabStatus (tabId: string, status: SessionTab["status"]): void;
}
```

---

### `useSettingsStore`

**Arquivo:** `src/store/settings.ts` | **Chave localStorage:** `ssh-vault-settings`

```typescript
interface SettingsStore {
  settings: AppSettings;
  setTheme       (themeId: ThemeId): void;
  setLocale      (locale: string): void;
  updateTerminal (terminal: Partial<AppSettings["terminal"]>): void;
  updateSecurity (security: Partial<AppSettings["security"]>): void;
  updateSync     (sync: Partial<AppSettings["sync"]>): void;
  resetSettings  (): void;
}
```

**Valores padrão:**

```typescript
const DEFAULT_SETTINGS: AppSettings = {
  themeId: "dark",
  locale: "pt-BR",
  terminal: {
    fontSize: 14,
    fontFamily: "JetBrains Mono",
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 5000,
  },
  security: {
    masterPasswordSet: false,
    syncCredentials: false,
  },
  sync: {
    provider: null,
    autoSync: false,
  },
};
```

**Hook `onRehydrateStorage`:** ao restaurar do `localStorage`, aplica o tema (`applyTheme`) e o idioma (`i18n.changeLanguage`) automaticamente.

---

## 5. Comandos Tauri (Rust)

Todos são invocados via `invoke()` do `@tauri-apps/api/core`.

### `crypto.rs` — Criptografia

#### `encrypt_credentials`

```
invoke("encrypt_credentials", {
  credentialsJson: string,   // JSON serializado do CredentialsMap
  masterPassword: string,
}) → Promise<string>         // JSON serializado do EncryptedCredentials
```

Fluxo interno:
1. Gera salt aleatório (16 bytes) e nonce (12 bytes)
2. Deriva chave AES-256 via Argon2id (`m=65536`, `t=3`, `p=1`)
3. Cifra com AES-256-GCM (autenticado)
4. Serializa `{ version, salt, nonce, ciphertext }` em Base64
5. Zeroiza chave e senha da memória

---

#### `decrypt_credentials`

```
invoke("decrypt_credentials", {
  encryptedPayloadJson: string,  // JSON de EncryptedCredentials
  masterPassword: string,
}) → Promise<string>             // JSON do CredentialsMap decifrado
                                 // Lança erro genérico se senha errada
```

O erro é propositalmente genérico ("decryption failed") para evitar timing attacks.

---

#### `verify_master_password`

```
invoke("verify_master_password", {
  encryptedPayloadJson: string,  // verificationPayload das settings
  masterPassword: string,
}) → Promise<boolean>
```

Usado para validar a senha antes de operações de sync/backup sem expor o conteúdo.

---

### `totp.rs` — MFA / TOTP

#### `generate_totp_code`

```
invoke("generate_totp_code", {
  secretBase32: string,   // Segredo em Base32 (case-insensitive)
}) → Promise<{
  code: string,           // 6 dígitos (ex: "123456")
  remaining_seconds: number, // 1–30
  valid_from: number,     // Unix timestamp do início da janela
}>
```

Algoritmo: SHA-1, step=30s, digits=6 (RFC 6238 padrão).

---

#### `verify_totp_code`

```
invoke("verify_totp_code", {
  secretBase32: string,
  code: string,           // 6 dígitos
}) → Promise<boolean>
```

Aceita janela atual ± 1 para tolerância de clock skew (±30s).

---

#### `generate_totp_secret`

```
invoke("generate_totp_secret", {
  issuer: string,         // Ex: "SSH Vault"
  accountName: string,    // Ex: "user@servidor.com"
}) → Promise<{
  secret: string,         // Base32, 160 bits (20 bytes)
  otpauth_url: string,    // "otpauth://totp/..."
}>
```

A `otpauth_url` é usada para gerar QR code compatível com Google Authenticator, Authy, Bitwarden, etc.

---

### `credentials.rs` — Keychain do SO

```
invoke("save_credential",   { key: string, value: string }) → Promise<void>
invoke("get_credential",    { key: string })                → Promise<string>
invoke("delete_credential", { key: string })                → Promise<void>
```

Usa a crate `keyring` (serviço: `"ssh-vault"`):
- **Linux:** libsecret / GNOME Keyring / KWallet
- **macOS:** Keychain
- **Windows:** Credential Manager

---

### `storage.rs` — Diretório de dados

```
invoke("get_app_data_dir") → Promise<string>
```

Retorna o diretório de dados da aplicação (criado se não existir):

| SO | Caminho |
| --- | --- |
| Linux | `~/.local/share/ssh-vault/` |
| macOS | `~/Library/Application Support/ssh-vault/` |
| Windows | `%APPDATA%\ssh-vault\` |

---

## 6. Páginas React

### `Dashboard`

**Rota:** `/`
**Arquivo:** `src/pages/Dashboard.tsx`

| Responsabilidade | Detalhe |
| --- | --- |
| Listar hosts | Grid responsivo, agrupado por `group` |
| Busca | Filtra por `label`, `host`, `tags` |
| Ações por host | Conectar, editar, duplicar, excluir (menu contextual) |
| Badge MFA | Exibido quando `host.mfaEnabled === true` |
| Estado vazio | Placeholder com botão para criar primeiro host |

**Componentes internos:** `HostCard`, `ContextItem`, `EmptyState`

---

### `HostEditor`

**Rotas:** `/hosts/new`, `/hosts/:id`
**Arquivo:** `src/pages/HostEditor.tsx`

Seções colapsáveis:

| Seção | Campos |
| --- | --- |
| **Conexão** | label, host, port, username |
| **Autenticação** | authMethod + campos condicionais (password / privateKeyPath + passphrase) |
| **Avançado** | group, color, tags, jumpHostId, keepAliveInterval, connectionTimeout, notes |
| **MFA** | mfaEnabled toggle, totpSecret, botão gerar, QR code, preview ao vivo |

**Geração de segredo TOTP:**
Chama `generate_totp_secret`, seta `form.totpSecret` e exibe QR code via `react-qr-code`.
O preview ao vivo usa `<TotpDisplay secretBase32={form.totpSecret} />`.

---

### `Settings`

**Rota:** `/settings`
**Arquivo:** `src/pages/Settings.tsx`

| Seção | Configurações |
| --- | --- |
| Aparência | Seletor visual de tema (6 opções) |
| Idioma | pt-BR / en-US |
| Terminal | fontSize, fontFamily, cursorStyle, cursorBlink, scrollback |
| Segurança | Definir / alterar / remover senha mestra; toggle syncCredentials |

**Fluxo de senha mestra:**
1. Primeira definição: hash via `encrypt_credentials` de payload de verificação → salvo em `settings.security.verificationPayload`
2. Alteração: valida senha atual com `verify_master_password` antes de aceitar a nova
3. Remoção: limpa `verificationPayload` e seta `masterPasswordSet = false`

---

### `Sync`

**Rota:** `/sync`
**Arquivo:** `src/pages/Sync.tsx`

Provedores suportados (configuração na UI):

| Provedor | Campos |
| --- | --- |
| GitHub Gist | token (PAT), gistId (opcional — cria automaticamente) |
| S3 / MinIO | endpoint, bucket, region, accessKey, secretKey |
| WebDAV / Nextcloud | url, username, password, path |
| Custom | (placeholder — fase 4) |

Se `syncCredentials = true`, exibe modal de senha mestra antes de sincronizar.

---

### `Backup`

**Rota:** `/backup`
**Arquivo:** `src/pages/Backup.tsx`

**Exportação:**
- Abre diálogo nativo de salvar (`.sshvault` / `.json`)
- Opção "Incluir credenciais cifradas" → requer senha mestra
- Hosts no JSON sempre sem campos sensíveis em claro

**Importação:**
- Abre diálogo nativo de abrir
- Prévia: quantidade de hosts, data de exportação, presença de credenciais
- Modos: **Adicionar aos existentes** (ignora duplicatas por ID) ou **Substituir tudo**
- Toggle para restaurar ou ignorar as settings do backup

---

### `TerminalPage`

**Rota:** `/terminal/:tabId`
**Arquivo:** `src/pages/TerminalPage.tsx`

Renderiza xterm.js com as configurações do store (`terminal.*`). Fase 1: demo com conexão simulada. Fase 2: SSH real via `russh`.

**Addons xterm.js:**
- `FitAddon` — redimensionamento responsivo
- `WebLinksAddon` — links clicáveis no terminal

---

## 7. Componentes reutilizáveis

### `TotpDisplay`

**Arquivo:** `src/components/TotpDisplay/TotpDisplay.tsx`

```typescript
interface TotpDisplayProps {
  secretBase32: string;
}
```

- Chama `generate_totp_code` a cada segundo
- Anel SVG de contagem regressiva (30s → 0)
- Código formatado como `"123 456"`
- Muda para cor de perigo (`--danger`) nos últimos 5 segundos
- Botão copiar com feedback visual (ícone muda para ✓ por 2s)

---

### UI primitivos

**Arquivo:** `src/components/ui/`

#### `Button`

```typescript
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger"; // padrão: "primary"
  size?:    "sm" | "md" | "lg";                           // padrão: "md"
}
```

#### `Input`

```typescript
interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;  // Exibe texto de erro em vermelho abaixo do campo
  hint?:  string;  // Texto de ajuda em cinza abaixo do campo
}
```

#### `Select`

```typescript
interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
}
```

#### `Textarea`

```typescript
interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?:  string;
}
```

#### `Modal`

```typescript
interface ModalProps {
  open:      boolean;
  onClose:   () => void;
  title?:    string;
  children:  ReactNode;
  size?:     "sm" | "md" | "lg" | "xl"; // padrão: "md"
  className?: string;
}
```

#### `Badge`

```typescript
interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "accent";
}
```

---

### Layout e navegação

#### `AppLayout`

**Arquivo:** `src/components/Layout/AppLayout.tsx`

Shell principal: `<Sidebar>` + `<TabBar>` (quando há sessões abertas) + `<Outlet>` (conteúdo da rota ativa).

#### `Sidebar`

**Arquivo:** `src/components/Sidebar/Sidebar.tsx`

- Links de navegação: Dashboard, Sync, Backup, Settings
- Lista de hosts com busca, agrupamento e colapso por grupo
- Botões de ação nos hosts (conectar, editar) ao passar o mouse
- Indicador de status de conexão ativa (ponto verde)

#### `TabBar`

**Arquivo:** `src/components/TabBar/TabBar.tsx`

- Exibido apenas quando `sessions.tabs.length > 0`
- Ícone de status por tab: ⏳ connecting, ● connected, ○ disconnected, ✕ error
- Botão fechar tab (X)

---

## 8. Roteamento

**Arquivo:** `src/App.tsx`

```
/                   → Dashboard
/hosts/new          → HostEditor (modo criação)
/hosts/:id          → HostEditor (modo edição)
/terminal/:tabId    → TerminalPage
/settings           → Settings
/sync               → Sync
/backup             → Backup
/*                  → redireciona para /
```

Todas as rotas são filhas de `<AppLayout>` (Sidebar + TabBar sempre visíveis).
Baseado em `BrowserRouter` (hash routing não utilizado).

---

## 9. Internacionalização (i18n)

**Arquivo:** `src/lib/i18n.ts`

- **Biblioteca:** `react-i18next` + `i18next`
- **Idiomas:** `pt-BR` (padrão), `en-US` (fallback)
- **Recursos:** `src/locales/{pt-BR,en-US}/translation.json`

```typescript
type LocaleId = "pt-BR" | "en-US";

const LOCALES: { id: LocaleId; label: string; flag: string }[] = [
  { id: "pt-BR", label: "Português (BR)", flag: "🇧🇷" },
  { id: "en-US", label: "English (US)",   flag: "🇺🇸" },
];
```

**Namespace de tradução — estrutura de chaves:**

```
app.*              Nome e tagline
nav.*              Itens de navegação
dashboard.*        Tela principal e cards de host
hostEditor.*       Formulário de host (fields, sections, validation, mfa)
terminal.*         Labels do terminal
settings.*         Configurações (appearance, language, terminal, security)
sync.*             Sincronização (providers, status, conflicts)
backup.*           Backup e restauração
common.*           Labels genéricos (save, cancel, delete, etc.)
```

**Trocar idioma programaticamente:**

```typescript
import i18n from "@/lib/i18n";
i18n.changeLanguage("en-US");
```

---

## 10. Módulo de backup

**Arquivo:** `src/lib/backup.ts`

### Tipos exportados

```typescript
interface BackupFile {
  app: "ssh-vault";
  version: 1;
  exportedAt: string;        // ISO 8601
  hosts: SshHost[];
  settings: BackupSettings;
  encryptedCredentials?: EncryptedCredentials;
}

interface BackupSettings {
  themeId: string;
  locale: string;
  terminal: AppSettings["terminal"];
}

interface CredentialsMap {
  [hostId: string]: {
    password?:       string;
    passphrase?:     string;
    privateKeyPath?: string;
    totpSecret?:     string;  // Segredo TOTP — cifrado junto
  };
}

interface ImportResult {
  backup: BackupFile;
  credentials: CredentialsMap | null;
  hasEncryptedCredentials: boolean;
}
```

### Funções exportadas

#### `exportBackup`

```typescript
async function exportBackup(
  hosts: SshHost[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<void>
```

1. Monta `BackupSettings` sem dados sensíveis de sync
2. Remove `passwordRef` e `passphrase` dos hosts no JSON em claro
3. Se `masterPassword` fornecida, serializa `CredentialsMap` e chama `encrypt_credentials`
4. Abre diálogo nativo de salvar (`.sshvault`)
5. Grava JSON formatado via `writeTextFile`

#### `importBackup`

```typescript
async function importBackup(
  masterPassword: string | null
): Promise<ImportResult | null>
```

1. Abre diálogo nativo de abrir
2. Lê e valida estrutura (`app === "ssh-vault"`, `version === 1`)
3. Se há `encryptedCredentials` e senha fornecida, chama `decrypt_credentials`
4. Retorna `null` se usuário cancelar

#### `mergeCredentials`

```typescript
function mergeCredentials(
  hosts: SshHost[],
  credentials: CredentialsMap
): SshHost[]
```

Aplica `passwordRef`, `passphrase`, `privateKeyPath` e `totpSecret` de volta nos hosts após importação.

---

## 11. Temas

**Arquivos:** `src/themes/index.ts`, `src/themes/themes.css`

```typescript
type ThemeId = "dark" | "light" | "dracula" | "nord" | "catppuccin" | "solarized";

interface Theme {
  id: ThemeId;
  name: string;
  preview: { bg: string; accent: string; text: string };
}
```

**Temas disponíveis:**

| ID | Nome | Fundo | Destaque |
| --- | --- | --- | --- |
| `dark` | Dark | `#0f1117` | `#388bfd` |
| `light` | Light | `#ffffff` | `#0969da` |
| `dracula` | Dracula | `#282a36` | `#bd93f9` |
| `nord` | Nord | `#2e3440` | `#88c0d0` |
| `catppuccin` | Catppuccin | `#1e1e2e` | `#cba6f7` |
| `solarized` | Solarized Dark | `#002b36` | `#268bd2` |

**Aplicação:**

```typescript
function applyTheme(themeId: ThemeId): void
// Define document.documentElement.setAttribute("data-theme", themeId)
// O CSS em themes.css mapeia [data-theme="x"] para CSS variables
```

**CSS variables principais:**

```css
--bg-primary      /* fundo principal */
--bg-secondary    /* fundo de cards/painéis */
--bg-tertiary     /* fundo de badges/inputs */
--bg-hover        /* fundo ao passar mouse */
--text-primary    /* texto principal */
--text-secondary  /* texto secundário */
--text-muted      /* texto de dica */
--border          /* borda padrão */
--border-focus    /* borda com foco */
--accent          /* cor de destaque */
--accent-subtle   /* destaque com baixa opacidade */
--danger          /* vermelho (erros, exclusão) */
--success         /* verde */
--warning         /* amarelo */
```

---

## 12. Configuração do Tauri

**Arquivo:** `src-tauri/tauri.conf.json`

```json
{
  "productName": "SSH Vault",
  "version": "0.1.0",
  "identifier": "com.fernando.ssh-vault",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{
      "title": "SSH Vault",
      "width": 1200,
      "height": 750,
      "minWidth": 900,
      "minHeight": 600,
      "decorations": true
    }],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {}
}
```

**Plugins Tauri ativos:**

| Plugin | Finalidade |
| --- | --- |
| `tauri-plugin-dialog` | Diálogos nativos de abrir/salvar arquivo |
| `tauri-plugin-fs` | Leitura e escrita de arquivos |
| `tauri-plugin-opener` | Abrir links externos no browser padrão |

---

## 13. Dependências Rust

**Arquivo:** `src-tauri/Cargo.toml`

| Crate | Versão | Finalidade |
| --- | --- | --- |
| `tauri` | 2 | Framework desktop |
| `tauri-plugin-dialog` | 2 | Diálogos de arquivo nativos |
| `tauri-plugin-fs` | 2 | I/O de arquivos |
| `tauri-plugin-opener` | 2 | Abrir URLs externas |
| `serde` + `serde_json` | 1 | Serialização JSON |
| `uuid` | 1 (v4) | Geração de UUIDs |
| `chrono` | 0.4 | Timestamps ISO 8601 |
| `keyring` | 3 | Keychain do SO |
| `dirs` | 5 | Diretórios de dados do usuário |
| `aes-gcm` | 0.10 | Cifra AES-256-GCM |
| `argon2` | 0.5 | KDF Argon2id |
| `rand` | 0.8 | Geração de bytes aleatórios seguros |
| `base64` | 0.22 | Codificação Base64 |
| `zeroize` | 1 | Zeroing de dados sensíveis na memória |
| `totp-rs` | 5 (gen_secret, otpauth) | TOTP RFC 6238 |

---

## 14. Segurança — fluxo de dados sensíveis

### Armazenamento local

```
Senha do SSH / Frase-senha
        │
        ▼ keyring (OS keychain)
  Nunca vai para localStorage
```

```
Configurações e metadados dos hosts
        │
        ▼ Zustand persist → localStorage
  Sem campos sensíveis (passwordRef é apenas uma chave de lookup)
```

### Backup / Sync (quando syncCredentials = true)

```
{ password, passphrase, privateKeyPath, totpSecret }
        │
        ▼ JSON serializado em memória
        │
        ▼ Argon2id (m=64MB, t=3, p=1) derivação de chave da senha mestra
        │
        ▼ AES-256-GCM + salt e nonce aleatórios (16 + 12 bytes)
        │
        ▼ EncryptedCredentials { version, salt, nonce, ciphertext }
        │
        ├──► arquivo .sshvault
        └──► provedor de sync remoto
```

### Garantias

- A **senha mestra nunca sai do dispositivo**
- Salt e nonce são gerados frescos a cada cifragem (segurança semântica)
- A tag GCM autentica os dados — adulteração é detectada
- Chave AES e senha zeroizadas da memória após uso (`zeroize`)
- Sem a senha mestra correta, os dados são computacionalmente irrecuperáveis

---

## 15. Build e empacotamento

### Scripts npm

**Arquivo:** `package.json`

```json
"scripts": {
  "dev":     "vite",
  "build":   "tsc && vite build",
  "preview": "vite preview",
  "tauri":   "NO_STRIP=1 APPIMAGE_EXTRACT_AND_RUN=1 PATH=\"$HOME/.cargo/bin:$PATH\" tauri"
}
```

> **`NO_STRIP=1`** — Desabilita o `strip` no linuxdeploy, necessário no Arch/CachyOS porque o `strip` empacotado no linuxdeploy AppImage não reconhece seções `.relr.dyn` (SHT_RELR) usadas pelas bibliotecas modernas.
> **`APPIMAGE_EXTRACT_AND_RUN=1`** — Faz o linuxdeploy e appimagetool se auto-extraírem sem FUSE.
> **`PATH`** — Garante que `cargo` e `rustc` sejam encontrados (necessário quando npm é invocado sem o shell de login do usuário).

### Pacotes gerados por plataforma

| Plataforma | Formato | Localização |
| --- | --- | --- |
| Linux | `.deb` | `bundle/deb/` |
| Linux | `.rpm` | `bundle/rpm/` |
| Linux | `.AppImage` | `bundle/appimage/` |
| Windows | `.exe` (NSIS) | `bundle/nsis/` |
| Windows | `.msi` | `bundle/msi/` |
| macOS | `.dmg` | `bundle/dmg/` |
| macOS | `.app` | `bundle/macos/` |

Base: `src-tauri/target/release/bundle/`

### CI/CD — GitHub Actions

**Arquivo:** `.github/workflows/build.yml`

Matrix de build: `ubuntu-22.04`, `windows-latest`, `macos-latest` em paralelo.

**Disparar manualmente:**

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Artifacts disponíveis em: **GitHub → Actions → build → Artifacts**
