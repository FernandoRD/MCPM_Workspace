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
  CredentialMeta,
  EncryptedCredentials,
} from "@/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SyncFile {
  app: "ssh-vault";
  version: 1;
  syncedAt: string;
  hosts: SshHost[];
  credentials: CredentialMeta[];
  settings: {
    themeId: string;
    locale: string;
    terminal: AppSettings["terminal"];
  };
  encryptedSecrets?: EncryptedCredentials;
}

/** Mapa de segredos que vai cifrado — { credId: { password?, passphrase? } } */
interface SecretsMap {
  [credId: string]: {
    password?: string;
    passphrase?: string;
  };
}

export interface SyncResult {
  hostsAdded: number;
  hostsUpdated: number;
  credentialsAdded: number;
  credentialsUpdated: number;
}

// ─── Build payload ────────────────────────────────────────────────────────────

/**
 * Serializa o estado local em um JSON para upload.
 * Se `masterPassword` for fornecida, os segredos são cifrados.
 */
export async function buildSyncPayload(
  hosts: SshHost[],
  credentials: Credential[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<string> {
  // Strip de campos sensíveis dos hosts
  const cleanHosts = hosts.map(
    ({ passwordRef: _p, passphrase: _pp, ...rest }) => rest as SshHost
  );

  // Metadata das credenciais (sem password/passphrase)
  const credMeta: CredentialMeta[] = credentials.map(
    ({ password: _p, passphrase: _pp, ...rest }) => rest
  );

  let encryptedSecrets: EncryptedCredentials | undefined;

  if (masterPassword) {
    const secretsMap: SecretsMap = {};
    for (const cred of credentials) {
      const entry: SecretsMap[string] = {};
      if (cred.password) entry.password = cred.password;
      if (cred.passphrase) entry.passphrase = cred.passphrase;
      if (Object.keys(entry).length > 0) secretsMap[cred.id] = entry;
    }
    if (Object.keys(secretsMap).length > 0) {
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: JSON.stringify(secretsMap),
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
    credentials: credMeta,
    settings: {
      themeId: settings.themeId,
      locale: settings.locale,
      terminal: settings.terminal,
    },
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
  replaceHosts: (hosts: SshHost[]) => void,
  replaceCredentials: (credentials: Credential[]) => void
): Promise<SyncResult> {
  // Decifra segredos se disponível
  let secretsMap: SecretsMap = {};
  if (file.encryptedSecrets && masterPassword) {
    const credJson = await invoke<string>("decrypt_credentials", {
      encryptedPayloadJson: JSON.stringify(file.encryptedSecrets),
      masterPassword,
    });
    secretsMap = JSON.parse(credJson) as SecretsMap;
  }

  // Reconstitui credenciais com segredos decifrados
  const remoteCredentials: Credential[] = (file.credentials ?? []).map((meta) => {
    const secrets = secretsMap[meta.id] ?? {};
    return { ...meta, ...secrets } as Credential;
  });

  let finalHosts: SshHost[];
  let finalCredentials: Credential[];
  let hostsAdded = 0;
  let hostsUpdated = 0;
  let credentialsAdded = 0;
  let credentialsUpdated = 0;

  if (mode === "replace") {
    finalHosts = file.hosts;
    finalCredentials = remoteCredentials;
    hostsAdded = file.hosts.length;
    credentialsAdded = remoteCredentials.length;
  } else {
    // Merge: remote sobrescreve local por ID, novos são adicionados
    const localHostsById = new Map(currentHosts.map((h) => [h.id, h]));
    for (const remoteHost of file.hosts) {
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
  }

  replaceHosts(finalHosts);
  replaceCredentials(finalCredentials);

  return { hostsAdded, hostsUpdated, credentialsAdded, credentialsUpdated };
}
