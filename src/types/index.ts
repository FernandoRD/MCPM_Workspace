export type AuthMethod = "password" | "privateKey" | "agent";

export interface Credential {
  id: string;
  label: string;
  username: string;
  authMethod: "password" | "privateKey" | "agent";
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SshHost {
  id: string;
  label: string;
  host: string;
  port: number;
  username?: string;
  credentialId?: string;
  authMethod: AuthMethod;
  // Armazenadas de forma segura — só referência aqui
  passwordRef?: string;
  privateKeyPath?: string;
  passphrase?: string;
  // MFA / TOTP
  mfaEnabled?: boolean;
  totpSecret?: string;  // Base32 — sempre cifrado no sync/backup
  group?: string;
  tags: string[];
  notes?: string;
  jumpHostId?: string;
  keepAliveInterval?: number;
  connectionTimeout?: number;
  lastConnectedAt?: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
}

export interface SessionTab {
  id: string;
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  createdAt: string;
}

export type SyncProvider = "githubGist" | "s3" | "webdav" | "custom" | null;

export interface GistSyncConfig {
  token: string;
  gistId?: string;
}

export interface S3SyncConfig {
  endpoint: string;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
}

export interface WebDavSyncConfig {
  url: string;
  username: string;
  password: string;
  path: string;
}

export interface CustomSyncConfig {
  url: string;
}

/** Credencial sem campos sensíveis — trafega em claro no sync */
export type CredentialMeta = Omit<Credential, "password" | "passphrase">;

export interface AppSettings {
  themeId: string;
  locale: string;
  terminal: {
    fontSize: number;
    fontFamily: string;
    cursorStyle: "block" | "underline" | "bar";
    cursorBlink: boolean;
    scrollback: number;
  };
  security: {
    /** true se uma senha mestra foi definida (a senha em si nunca é salva aqui) */
    masterPasswordSet: boolean;
    /** Cifra um payload de verificação para confirmar a senha na próxima sessão */
    verificationPayload?: string;
    syncCredentials: boolean;
  };
  sync: {
    provider: SyncProvider;
    autoSync: boolean;
    lastSyncAt?: string;
    gist?: GistSyncConfig;
    s3?: S3SyncConfig;
    webdav?: WebDavSyncConfig;
    custom?: CustomSyncConfig;
  };
}

/** Payload cifrado que viaja no sync */
export interface EncryptedCredentials {
  version: number;
  salt: string;
  nonce: string;
  ciphertext: string;
}

/** Estrutura completa do pacote de sync */
export interface SyncPackage {
  version: 1;
  exportedAt: string;
  hosts: import("./index").SshHost[];
  encryptedCredentials?: EncryptedCredentials;
}

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "notConfigured";
