/**
 * SSH Vault — Backup / Restore
 *
 * Formato do arquivo (.sshvault):
 * {
 *   "app": "ssh-vault",
 *   "version": 1,
 *   "exportedAt": "ISO 8601",
 *   "hosts": [...],           // metadados em claro
 *   "settings": {...},        // tema, idioma, terminal (sem secrets de sync)
 *   "encryptedCredentials": { // presente só se syncCredentials=true + senha mestra
 *     "version": 1,
 *     "salt": "<base64>",
 *     "nonce": "<base64>",
 *     "ciphertext": "<base64>"  // JSON cifrado de { hostId -> password/key }
 *   }
 * }
 */

import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";
import { SshHost, AppSettings, EncryptedCredentials } from "@/types";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface BackupFile {
  app: "ssh-vault";
  version: 1;
  exportedAt: string;
  hosts: SshHost[];
  settings: BackupSettings;
  encryptedCredentials?: EncryptedCredentials;
}

/** Subconjunto seguro de settings para incluir no backup */
export interface BackupSettings {
  themeId: string;
  locale: string;
  terminal: AppSettings["terminal"];
}

/** Mapa de credenciais plaintext — nunca sai sem cifrar */
export interface CredentialsMap {
  [hostId: string]: {
    password?: string;
    passphrase?: string;
    privateKeyPath?: string;
    totpSecret?: string;
  };
}

export interface ImportResult {
  backup: BackupFile;
  credentials: CredentialsMap | null;
  hasEncryptedCredentials: boolean;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Exporta o backup para um arquivo .sshvault escolhido pelo usuário.
 * Se `masterPassword` for fornecida, cifra as credenciais de cada host.
 */
export async function exportBackup(
  hosts: SshHost[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<void> {
  // Montar as settings sem dados sensíveis de sync
  const backupSettings: BackupSettings = {
    themeId: settings.themeId,
    locale: settings.locale,
    terminal: settings.terminal,
  };

  // Limpar campos de senha dos hosts para o JSON em claro
  const cleanHosts = hosts.map(({ passwordRef: _p, ...rest }) => rest as SshHost);

  let encryptedCredentials: EncryptedCredentials | undefined;

  if (masterPassword) {
    // Construir mapa de credenciais plaintext
    const credMap: CredentialsMap = {};
    for (const host of hosts) {
      const entry: CredentialsMap[string] = {};
      if (host.passwordRef) entry.password = host.passwordRef;
      if (host.totpSecret) entry.totpSecret = host.totpSecret;
      if (Object.keys(entry).length > 0) credMap[host.id] = entry;
    }

    if (Object.keys(credMap).length > 0) {
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: JSON.stringify(credMap),
        masterPassword,
      });
      encryptedCredentials = JSON.parse(payloadJson) as EncryptedCredentials;
    }
  }

  const backup: BackupFile = {
    app: "ssh-vault",
    version: 1,
    exportedAt: new Date().toISOString(),
    hosts: cleanHosts,
    settings: backupSettings,
    ...(encryptedCredentials ? { encryptedCredentials } : {}),
  };

  // Abrir diálogo de salvar
  const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = await save({
    title: "Salvar backup do SSH Vault",
    defaultPath: `ssh-vault-backup-${now}.sshvault`,
    filters: [
      { name: "SSH Vault Backup", extensions: ["sshvault"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });

  if (!filePath) return; // usuário cancelou

  await writeTextFile(filePath, JSON.stringify(backup, null, 2));
}

// ─── Import ───────────────────────────────────────────────────────────────────

/**
 * Abre um arquivo .sshvault e retorna o conteúdo.
 * Não aplica nada ainda — retorna para o chamador decidir.
 * Se há credenciais cifradas e `masterPassword` for fornecida, decifra.
 */
export async function importBackup(
  masterPassword: string | null
): Promise<ImportResult | null> {
  const filePath = await open({
    title: "Abrir backup do SSH Vault",
    multiple: false,
    filters: [
      { name: "SSH Vault Backup", extensions: ["sshvault", "json"] },
    ],
  });

  if (!filePath || Array.isArray(filePath)) return null;

  const raw = await readTextFile(filePath as string);
  const backup = parseBackupFile(raw);

  if (backup.encryptedCredentials && masterPassword) {
    const credJson = await invoke<string>("decrypt_credentials", {
      encryptedPayloadJson: JSON.stringify(backup.encryptedCredentials),
      masterPassword,
    });
    const credentials = JSON.parse(credJson) as CredentialsMap;
    return { backup, credentials, hasEncryptedCredentials: true };
  }

  return {
    backup,
    credentials: null,
    hasEncryptedCredentials: !!backup.encryptedCredentials,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseBackupFile(raw: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Arquivo inválido: não é um JSON válido");
  }

  if (!data || typeof data !== "object") {
    throw new Error("Arquivo inválido: estrutura inesperada");
  }

  const obj = data as Record<string, unknown>;

  if (obj["app"] !== "ssh-vault") {
    throw new Error("Arquivo inválido: não é um backup do SSH Vault");
  }
  if (obj["version"] !== 1) {
    throw new Error(`Versão de backup não suportada: ${obj["version"]}`);
  }
  if (!Array.isArray(obj["hosts"])) {
    throw new Error("Arquivo inválido: campo 'hosts' ausente ou inválido");
  }

  return obj as unknown as BackupFile;
}

/** Aplica as credenciais decifradas de volta nos hosts */
export function mergeCredentials(
  hosts: SshHost[],
  credentials: CredentialsMap
): SshHost[] {
  return hosts.map((host) => {
    const cred = credentials[host.id];
    if (!cred) return host;
    return {
      ...host,
      ...(cred.password ? { passwordRef: cred.password } : {}),
      ...(cred.totpSecret ? { totpSecret: cred.totpSecret } : {}),
    };
  });
}
