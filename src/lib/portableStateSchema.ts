/**
 * Runtime validation for files that cross the application's trust boundary.
 *
 * The portable format is deliberately validated here instead of relying on the
 * TypeScript interfaces: sync providers and backup files are both untrusted.
 */
import {
  Credential,
  EncryptedCredentials,
  HostEntry,
  SshKey,
} from "@/types";
import { PortableSyncSettings } from "@/lib/portableState";
import { TransferSecretsPayload } from "@/lib/portableState";

const MAX_PAYLOAD_CHARS = 20 * 1024 * 1024;
const MAX_COLLECTION_ITEMS = 10_000;
const MAX_STRING_LENGTH = 16_384;
const MAX_CIPHERTEXT_LENGTH = 18 * 1024 * 1024;
const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type UnknownRecord = Record<string, unknown>;

export interface PortableStateFile {
  app: "ssh-vault";
  version: 1;
  hosts: HostEntry[];
  credentials: Credential[];
  sshKeys: SshKey[];
  settings: PortableSyncSettings;
  syncedAt?: string;
  exportedAt?: string;
  deletedHosts?: Record<string, string>;
  encryptedSecrets?: EncryptedCredentials;
  encryptedCredentials?: EncryptedCredentials;
}

function fail(path: string, reason: string): never {
  throw new Error(`Payload inválido: ${path} ${reason}`);
}

function isRecord(value: unknown): value is UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rejectDangerousKeys(value: unknown, path = "raiz", depth = 0): void {
  if (depth > 32) fail(path, "é profundo demais");
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectDangerousKeys(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key)) fail(`${path}.${key}`, "contém uma chave não permitida");
    rejectDangerousKeys(child, `${path}.${key}`, depth + 1);
  }
}

function object(value: unknown, path: string): UnknownRecord {
  if (!isRecord(value)) fail(path, "deve ser um objeto");
  return value;
}

function string(value: unknown, path: string, options: { required?: boolean; max?: number } = {}): string | undefined {
  if (value === undefined && !options.required) return undefined;
  if (typeof value !== "string") fail(path, "deve ser texto");
  if (value.length > (options.max ?? MAX_STRING_LENGTH)) fail(path, "é longo demais");
  return value;
}

function nonEmptyString(value: unknown, path: string, max?: number): string {
  const result = string(value, path, { required: true, max });
  if (result === undefined) fail(path, "deve ser texto");
  if (!result.trim()) fail(path, "não pode estar vazio");
  return result;
}

function boolean(value: unknown, path: string, required = false): boolean | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "boolean") fail(path, "deve ser booleano");
  return value;
}

function integer(value: unknown, path: string, min: number, max: number, required = false): number | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail(path, `deve ser um inteiro entre ${min} e ${max}`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, values: readonly T[], required = false): T | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !values.includes(value as T)) {
    fail(path, `tem um valor não suportado`);
  }
  return value as T;
}

function optionalDate(value: unknown, path: string, required = false): string | undefined {
  const result = string(value, path, { required });
  const rfc3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (result !== undefined && (!rfc3339.test(result) || !Number.isFinite(Date.parse(result)))) {
    fail(path, "deve ser uma data RFC 3339 válida");
  }
  return result;
}

function array(value: unknown, path: string, required = false): unknown[] | undefined {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value)) fail(path, "deve ser uma lista");
  if (value.length > MAX_COLLECTION_ITEMS) fail(path, "tem itens demais");
  return value;
}

function stringArray(value: unknown, path: string, required = false): string[] | undefined {
  const values = array(value, path, required);
  return values?.map((item, index) => nonEmptyString(item, `${path}[${index}]`, 512));
}

function ensureUniqueIds(items: Array<{ id: string }>, path: string): void {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) fail(path, `contém id duplicado: ${item.id}`);
    ids.add(item.id);
  }
}

function noCleartextSecrets(input: UnknownRecord, path: string, forbidden: string[]): void {
  for (const key of forbidden) {
    if (key in input) fail(`${path}.${key}`, "não é permitido em texto claro");
  }
}

