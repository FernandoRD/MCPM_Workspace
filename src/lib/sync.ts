/**
 * SSH Vault — Sincronização Remota
 *
 * Formato do pacote de sync (vault.json no provider):
 * {
 *   "app": "ssh-vault",
 *   "version": 1,
 *   "syncedAt": "ISO 8601",
 *   "hosts": [...],            // metadados dos hosts (sem senhas)
 *   "credentials": [...],      // metadados das credenciais (sem password/passphrase)
 *   "settings": { themeId, locale, terminal },
 *   "encryptedSecrets": {      // presente se syncCredentials=true
 *     "version": 1,
 *     "salt": "<base64>",
 *     "nonce": "<base64>",
 *     "ciphertext": "<base64>" // JSON cifrado de { credId: { password?, passphrase? } }
 *   }
 * }
 */

import { invoke } from "@tauri-apps/api/core";
import {
  AppSettings,
  Credential,
  EncryptedCredentials,
  HostEntry,
  SshKey,
} from "@/types";
import {
  buildPortableSettings,
  buildTransferSecretsPayload,
  hydrateCredentials,
  hydrateHosts,
  hydrateSshKeys,
  mergePortableSettings,
  PortableSyncSettings,
  sanitizeCredentials,
  sanitizeHosts,
  sanitizeSshKeys,
  TransferSecretsPayload,
} from "@/lib/portableState";
import {
  parseEncryptedCredentialsJson,
  parsePortableStateFile,
  parseTransferSecretsPayload,
} from "@/lib/portableStateSchema";
import { PortableStateSnapshot } from "@/lib/portableStatePersistence";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SyncFile {
  app: "ssh-vault";
  version: 1;
  syncedAt: string;
  hosts: HostEntry[];
  /** Tombstones de hosts removidos, por id -> ISO date */
  deletedHosts?: Record<string, string>;
  /** Credenciais sem segredos sensíveis */
  credentials: Credential[];
  /** Chaves SSH sem material privado */
  sshKeys: SshKey[];
  settings: PortableSyncSettings;
  /** Presente quando segredos foram exportados com criptografia (senha mestra) */
  encryptedSecrets?: EncryptedCredentials;
}

export interface SyncResult {
  hostsAdded: number;
  hostsUpdated: number;
  credentialsAdded: number;
  credentialsUpdated: number;
  sshKeysAdded: number;
  sshKeysUpdated: number;
}

const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDeletedHosts(
  deletedHosts: Record<string, string> | undefined,
  now = Date.now()
): Record<string, string> {
  const entries = Object.entries(deletedHosts ?? {}).filter(([id, deletedAt]) => {
    const deletedTs = timestamp(deletedAt);
    return Boolean(id) && deletedTs > 0 && now - deletedTs <= TOMBSTONE_RETENTION_MS;
  });

  return Object.fromEntries(entries);
}

function mergeDeletedHosts(
  localDeletedHosts: Record<string, string> | undefined,
  remoteDeletedHosts: Record<string, string> | undefined
): Record<string, string> {
  const merged = normalizeDeletedHosts(localDeletedHosts);
  for (const [id, deletedAt] of Object.entries(normalizeDeletedHosts(remoteDeletedHosts))) {
    if (timestamp(deletedAt) > timestamp(merged[id])) {
      merged[id] = deletedAt;
    }
  }
  return merged;
}

function shouldDeleteHost(host: HostEntry | undefined, deletedAt: string | undefined): boolean {
  if (!deletedAt) return false;
  if (!host) return true;
  return timestamp(deletedAt) >= timestamp(host.updatedAt || host.createdAt);
}

// ─── Build payload ────────────────────────────────────────────────────────────

/**
 * Serializa o estado local em um JSON para upload.
 * - Segredos (passwords, chaves privadas, TOTP, tokens de sync) são SEMPRE
 *   removidos das entidades em texto claro via sanitize*.
 * - Se masterPassword + settings.security.syncCredentials estiverem ativos,
 *   os segredos vão cifrados em `encryptedSecrets` (Argon2id + AES-256-GCM).
 * - Metadados de hosts, credenciais e chaves sempre viajam em texto claro.
 */
export async function buildSyncPayload(
  hosts: HostEntry[],
  credentials: Credential[],
  sshKeys: SshKey[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<string> {
  const cleanHosts = sanitizeHosts(hosts);
  const exportedCredentials = sanitizeCredentials(credentials);
  const exportedSshKeys = sanitizeSshKeys(sshKeys);
  const deletedHosts = normalizeDeletedHosts(settings.sync.deletedHosts);
  let encryptedSecrets: EncryptedCredentials | undefined;

  // Só cifra os segredos quando a flag syncCredentials está habilitada E uma
  // senha mestra foi fornecida. Verificar os dois garante que: (a) a função se
  // comporta corretamente independente do call site, e (b) nenhum segredo é
  // cifrado em push manual com syncCredentials=false.
  if (masterPassword && settings.security.syncCredentials) {
    const secretsPayload = buildTransferSecretsPayload(hosts, credentials, sshKeys, settings);
    if (secretsPayload) {
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: JSON.stringify(secretsPayload),
        masterPassword,
      });
      encryptedSecrets = parseEncryptedCredentialsJson(payloadJson, "encryptedSecrets");
    }
  }

  const file: SyncFile = {
    app: "ssh-vault",
    version: 1,
    syncedAt: new Date().toISOString(),
    hosts: cleanHosts,
    ...(Object.keys(deletedHosts).length > 0 ? { deletedHosts } : {}),
    credentials: exportedCredentials,
    sshKeys: exportedSshKeys,
    settings: buildPortableSettings(settings),
    ...(encryptedSecrets ? { encryptedSecrets } : {}),
  };

  return JSON.stringify(file);
}

