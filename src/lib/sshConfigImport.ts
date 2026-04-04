import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { Credential, SshHost, SshKey } from "@/types";

interface ImportedSshConfigHost {
  alias: string;
  host: string;
  port: number;
  username?: string | null;
  proxy_jump?: string | null;
  identity_file_path?: string | null;
  identity_file_content?: string | null;
  public_key_content?: string | null;
  source_path: string;
}

export interface SshConfigImportPreview {
  hosts: SshHost[];
  credentials: Credential[];
  sshKeys: SshKey[];
  importedCount: number;
  skippedCount: number;
  sourcePath: string | null;
}

function normalizeJumpAlias(raw?: string | null): string | null {
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;
  const withoutUser = first.includes("@") ? first.split("@").pop() ?? first : first;
  return withoutUser.split(":")[0]?.trim() || null;
}

function hostDuplicateKey(host: Pick<SshHost, "label" | "host" | "port" | "username">): string {
  return [
    host.label.trim().toLowerCase(),
    host.host.trim().toLowerCase(),
    String(host.port),
    (host.username ?? "").trim().toLowerCase(),
  ].join("|");
}

function credentialDuplicateKey(credential: Pick<Credential, "label" | "username" | "authMethod" | "keyId">): string {
  return [
    credential.label.trim().toLowerCase(),
    credential.username.trim().toLowerCase(),
    credential.authMethod,
    credential.keyId ?? "",
  ].join("|");
}

function sshKeyDuplicateKey(sshKey: Pick<SshKey, "label" | "publicKeyContent">): string {
  return [
    sshKey.label.trim().toLowerCase(),
    (sshKey.publicKeyContent ?? "").trim(),
  ].join("|");
}

export async function loadSshConfigPreview(
  currentHosts: SshHost[],
  currentCredentials: Credential[],
  currentSshKeys: SshKey[]
): Promise<SshConfigImportPreview> {
  const entries = await invoke<ImportedSshConfigHost[]>("ssh_import_config");
  const now = new Date().toISOString();
  const existingHostKeys = new Set(currentHosts.map((host) => hostDuplicateKey(host)));
  const existingCredentialKeys = new Set(
    currentCredentials.map((credential) => credentialDuplicateKey(credential))
  );
  const existingSshKeyKeys = new Set(currentSshKeys.map((sshKey) => sshKeyDuplicateKey(sshKey)));

  const importedHosts: SshHost[] = [];
  const importedCredentials: Credential[] = [];
  const importedSshKeys: SshKey[] = [];
  const jumpAliasByHostId = new Map<string, string>();
  let skippedCount = 0;
  let sourcePath: string | null = null;

  for (const entry of entries) {
    sourcePath = sourcePath ?? entry.source_path ?? null;
    const username = entry.username?.trim() || undefined;
    const hostKey = hostDuplicateKey({
      label: entry.alias,
      host: entry.host,
      port: entry.port || 22,
      username,
    });

    if (existingHostKeys.has(hostKey)) {
      skippedCount += 1;
      continue;
    }

    let credentialId: string | undefined;
    let authMethod: SshHost["authMethod"] = "agent";

    if (entry.identity_file_content?.trim()) {
      const sshKey: SshKey = {
        id: uuidv4(),
        label: `${entry.alias} key`,
        privateKeyContent: entry.identity_file_content.trim(),
        publicKeyContent: entry.public_key_content?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      const sshKeyKey = sshKeyDuplicateKey(sshKey);
      if (!existingSshKeyKeys.has(sshKeyKey)) {
        importedSshKeys.push(sshKey);
        existingSshKeyKeys.add(sshKeyKey);
      }
      const effectiveKeyId =
        importedSshKeys.find((candidate) => sshKeyDuplicateKey(candidate) === sshKeyKey)?.id ??
        currentSshKeys.find((candidate) => sshKeyDuplicateKey(candidate) === sshKeyKey)?.id;

      const credential: Credential = {
        id: uuidv4(),
        label: `${entry.alias} credential`,
        username: username ?? "",
        authMethod: "privateKey",
        keyId: effectiveKeyId,
        createdAt: now,
        updatedAt: now,
      };
      const credentialKey = credentialDuplicateKey(credential);
      if (!existingCredentialKeys.has(credentialKey)) {
        importedCredentials.push(credential);
        existingCredentialKeys.add(credentialKey);
      }
      credentialId =
        importedCredentials.find((candidate) => credentialDuplicateKey(candidate) === credentialKey)?.id ??
        currentCredentials.find((candidate) => credentialDuplicateKey(candidate) === credentialKey)?.id;
      authMethod = "privateKey";
    } else if (username) {
      const credential: Credential = {
        id: uuidv4(),
        label: `${entry.alias} credential`,
        username,
        authMethod: "agent",
        createdAt: now,
        updatedAt: now,
      };
      const credentialKey = credentialDuplicateKey(credential);
      if (!existingCredentialKeys.has(credentialKey)) {
        importedCredentials.push(credential);
        existingCredentialKeys.add(credentialKey);
      }
      credentialId =
        importedCredentials.find((candidate) => credentialDuplicateKey(candidate) === credentialKey)?.id ??
        currentCredentials.find((candidate) => credentialDuplicateKey(candidate) === credentialKey)?.id;
    }

    const host: SshHost = {
      id: uuidv4(),
      label: entry.alias,
      host: entry.host,
      port: entry.port || 22,
      username,
      credentialId,
      authMethod,
      tags: ["ssh-config"],
      notes: `Importado de ${entry.source_path}`,
      createdAt: now,
      updatedAt: now,
      sshCompat: { preset: "modern" },
    };

    importedHosts.push(host);
    existingHostKeys.add(hostKey);

    const jumpAlias = normalizeJumpAlias(entry.proxy_jump);
    if (jumpAlias) {
      jumpAliasByHostId.set(host.id, jumpAlias);
    }
  }

  const aliasToHostId = new Map(
    importedHosts.map((host) => [host.label.trim().toLowerCase(), host.id])
  );

  for (const host of importedHosts) {
    const jumpAlias = jumpAliasByHostId.get(host.id);
    if (!jumpAlias) continue;
    const jumpHostId = aliasToHostId.get(jumpAlias.toLowerCase());
    if (jumpHostId) {
      host.jumpHostId = jumpHostId;
    }
  }

  return {
    hosts: importedHosts,
    credentials: importedCredentials,
    sshKeys: importedSshKeys,
    importedCount: importedHosts.length,
    skippedCount,
    sourcePath,
  };
}

export interface SshProbeResult {
  reachable: boolean;
  latency_ms?: number | null;
  error?: string | null;
}

export async function probeSshHost(host: string, port: number): Promise<SshProbeResult> {
  return invoke<SshProbeResult>("ssh_probe_host", {
    host,
    port,
    timeoutMs: 4000,
  });
}
