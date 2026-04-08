/**
 * MPCM Workspace — Backup / Restore
 *
 * Formato do arquivo (.sshvault):
 * {
 *   "app": "ssh-vault",
 *   "version": 1,
 *   "exportedAt": "ISO 8601",
 *   "hosts": [...],           // metadados em claro
 *   "credentials": [...],     // credenciais sem senha
 *   "sshKeys": [...],         // chaves SSH sem material privado
 *   "settings": {...},        // configurações portáveis da aplicação
 *   "encryptedCredentials": { // presente quando dados sensíveis são exportados com senha mestra
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
import { HostEntry, AppSettings, EncryptedCredentials, Credential, SshKey } from "@/types";
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

export interface BackupFile {
  app: "ssh-vault";
  version: 1;
  exportedAt: string;
  hosts: HostEntry[];
  credentials: Credential[];
  sshKeys: SshKey[];
  settings: BackupSettings;
  encryptedCredentials?: EncryptedCredentials;
}

export type BackupSettings = PortableSyncSettings;

export interface ImportResult {
  backup: BackupFile;
  secrets: TransferSecretsPayload | null;
  hasEncryptedCredentials: boolean;
}

// ─── Export ───────────────────────────────────────────────────────────────────

/**
 * Exporta o backup para um arquivo .sshvault escolhido pelo usuário.
 * Se `masterPassword` for fornecida, cifra as credenciais de cada host.
 */
export async function exportBackup(
  hosts: HostEntry[],
  credentials: Credential[],
  sshKeys: SshKey[],
  settings: AppSettings,
  masterPassword: string | null
): Promise<void> {
  const backupSettings = buildPortableSettings(settings);
  const cleanHosts = sanitizeHosts(hosts);
  const exportedCredentials = sanitizeCredentials(credentials);
  const exportedSshKeys = sanitizeSshKeys(sshKeys);

  let encryptedCredentials: EncryptedCredentials | undefined;

  if (masterPassword) {
    const secretsPayload = buildTransferSecretsPayload(hosts, credentials, sshKeys, settings);
    if (secretsPayload) {
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: JSON.stringify(secretsPayload),
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
    credentials: exportedCredentials,
    sshKeys: exportedSshKeys,
    settings: backupSettings,
    ...(encryptedCredentials ? { encryptedCredentials } : {}),
  };

  // Abrir diálogo de salvar
  const now = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const filePath = await save({
    title: "Salvar backup do MPCM Workspace",
    defaultPath: `mpcm-workspace-backup-${now}.sshvault`,
    filters: [
      { name: "MPCM Workspace Backup", extensions: ["sshvault"] },
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
    title: "Abrir backup do MPCM Workspace",
    multiple: false,
    filters: [
      { name: "MPCM Workspace Backup", extensions: ["sshvault", "json"] },
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
    const secrets = JSON.parse(credJson) as TransferSecretsPayload;
    return { backup, secrets, hasEncryptedCredentials: true };
  }

  return {
    backup,
    secrets: null,
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
    throw new Error("Arquivo inválido: não é um backup do MPCM Workspace");
  }
  if (obj["version"] !== 1) {
    throw new Error(`Versão de backup não suportada: ${obj["version"]}`);
  }
  if (!Array.isArray(obj["hosts"])) {
    throw new Error("Arquivo inválido: campo 'hosts' ausente ou inválido");
  }

  return obj as unknown as BackupFile;
}

export function hydrateBackupData(
  backup: BackupFile,
  secrets: TransferSecretsPayload | null
): {
  hosts: HostEntry[];
  credentials: Credential[];
  sshKeys: SshKey[];
  settings: AppSettings | null;
} {
  return {
    hosts: hydrateHosts(backup.hosts ?? [], secrets?.hosts),
    credentials: hydrateCredentials(backup.credentials ?? [], secrets?.credentials),
    sshKeys: hydrateSshKeys(backup.sshKeys ?? [], secrets?.sshKeys),
    settings: backup.settings
      ? mergePortableSettings(
          {
            themeId: backup.settings.themeId,
            locale: backup.settings.locale,
            terminal: backup.settings.terminal,
            ssh: backup.settings.ssh,
            rdp: backup.settings.rdp ?? {
              linuxClient: "auto",
              fullscreen: false,
              dynamicResolution: true,
              width: 1600,
              height: 900,
              multimon: false,
              clipboard: true,
              audioMode: "redirect",
              certificateMode: "ignore",
            },
            security: {
              masterPasswordSet: false,
              syncCredentials: backup.settings.security.syncCredentials,
            },
            sync: {
              provider: null,
              autoSync: false,
              autoSyncIntervalMinutes: 30,
            },
            groups: backup.settings.groups,
            productivity: backup.settings.productivity,
          } as AppSettings,
          backup.settings,
          secrets?.settings
        )
      : null,
  };
}
