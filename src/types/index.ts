export type AuthMethod = "password" | "privateKey" | "agent";
export type ConnectionProtocol = "ssh" | "telnet" | "rdp" | "vnc";
export type LinuxRdpClient = "auto" | "xfreerdp" | "wlfreerdp" | "remmina" | "krdc";
export type LinuxVncClient = "auto" | "tigervnc" | "remmina" | "krdc" | "vinagre" | "system";
export type RdpAudioMode = "redirect" | "remote" | "disabled";
export type RdpCertificateMode = "ignore" | "strict";
export type RdpLaunchMode = "native" | "internalExperimental";

export type SshCompatPreset = "modern" | "legacy" | "very-legacy";

export interface SshCompatOptions {
  preset: SshCompatPreset;
}

export interface SshKey {
  id: string;
  label: string;
  privateKeyContent: string;
  publicKeyContent?: string;
  passphrase?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Credential {
  id: string;
  label: string;
  username: string;
  authMethod: "password" | "privateKey" | "agent";
  password?: string;
  keyId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface HostEntry {
  id: string;
  label: string;
  host: string;
  port: number;
  protocol: ConnectionProtocol;
  username?: string;
  credentialId?: string;
  authMethod: AuthMethod;
  // Armazenadas de forma segura — só referência aqui
  passwordRef?: string;
  // MFA / TOTP
  mfaEnabled?: boolean;
  totpSecret?: string;  // Base32 — sempre cifrado no sync/backup
  totpAlgorithm?: "SHA1" | "SHA256";
  group?: string;
  tags: string[];
  notes?: string;
  jumpHostId?: string;
  lastConnectedAt?: string;
  createdAt: string;
  updatedAt: string;
  color?: string;
  sshCompat?: SshCompatOptions;
  keepAliveInterval?: number;
  connectionTimeout?: number;
}

/** @deprecated Use HostEntry. */
export type SshHost = HostEntry;

export type TabType = "terminal" | "sftp" | "rdp" | "vnc";
export type SplitDirection = "horizontal" | "vertical";

export interface TerminalPaneState {
  id: string; // used as the SSH session ID in the backend
  status: "connecting" | "connected" | "disconnected" | "error";
}

/** @deprecated Use TerminalPaneState. */
export type SshPane = TerminalPaneState;

export interface SftpEntrySnapshot {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified?: number;
}

export interface SessionConnection {
  source: "saved-host" | "quick-connect";
  protocol: ConnectionProtocol;
  host: string;
  port: number;
  username: string;
  authMethod: AuthMethod;
  bootstrapId?: string;
  password?: string | null;
  privateKeyContent?: string | null;
  passphrase?: string | null;
  sshCompatPreset?: SshCompatPreset;
}

export interface SessionTab {
  id: string;
  type: TabType;
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  connection?: SessionConnection;
  status: "connecting" | "connected" | "disconnected" | "error";
  panes: TerminalPaneState[];
  splitDirection: SplitDirection;
  createdAt: string;
}

export interface TerminalPaneSnapshot {
  outputBase64Chunks: string[];
}

export interface SftpTabSnapshot {
  currentPath: string;
  entries: SftpEntrySnapshot[];
}

export interface RdpSettings {
  launchMode: RdpLaunchMode;
  linuxClient: LinuxRdpClient;
  fullscreen: boolean;
  dynamicResolution: boolean;
  width: number;
  height: number;
  multimon: boolean;
  clipboard: boolean;
  audioMode: RdpAudioMode;
  certificateMode: RdpCertificateMode;
  internalClientPerformance: RdpInternalClientPerformanceSettings;
}

export interface RdpInternalClientPerformanceSettings {
  wallpaper: boolean;
  fullWindowDrag: boolean;
  menuAnimations: boolean;
  theming: boolean;
  cursorShadow: boolean;
  cursorSettings: boolean;
  fontSmoothing: boolean;
  desktopComposition: boolean;
}

export const DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS: RdpInternalClientPerformanceSettings = {
  wallpaper: false,
  fullWindowDrag: false,
  menuAnimations: false,
  theming: false,
  cursorShadow: false,
  cursorSettings: false,
  fontSmoothing: false,
  desktopComposition: false,
};

export interface VncSettings {
  linuxClient: LinuxVncClient;
  fullscreen: boolean;
  viewOnly: boolean;
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
    sessionOpenMode: "tab" | "window";
  };
  ssh: {
    keepAliveInterval: number;
    inactivityTimeout: number;
  };
  rdp: RdpSettings;
  vnc: VncSettings;
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
    autoSyncIntervalMinutes?: number;
    lastSyncAt?: string;
    gist?: GistSyncConfig;
    s3?: S3SyncConfig;
    webdav?: WebDavSyncConfig;
    custom?: CustomSyncConfig;
  };
  /** Lista de grupos criados manualmente (persiste grupos sem hosts associados) */
  groups: string[];
  productivity: {
    snippets: CommandSnippet[];
    tunnels: TunnelProfile[];
    workspaces: Workspace[];
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
  hosts: import("./index").HostEntry[];
  encryptedCredentials?: EncryptedCredentials;
}

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "notConfigured";

// ─── Productivity types ────────────────────────────────────────────────────────

export interface CommandSnippet {
  id: string;
  label: string;
  command: string;
  description?: string;
  scopeType: "global" | "host" | "group";
  scopeValue?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TunnelProfile {
  id: string;
  label: string;
  hostId: string;
  kind: "local" | "remote" | "dynamic";
  bindAddress: string;
  bindPort: number;
  destinationHost: string;
  destinationPort: number;
  localHost?: string;
  localPort?: number;
  autoStart: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceItem {
  hostId: string;
  type: TabType;
}

export interface Workspace {
  id: string;
  name: string;
  items: WorkspaceItem[];
  createdAt: string;
  updatedAt: string;
}
