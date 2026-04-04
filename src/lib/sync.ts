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
  SshHost,
  AppSettings,
  Credential,
  EncryptedCredentials,
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SyncFile {
  app: "ssh-vault";
  version: 1;
  syncedAt: string;
  hosts: SshHost[];
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

// ─── Build payload ────────────────────────────────────────────────────────────

/**
 * Serializa o estado local em um JSON para upload.
 * - Sem senha mestra: credenciais incluem password/passphrase em texto claro.
 * - Com senha mestra: credenciais vão sem segredos + `encryptedSecrets` cifrado.
 */
export async function buildSyncPayload(
  hosts: SshHost[],
  credentials: Credential[],
  sshKeys: SshKey[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<string> {
  const cleanHosts = sanitizeHosts(hosts);
  const exportedCredentials = sanitizeCredentials(credentials);
  const exportedSshKeys = sanitizeSshKeys(sshKeys);
  let encryptedSecrets: EncryptedCredentials | undefined;

  if (masterPassword) {
    const secretsPayload = buildTransferSecretsPayload(hosts, credentials, sshKeys, settings);
    if (secretsPayload) {
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: JSON.stringify(secretsPayload),
        masterPassword,
      });
      encryptedSecrets = JSON.parse(payloadJson) as EncryptedCredentials;
    }
  }

  const file: SyncFile = {
    app: "ssh-vault",
    version: 1,
    syncedAt: new Date().toISOString(),
    hosts: cleanHosts,
    credentials: exportedCredentials,
    sshKeys: exportedSshKeys,
    settings: buildPortableSettings(settings),
    ...(encryptedSecrets ? { encryptedSecrets } : {}),
  };

  return JSON.stringify(file);
}

// ─── Parse + apply payload ────────────────────────────────────────────────────

export function parseSyncFile(json: string): SyncFile {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Payload inválido: não é um JSON válido");
  }

  const obj = data as Record<string, unknown>;
  if (obj["app"] !== "ssh-vault") {
    throw new Error("Payload inválido: campo 'app' incorreto");
  }

  return obj as unknown as SyncFile;
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
  currentHosts: SshHost[],
  currentCredentials: Credential[],
  currentSshKeys: SshKey[],
  currentSettings: AppSettings,
  replaceHosts: (hosts: SshHost[]) => void,
  replaceCredentials: (credentials: Credential[]) => void,
  replaceSshKeys: (sshKeys: SshKey[]) => void,
  replaceSettings: (settings: AppSettings) => void
): Promise<SyncResult> {
  let secretsPayload: TransferSecretsPayload = {};
  if (file.encryptedSecrets && masterPassword) {
    const credJson = await invoke<string>("decrypt_credentials", {
      encryptedPayloadJson: JSON.stringify(file.encryptedSecrets),
      masterPassword,
    });
    secretsPayload = JSON.parse(credJson) as TransferSecretsPayload;
  }

  const remoteHosts = hydrateHosts(file.hosts ?? [], secretsPayload.hosts, currentHosts);
  const remoteCredentials = hydrateCredentials(file.credentials ?? [], secretsPayload.credentials, currentCredentials);
  const remoteSshKeys = hydrateSshKeys(file.sshKeys ?? [], secretsPayload.sshKeys, currentSshKeys);

  let finalHosts: SshHost[];
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
      if (localHostsById.has(remoteHost.id)) {
        hostsUpdated++;
      } else {
        hostsAdded++;
      }
      localHostsById.set(remoteHost.id, remoteHost);
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

  replaceHosts(finalHosts);
  replaceCredentials(finalCredentials);
  replaceSshKeys(finalSshKeys);
  replaceSettings(mergePortableSettings(currentSettings, file.settings, secretsPayload.settings));

  return {
    hostsAdded,
    hostsUpdated,
    credentialsAdded,
    credentialsUpdated,
    sshKeysAdded,
    sshKeysUpdated,
  };
}