function validateHost(value: unknown, path: string): HostEntry {
  const input = object(value, path);
  noCleartextSecrets(input, path, ["password", "passwordRef", "totpSecret", "privateKeyContent", "passphrase"]);
  const protocol = oneOf(input.protocol, `${path}.protocol`, ["ssh", "telnet", "rdp", "vnc"] as const, true)!;
  const authMethod = oneOf(input.authMethod, `${path}.authMethod`, ["password", "privateKey", "agent"] as const, true)!;
  const host: HostEntry = {
    id: nonEmptyString(input.id, `${path}.id`, 256),
    label: nonEmptyString(input.label, `${path}.label`, 512),
    host: nonEmptyString(input.host, `${path}.host`, 1024),
    port: integer(input.port, `${path}.port`, 1, 65_535, true)!,
    protocol,
    authMethod,
    tags: stringArray(input.tags, `${path}.tags`, true)!,
    createdAt: optionalDate(input.createdAt, `${path}.createdAt`, true)!,
    updatedAt: optionalDate(input.updatedAt, `${path}.updatedAt`, true)!,
  };
  const username = string(input.username, `${path}.username`, { max: 512 });
  const credentialId = string(input.credentialId, `${path}.credentialId`, { max: 256 });
  const mfaEnabled = boolean(input.mfaEnabled, `${path}.mfaEnabled`);
  const totpAlgorithm = oneOf(input.totpAlgorithm, `${path}.totpAlgorithm`, ["SHA1", "SHA256"] as const);
  const group = string(input.group, `${path}.group`, { max: 1024 });
  const notes = string(input.notes, `${path}.notes`, { max: MAX_STRING_LENGTH });
  const jumpHostId = string(input.jumpHostId, `${path}.jumpHostId`, { max: 256 });
  const lastConnectedAt = optionalDate(input.lastConnectedAt, `${path}.lastConnectedAt`);
  const color = string(input.color, `${path}.color`, { max: 64 });
  const keepAliveInterval = integer(input.keepAliveInterval, `${path}.keepAliveInterval`, 0, 86_400);
  const connectionTimeout = integer(input.connectionTimeout, `${path}.connectionTimeout`, 0, 3_600);
  const sshCompat = input.sshCompat === undefined ? undefined : object(input.sshCompat, `${path}.sshCompat`);
  if (sshCompat) {
    host.sshCompat = { preset: oneOf(sshCompat.preset, `${path}.sshCompat.preset`, ["modern", "legacy", "very-legacy"] as const, true)! };
  }
  return {
    ...host,
    ...(username !== undefined ? { username } : {}),
    ...(credentialId !== undefined ? { credentialId } : {}),
    ...(mfaEnabled !== undefined ? { mfaEnabled } : {}),
    ...(totpAlgorithm !== undefined ? { totpAlgorithm } : {}),
    ...(group !== undefined ? { group } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(jumpHostId !== undefined ? { jumpHostId } : {}),
    ...(lastConnectedAt !== undefined ? { lastConnectedAt } : {}),
    ...(color !== undefined ? { color } : {}),
    ...(keepAliveInterval !== undefined ? { keepAliveInterval } : {}),
    ...(connectionTimeout !== undefined ? { connectionTimeout } : {}),
  };
}

function validateCredential(value: unknown, path: string): Credential {
  const input = object(value, path);
  noCleartextSecrets(input, path, ["password", "passphrase", "privateKeyContent"]);
  const keyId = string(input.keyId, `${path}.keyId`, { max: 256 });
  return {
    id: nonEmptyString(input.id, `${path}.id`, 256),
    label: nonEmptyString(input.label, `${path}.label`, 512),
    username: nonEmptyString(input.username, `${path}.username`, 512),
    authMethod: oneOf(input.authMethod, `${path}.authMethod`, ["password", "privateKey", "agent"] as const, true)!,
    createdAt: optionalDate(input.createdAt, `${path}.createdAt`, true)!,
    updatedAt: optionalDate(input.updatedAt, `${path}.updatedAt`, true)!,
    ...(keyId !== undefined ? { keyId } : {}),
  };
}

function validateSshKey(value: unknown, path: string): SshKey {
  const input = object(value, path);
  noCleartextSecrets(input, path, ["privateKeyContent", "passphrase", "password"]);
  const publicKeyContent = string(input.publicKeyContent, `${path}.publicKeyContent`, { max: MAX_STRING_LENGTH });
  return {
    id: nonEmptyString(input.id, `${path}.id`, 256),
    label: nonEmptyString(input.label, `${path}.label`, 512),
    // Hydration supplies the actual private material only after decrypting it.
    privateKeyContent: "",
    createdAt: optionalDate(input.createdAt, `${path}.createdAt`, true)!,
    updatedAt: optionalDate(input.updatedAt, `${path}.updatedAt`, true)!,
    ...(publicKeyContent !== undefined ? { publicKeyContent } : {}),
  };
}

function validateEncryptedCredentials(value: unknown, path: string): EncryptedCredentials {
  const input = object(value, path);
  const salt = nonEmptyString(input.salt, `${path}.salt`, 1024);
  const nonce = nonEmptyString(input.nonce, `${path}.nonce`, 1024);
  const ciphertext = nonEmptyString(input.ciphertext, `${path}.ciphertext`, MAX_CIPHERTEXT_LENGTH);
  const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
  if (!base64.test(salt) || !base64.test(nonce) || !base64.test(ciphertext)) {
    fail(path, "tem dados cifrados malformados");
  }
  return {
    version: integer(input.version, `${path}.version`, 1, 1, true)!,
    salt,
    nonce,
    ciphertext,
  };
}

/** Validates a serialized encryption envelope returned by the native layer. */
export function parseEncryptedCredentialsJson(raw: string, path = "dados cifrados"): EncryptedCredentials {
  if (typeof raw !== "string" || raw.length > MAX_CIPHERTEXT_LENGTH) {
    throw new Error("Payload cifrado inválido");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Payload cifrado inválido");
  }
  rejectDangerousKeys(parsed, path);
  return validateEncryptedCredentials(parsed, path);
}

function validateDeletedHosts(value: unknown, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const input = object(value, path);
  const entries = Object.entries(input);
  if (entries.length > MAX_COLLECTION_ITEMS) fail(path, "tem itens demais");
  const output: Record<string, string> = {};
  for (const [id, deletedAt] of entries) {
    output[nonEmptyString(id, `${path}.id`, 256)] = optionalDate(deletedAt, `${path}.${id}`, true)!;
  }
  return output;
}

function validateSettings(value: unknown, path: string): PortableSyncSettings {
  const input = object(value, path);
  const dashboard = input.dashboard === undefined ? undefined : object(input.dashboard, `${path}.dashboard`);
  const terminal = input.terminal === undefined ? undefined : object(input.terminal, `${path}.terminal`);
  const ssh = input.ssh === undefined ? undefined : object(input.ssh, `${path}.ssh`);
  const rdp = input.rdp === undefined ? undefined : object(input.rdp, `${path}.rdp`);
  const performance = rdp?.internalClientPerformance === undefined ? undefined : object(rdp.internalClientPerformance, `${path}.rdp.internalClientPerformance`);
  const security = input.security === undefined ? undefined : object(input.security, `${path}.security`);
  const sync = input.sync === undefined ? undefined : object(input.sync, `${path}.sync`);
  const gist = sync?.gist === undefined ? undefined : object(sync.gist, `${path}.sync.gist`);
  const s3 = sync?.s3 === undefined ? undefined : object(sync.s3, `${path}.sync.s3`);
  const webdav = sync?.webdav === undefined ? undefined : object(sync.webdav, `${path}.sync.webdav`);
  const custom = sync?.custom === undefined ? undefined : object(sync.custom, `${path}.sync.custom`);
  const productivity = input.productivity === undefined ? undefined : object(input.productivity, `${path}.productivity`);
  if (security) noCleartextSecrets(security, `${path}.security`, ["verificationPayload"]);
  if (gist) noCleartextSecrets(gist, `${path}.sync.gist`, ["token"]);
  if (s3) noCleartextSecrets(s3, `${path}.sync.s3`, ["accessKey", "secretKey"]);
  if (webdav) noCleartextSecrets(webdav, `${path}.sync.webdav`, ["password"]);

  const snippets = stringArray(input.groups, `${path}.groups`) ?? [];
  const validatedSnippets = array(productivity?.snippets, `${path}.productivity.snippets`)?.map((item, index) => {
    const snippet = object(item, `${path}.productivity.snippets[${index}]`);
    return {
      id: nonEmptyString(snippet.id, `${path}.productivity.snippets[${index}].id`, 256),
      label: nonEmptyString(snippet.label, `${path}.productivity.snippets[${index}].label`, 512),
      command: nonEmptyString(snippet.command, `${path}.productivity.snippets[${index}].command`, MAX_STRING_LENGTH),
      scopeType: oneOf(snippet.scopeType, `${path}.productivity.snippets[${index}].scopeType`, ["global", "host", "group"] as const, true)!,
      tags: stringArray(snippet.tags, `${path}.productivity.snippets[${index}].tags`, true)!,
      createdAt: optionalDate(snippet.createdAt, `${path}.productivity.snippets[${index}].createdAt`, true)!,
      updatedAt: optionalDate(snippet.updatedAt, `${path}.productivity.snippets[${index}].updatedAt`, true)!,
      ...(string(snippet.description, `${path}.productivity.snippets[${index}].description`, { max: MAX_STRING_LENGTH }) !== undefined ? { description: string(snippet.description, `${path}.productivity.snippets[${index}].description`, { max: MAX_STRING_LENGTH }) } : {}),
      ...(string(snippet.scopeValue, `${path}.productivity.snippets[${index}].scopeValue`, { max: 1024 }) !== undefined ? { scopeValue: string(snippet.scopeValue, `${path}.productivity.snippets[${index}].scopeValue`, { max: 1024 }) } : {}),
    };
  }) ?? [];
  const validatedTunnels = array(productivity?.tunnels, `${path}.productivity.tunnels`)?.map((item, index) => {
    const tunnel = object(item, `${path}.productivity.tunnels[${index}]`);
    const localHost = string(tunnel.localHost, `${path}.productivity.tunnels[${index}].localHost`, { max: 1024 });
    const localPort = integer(tunnel.localPort, `${path}.productivity.tunnels[${index}].localPort`, 1, 65_535);
    return {
      id: nonEmptyString(tunnel.id, `${path}.productivity.tunnels[${index}].id`, 256),
      label: nonEmptyString(tunnel.label, `${path}.productivity.tunnels[${index}].label`, 512),
      hostId: nonEmptyString(tunnel.hostId, `${path}.productivity.tunnels[${index}].hostId`, 256),
      kind: oneOf(tunnel.kind, `${path}.productivity.tunnels[${index}].kind`, ["local", "remote", "dynamic"] as const, true)!,
      bindAddress: nonEmptyString(tunnel.bindAddress, `${path}.productivity.tunnels[${index}].bindAddress`, 1024),
      bindPort: integer(tunnel.bindPort, `${path}.productivity.tunnels[${index}].bindPort`, 1, 65_535, true)!,
      destinationHost: nonEmptyString(tunnel.destinationHost, `${path}.productivity.tunnels[${index}].destinationHost`, 1024),
      destinationPort: integer(tunnel.destinationPort, `${path}.productivity.tunnels[${index}].destinationPort`, 1, 65_535, true)!,
      autoStart: boolean(tunnel.autoStart, `${path}.productivity.tunnels[${index}].autoStart`, true)!,
      createdAt: optionalDate(tunnel.createdAt, `${path}.productivity.tunnels[${index}].createdAt`, true)!,
      updatedAt: optionalDate(tunnel.updatedAt, `${path}.productivity.tunnels[${index}].updatedAt`, true)!,
      ...(localHost !== undefined ? { localHost } : {}),
      ...(localPort !== undefined ? { localPort } : {}),
    };
  }) ?? [];
  const validatedWorkspaces = array(productivity?.workspaces, `${path}.productivity.workspaces`)?.map((item, index) => {
    const workspace = object(item, `${path}.productivity.workspaces[${index}]`);
    return {
      id: nonEmptyString(workspace.id, `${path}.productivity.workspaces[${index}].id`, 256),
      name: nonEmptyString(workspace.name, `${path}.productivity.workspaces[${index}].name`, 512),
      items: array(workspace.items, `${path}.productivity.workspaces[${index}].items`, true)!.map((entry, itemIndex) => {
        const workspaceItem = object(entry, `${path}.productivity.workspaces[${index}].items[${itemIndex}]`);
        return {
          hostId: nonEmptyString(workspaceItem.hostId, `${path}.productivity.workspaces[${index}].items[${itemIndex}].hostId`, 256),
          type: oneOf(workspaceItem.type, `${path}.productivity.workspaces[${index}].items[${itemIndex}].type`, ["terminal", "sftp", "rdp", "vnc"] as const, true)!,
        };
      }),
      createdAt: optionalDate(workspace.createdAt, `${path}.productivity.workspaces[${index}].createdAt`, true)!,
      updatedAt: optionalDate(workspace.updatedAt, `${path}.productivity.workspaces[${index}].updatedAt`, true)!,
    };
  }) ?? [];

  return {
    themeId: string(input.themeId, `${path}.themeId`, { max: 128 }) ?? "dark",
    locale: string(input.locale, `${path}.locale`, { max: 64 }) ?? "pt-BR",
    dashboard: { cardMode: oneOf(dashboard?.cardMode, `${path}.dashboard.cardMode`, ["full", "compact"] as const) ?? "full" },
    terminal: {
      fontSize: integer(terminal?.fontSize, `${path}.terminal.fontSize`, 6, 72) ?? 14,
      fontFamily: string(terminal?.fontFamily, `${path}.terminal.fontFamily`, { max: 256 }) ?? "JetBrains Mono",
      cursorStyle: oneOf(terminal?.cursorStyle, `${path}.terminal.cursorStyle`, ["block", "underline", "bar"] as const) ?? "block",
      cursorBlink: boolean(terminal?.cursorBlink, `${path}.terminal.cursorBlink`) ?? true,
      scrollback: integer(terminal?.scrollback, `${path}.terminal.scrollback`, 0, 100_000) ?? 5000,
      sessionOpenMode: oneOf(terminal?.sessionOpenMode, `${path}.terminal.sessionOpenMode`, ["tab", "window"] as const) ?? "tab",
      rightClickBehavior: oneOf(terminal?.rightClickBehavior, `${path}.terminal.rightClickBehavior`, ["contextMenu", "copyPaste"] as const) ?? "contextMenu",
    },
    ssh: {
      keepAliveInterval: integer(ssh?.keepAliveInterval, `${path}.ssh.keepAliveInterval`, 0, 86_400) ?? 60,
      inactivityTimeout: integer(ssh?.inactivityTimeout, `${path}.ssh.inactivityTimeout`, 0, 86_400) ?? 0,
      sftpOpenMode: oneOf(ssh?.sftpOpenMode, `${path}.ssh.sftpOpenMode`, ["sameTab", "newTab"] as const) ?? "sameTab",
    },
    rdp: {
      launchMode: oneOf(rdp?.launchMode, `${path}.rdp.launchMode`, ["native", "internalExperimental"] as const) ?? "native",
      linuxClient: oneOf(rdp?.linuxClient, `${path}.rdp.linuxClient`, ["auto", "xfreerdp", "wlfreerdp", "remmina", "krdc"] as const) ?? "auto",
      fullscreen: boolean(rdp?.fullscreen, `${path}.rdp.fullscreen`) ?? false,
      dynamicResolution: boolean(rdp?.dynamicResolution, `${path}.rdp.dynamicResolution`) ?? true,
      width: integer(rdp?.width, `${path}.rdp.width`, 640, 7680) ?? 1600,
      height: integer(rdp?.height, `${path}.rdp.height`, 480, 4320) ?? 900,
      multimon: boolean(rdp?.multimon, `${path}.rdp.multimon`) ?? false,
      clipboard: boolean(rdp?.clipboard, `${path}.rdp.clipboard`) ?? true,
      audioMode: oneOf(rdp?.audioMode, `${path}.rdp.audioMode`, ["redirect", "remote", "disabled"] as const) ?? "redirect",
      certificateMode: oneOf(rdp?.certificateMode, `${path}.rdp.certificateMode`, ["ignore", "strict"] as const) ?? "ignore",
      internalClientPerformance: {
        wallpaper: boolean(performance?.wallpaper, `${path}.rdp.internalClientPerformance.wallpaper`) ?? false,
        fullWindowDrag: boolean(performance?.fullWindowDrag, `${path}.rdp.internalClientPerformance.fullWindowDrag`) ?? false,
        menuAnimations: boolean(performance?.menuAnimations, `${path}.rdp.internalClientPerformance.menuAnimations`) ?? false,
        theming: boolean(performance?.theming, `${path}.rdp.internalClientPerformance.theming`) ?? false,
        cursorShadow: boolean(performance?.cursorShadow, `${path}.rdp.internalClientPerformance.cursorShadow`) ?? false,
        cursorSettings: boolean(performance?.cursorSettings, `${path}.rdp.internalClientPerformance.cursorSettings`) ?? false,
        fontSmoothing: boolean(performance?.fontSmoothing, `${path}.rdp.internalClientPerformance.fontSmoothing`) ?? false,
        desktopComposition: boolean(performance?.desktopComposition, `${path}.rdp.internalClientPerformance.desktopComposition`) ?? false,
      },
    },
    security: { syncCredentials: boolean(security?.syncCredentials, `${path}.security.syncCredentials`) ?? false },
    sync: {
      provider: sync?.provider === null ? null : oneOf(sync?.provider, `${path}.sync.provider`, ["githubGist", "s3", "webdav", "custom"] as const) ?? null,
      autoSync: boolean(sync?.autoSync, `${path}.sync.autoSync`) ?? false,
      autoSyncIntervalMinutes: integer(sync?.autoSyncIntervalMinutes, `${path}.sync.autoSyncIntervalMinutes`, 1, 10_080) ?? 30,
      ...(validateDeletedHosts(sync?.deletedHosts, `${path}.sync.deletedHosts`) ? { deletedHosts: validateDeletedHosts(sync?.deletedHosts, `${path}.sync.deletedHosts`) } : {}),
      ...(gist ? { gist: { ...(string(gist.gistId, `${path}.sync.gist.gistId`, { max: 512 }) !== undefined ? { gistId: string(gist.gistId, `${path}.sync.gist.gistId`, { max: 512 }) } : {}) } } : {}),
      ...(s3 ? { s3: { endpoint: nonEmptyString(s3.endpoint, `${path}.sync.s3.endpoint`, 2048), bucket: nonEmptyString(s3.bucket, `${path}.sync.s3.bucket`, 512), region: nonEmptyString(s3.region, `${path}.sync.s3.region`, 512) } } : {}),
      ...(webdav ? { webdav: { url: nonEmptyString(webdav.url, `${path}.sync.webdav.url`, 2048), username: nonEmptyString(webdav.username, `${path}.sync.webdav.username`, 512), path: nonEmptyString(webdav.path, `${path}.sync.webdav.path`, 1024) } } : {}),
      ...(custom ? { custom: { url: nonEmptyString(custom.url, `${path}.sync.custom.url`, 2048) } } : {}),
    },
    groups: snippets,
    productivity: { snippets: validatedSnippets, tunnels: validatedTunnels, workspaces: validatedWorkspaces },
  };
}

/** Parses and validates a version 1 portable sync/backup document. */
export function parsePortableStateFile(raw: string): PortableStateFile {
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD_CHARS) {
    throw new Error("Payload inválido: arquivo vazio ou grande demais");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Payload inválido: não é um JSON válido");
  }
  rejectDangerousKeys(parsed);
  const input = object(parsed, "raiz");
  if (input.app !== "ssh-vault") fail("campo 'app'", "é incorreto");
  if (input.version !== 1) fail("campo 'version'", "não é suportado");
  const hosts = array(input.hosts, "hosts", true)!.map((item, index) => validateHost(item, `hosts[${index}]`));
  const credentials = array(input.credentials, "credentials", true)!.map((item, index) => validateCredential(item, `credentials[${index}]`));
  const sshKeys = array(input.sshKeys, "sshKeys", true)!.map((item, index) => validateSshKey(item, `sshKeys[${index}]`));
  ensureUniqueIds(hosts, "hosts");
  ensureUniqueIds(credentials, "credentials");
  ensureUniqueIds(sshKeys, "sshKeys");
  const settings = validateSettings(input.settings, "settings");
  const syncedAt = optionalDate(input.syncedAt, "syncedAt");
  const exportedAt = optionalDate(input.exportedAt, "exportedAt");
  const deletedHosts = validateDeletedHosts(input.deletedHosts, "deletedHosts");
  const encryptedSecrets = input.encryptedSecrets === undefined ? undefined : validateEncryptedCredentials(input.encryptedSecrets, "encryptedSecrets");
  const encryptedCredentials = input.encryptedCredentials === undefined ? undefined : validateEncryptedCredentials(input.encryptedCredentials, "encryptedCredentials");
  return {
    app: "ssh-vault",
    version: 1,
    hosts,
    credentials,
    sshKeys,
    settings,
    ...(syncedAt ? { syncedAt } : {}),
    ...(exportedAt ? { exportedAt } : {}),
    ...(deletedHosts ? { deletedHosts } : {}),
    ...(encryptedSecrets ? { encryptedSecrets } : {}),
    ...(encryptedCredentials ? { encryptedCredentials } : {}),
  };
}