// ─── Parse + apply payload ────────────────────────────────────────────────────

export function parseSyncFile(json: string): SyncFile {
  const file = parsePortableStateFile(json);
  if (!file.syncedAt) {
    throw new Error("Payload inválido: campo 'syncedAt' é obrigatório");
  }
  return {
    app: file.app,
    version: file.version,
    syncedAt: file.syncedAt,
    hosts: file.hosts,
    credentials: file.credentials,
    sshKeys: file.sshKeys,
    settings: file.settings,
    ...(file.deletedHosts ? { deletedHosts: file.deletedHosts } : {}),
    ...(file.encryptedSecrets ? { encryptedSecrets: file.encryptedSecrets } : {}),
  };
}

/**
 * Aplica um pacote remoto às stores locais.
 * Modo "merge": adiciona/atualiza sem remover o que está local.
 * Modo "replace": substitui tudo.
 *
 * Retorna um resumo das alterações.
 */
export async function applySyncPayload(
  file: SyncFile,
  masterPassword: string | null,
  mode: "merge" | "replace",
  currentHosts: HostEntry[],
  currentCredentials: Credential[],
  currentSshKeys: SshKey[],
  currentSettings: AppSettings,
  commitState: (snapshot: PortableStateSnapshot) => Promise<unknown>
): Promise<SyncResult> {
  let secretsPayload: TransferSecretsPayload = {};
  if (file.encryptedSecrets && masterPassword) {
    const credJson = await invoke<string>("decrypt_credentials", {
      encryptedPayloadJson: JSON.stringify(file.encryptedSecrets),
      masterPassword,
    });
    secretsPayload = parseTransferSecretsPayload(credJson);
  }

  const remoteHosts = hydrateHosts(file.hosts ?? [], secretsPayload.hosts, currentHosts);
  const remoteCredentials = hydrateCredentials(file.credentials ?? [], secretsPayload.credentials, currentCredentials);
  const remoteSshKeys = hydrateSshKeys(file.sshKeys ?? [], secretsPayload.sshKeys, currentSshKeys);
  const remoteDeletedHosts = normalizeDeletedHosts(file.deletedHosts ?? file.settings?.sync?.deletedHosts);
  const mergedDeletedHosts = mergeDeletedHosts(currentSettings.sync.deletedHosts, remoteDeletedHosts);

  let finalHosts: HostEntry[];
  let finalCredentials: Credential[];
  let finalSshKeys: SshKey[];
  let hostsAdded = 0;
  let hostsUpdated = 0;
  let credentialsAdded = 0;
  let credentialsUpdated = 0;
  let sshKeysAdded = 0;
  let sshKeysUpdated = 0;

  if (mode === "replace") {
    finalHosts = remoteHosts;
    finalCredentials = remoteCredentials;
    finalSshKeys = remoteSshKeys;
    hostsAdded = remoteHosts.length;
    credentialsAdded = remoteCredentials.length;
    sshKeysAdded = remoteSshKeys.length;
  } else {
    const localHostsById = new Map(currentHosts.map((h) => [h.id, h]));
    for (const remoteHost of remoteHosts) {
      const deletedAt = mergedDeletedHosts[remoteHost.id];
      if (shouldDeleteHost(remoteHost, deletedAt)) {
        localHostsById.delete(remoteHost.id);
        continue;
      }

      if (localHostsById.has(remoteHost.id)) {
        hostsUpdated++;
      } else {
        hostsAdded++;
      }
      localHostsById.set(remoteHost.id, remoteHost);
    }
    for (const [hostId, deletedAt] of Object.entries(mergedDeletedHosts)) {
      const host = localHostsById.get(hostId);
      if (shouldDeleteHost(host, deletedAt)) {
        localHostsById.delete(hostId);
      } else {
        delete mergedDeletedHosts[hostId];
      }
    }
    finalHosts = Array.from(localHostsById.values());

    const localCredsById = new Map(currentCredentials.map((c) => [c.id, c]));
    for (const remoteCred of remoteCredentials) {
      if (localCredsById.has(remoteCred.id)) {
        credentialsUpdated++;
      } else {
        credentialsAdded++;
      }
      localCredsById.set(remoteCred.id, remoteCred);
    }
    finalCredentials = Array.from(localCredsById.values());

    const localKeysById = new Map(currentSshKeys.map((sshKey) => [sshKey.id, sshKey]));
    for (const remoteSshKey of remoteSshKeys) {
      if (localKeysById.has(remoteSshKey.id)) {
        sshKeysUpdated++;
      } else {
        sshKeysAdded++;
      }
      localKeysById.set(remoteSshKey.id, remoteSshKey);
    }
    finalSshKeys = Array.from(localKeysById.values());
  }

  const nextSettings = mergePortableSettings(currentSettings, file.settings, secretsPayload.settings);
  await commitState({
    hosts: finalHosts,
    credentials: finalCredentials,
    sshKeys: finalSshKeys,
    settings: {
      ...nextSettings,
      sync: {
        ...nextSettings.sync,
        deletedHosts: mergedDeletedHosts,
        lastSyncAt: new Date().toISOString(),
      },
    },
  });

  return {
    hostsAdded,
    hostsUpdated,
    credentialsAdded,
    credentialsUpdated,
    sshKeysAdded,
    sshKeysUpdated,
  };
}
