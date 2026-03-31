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
} from "@/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface SyncFile {
  app: "ssh-vault";
  version: 1;
  syncedAt: string;
  hosts: SshHost[];
  /** Credenciais — incluem password/passphrase em texto claro quando não há criptografia */
  credentials: Credential[];
  settings: {
    themeId: string;
    locale: string;
    terminal: AppSettings["terminal"];
  };
  /** Presente quando as senhas foram exportadas com criptografia (senha mestra) */
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
 * - Sem senha mestra: credenciais incluem password/passphrase em texto claro.
 * - Com senha mestra: credenciais vão sem segredos + `encryptedSecrets` cifrado.
 */
export async function buildSyncPayload(
  hosts: SshHost[],
  credentials: Credential[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<string> {
  // Strip de campos sensíveis dos hosts (senhas de hosts ficam no sistema de credenciais)
  const cleanHosts = hosts.map(
    ({ passwordRef: _p, ...rest }) => rest as SshHost
  );

  let exportedCredentials: Credential[];
  let encryptedSecrets: EncryptedCredentials | undefined;

  if (masterPassword) {
    // Com senha mestra: exporta credenciais sem segredos + segredos cifrados à parte
    exportedCredentials = credentials.map(
      ({ password: _p, ...rest }) => rest as Credential
    );
    const secretsMap: SecretsMap = {};
    for (const cred of credentials) {
      const entry: SecretsMap[string] = {};
      if (cred.password) entry.password = cred.password;
      if (Object.keys(entry).length > 0) secretsMap[cred.id] = entry;
    }
    if (Object.keys(secretsMap).length > 0) {
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: JSON.stringify(secretsMap),
        masterPassword,
      });
      encryptedSecrets = JSON.parse(payloadJson) as EncryptedCredentials;
    }
  } else {
    // Sem senha mestra: inclui senhas em texto claro (Gist/S3 privado do próprio usuário)
    exportedCredentials = credentials;
  }

  const file: SyncFile = {
    app: "ssh-vault",
    version: 1,
    syncedAt: new Date().toISOString(),
    hosts: cleanHosts,
    credentials: exportedCredentials,
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
    // No replace, ainda preserva segredos locais se o remoto não os trouxe
    const localCredsMapReplace = new Map(currentCredentials.map((c) => [c.id, c]));
    finalCredentials = remoteCredentials.map((rc) => {
      const local = localCredsMapReplace.get(rc.id);
      if (!local) return rc;
      return {
        ...rc,
        password: rc.password ?? local.password,
      };
    });
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
      const localCred = localCredsById.get(remoteCred.id);
      if (localCred) {
        credentialsUpdated++;
        // Preserva os segredos locais se o remoto não os trouxe (sync sem senha mestra)
        localCredsById.set(remoteCred.id, {
          ...remoteCred,
          password: remoteCred.password ?? localCred.password,
        });
      } else {
        credentialsAdded++;
        localCredsById.set(remoteCred.id, remoteCred);
      }
    }
    finalCredentials = Array.from(localCredsById.values());
  }

  replaceHosts(finalHosts);
  replaceCredentials(finalCredentials);

  return { hostsAdded, hostsUpdated, credentialsAdded, credentialsUpdated };
}