/** Validates the JSON obtained after decrypting a portable payload. */
export function parseTransferSecretsPayload(raw: string): TransferSecretsPayload {
  if (typeof raw !== "string" || raw.length > MAX_PAYLOAD_CHARS) {
    throw new Error("Payload de segredos inválido");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Payload de segredos inválido");
  }
  rejectDangerousKeys(parsed, "segredos");
  const input = object(parsed, "segredos");
  const secretMap = (value: unknown, path: string, fields: readonly string[]): Record<string, Record<string, string>> | undefined => {
    if (value === undefined) return undefined;
    const map = object(value, path);
    if (Object.keys(map).length > MAX_COLLECTION_ITEMS) fail(path, "tem itens demais");
    const result: Record<string, Record<string, string>> = {};
    for (const [id, entry] of Object.entries(map)) {
      const item = object(entry, `${path}.${id}`);
      const clean: Record<string, string> = {};
      for (const field of fields) {
        const fieldValue = string(item[field], `${path}.${id}.${field}`, { max: MAX_STRING_LENGTH });
        if (fieldValue !== undefined) clean[field] = fieldValue;
      }
      if (Object.keys(clean).length === 0) fail(`${path}.${id}`, "não contém segredo válido");
      result[nonEmptyString(id, `${path}.id`, 256)] = clean;
    }
    return result;
  };
  const credentialMap = secretMap(input.credentials, "segredos.credentials", ["password"]);
  const hostMap = secretMap(input.hosts, "segredos.hosts", ["totpSecret"]);
  const sshKeyMap = secretMap(input.sshKeys, "segredos.sshKeys", ["privateKeyContent", "passphrase"]);
  const credentials = credentialMap && Object.fromEntries(
    Object.entries(credentialMap).map(([id, entry]) => [id, { password: entry.password }])
  );
  const hosts = hostMap && Object.fromEntries(
    Object.entries(hostMap).map(([id, entry]) => [id, { totpSecret: entry.totpSecret }])
  );
  const sshKeys = sshKeyMap && Object.fromEntries(
    Object.entries(sshKeyMap).map(([id, entry]) => [id, {
      ...(entry.privateKeyContent !== undefined ? { privateKeyContent: entry.privateKeyContent } : {}),
      ...(entry.passphrase !== undefined ? { passphrase: entry.passphrase } : {}),
    }])
  );
  const settings = input.settings === undefined ? undefined : object(input.settings, "segredos.settings");
  const security = settings?.security === undefined ? undefined : object(settings.security, "segredos.settings.security");
  const sync = settings?.sync === undefined ? undefined : object(settings.sync, "segredos.settings.sync");
  const gist = sync?.gist === undefined ? undefined : object(sync.gist, "segredos.settings.sync.gist");
  const s3 = sync?.s3 === undefined ? undefined : object(sync.s3, "segredos.settings.sync.s3");
  const webdav = sync?.webdav === undefined ? undefined : object(sync.webdav, "segredos.settings.sync.webdav");
  const verificationPayload = string(security?.verificationPayload, "segredos.settings.security.verificationPayload", { max: MAX_STRING_LENGTH });
  const token = string(gist?.token, "segredos.settings.sync.gist.token", { max: MAX_STRING_LENGTH });
  const accessKey = string(s3?.accessKey, "segredos.settings.sync.s3.accessKey", { max: MAX_STRING_LENGTH });
  const secretKey = string(s3?.secretKey, "segredos.settings.sync.s3.secretKey", { max: MAX_STRING_LENGTH });
  const password = string(webdav?.password, "segredos.settings.sync.webdav.password", { max: MAX_STRING_LENGTH });
  return {
    ...(credentials ? { credentials } : {}),
    ...(hosts ? { hosts } : {}),
    ...(sshKeys ? { sshKeys } : {}),
    ...(verificationPayload || token || accessKey || secretKey || password
      ? {
          settings: {
            ...(verificationPayload ? { security: { verificationPayload } } : {}),
            ...((token || accessKey || secretKey || password)
              ? {
                  sync: {
                    ...(token ? { gist: { token } } : {}),
                    ...(accessKey || secretKey ? { s3: { accessKey: accessKey ?? "", secretKey: secretKey ?? "" } } : {}),
                    ...(password ? { webdav: { password } } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
  };
}
