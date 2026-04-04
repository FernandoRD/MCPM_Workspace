import { invoke } from "@tauri-apps/api/core";

export interface KnownHostEntry {
  host_key: string;
  fingerprint: string;
}

export interface HealthCheckResult {
  reachable: boolean;
  latency_ms?: number | null;
  error?: string | null;
  host_key: string;
  fingerprint?: string | null;
  stored_fingerprint?: string | null;
  fingerprint_status:
    | "match"
    | "mismatch"
    | "new"
    | "stored-only"
    | "unknown"
    | "unreachable";
}

export async function listKnownHosts(): Promise<KnownHostEntry[]> {
  return invoke<KnownHostEntry[]>("ssh_list_known_hosts");
}

export async function runHealthCheck(
  host: string,
  port: number,
  sshCompatPreset?: string
): Promise<HealthCheckResult> {
  return invoke<HealthCheckResult>("ssh_health_check", {
    host,
    port,
    timeoutMs: 4000,
    sshCompatPreset: sshCompatPreset ?? null,
  });
}

export function formatHostKey(host: string, port: number): string {
  return `[${host}]:${port}`;
}
