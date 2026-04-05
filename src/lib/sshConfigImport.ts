import { invoke } from "@tauri-apps/api/core";

export interface SshConfigImportPreviewHost {
  alias: string;
  host: string;
  port: number;
  username?: string | null;
  auth_method: "privateKey" | "agent";
  has_jump_host: boolean;
}

export interface SshConfigImportPreview {
  hosts: SshConfigImportPreviewHost[];
  imported_count: number;
  skipped_count: number;
  credentials_count: number;
  ssh_keys_count: number;
  source_path: string | null;
}

export interface SshConfigImportResult {
  imported_count: number;
  skipped_count: number;
  credentials_count: number;
  ssh_keys_count: number;
  source_path: string | null;
}

export async function loadSshConfigPreview(): Promise<SshConfigImportPreview> {
  return invoke<SshConfigImportPreview>("ssh_import_config");
}

export async function importSshConfigToVault(): Promise<SshConfigImportResult> {
  return invoke<SshConfigImportResult>("ssh_apply_imported_config");
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
