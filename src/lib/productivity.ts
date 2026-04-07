import { invoke } from "@tauri-apps/api/core";
import { resolveSshKeySecrets } from "@/lib/secrets";
import {
  AppSettings,
  CommandSnippet,
  TunnelProfile,
  Credential,
  HostEntry,
  SshKey,
} from "@/types";

export interface RemoteExecResult {
  stdout: string;
  stderr: string;
  exit_status: number;
  duration_ms: number;
}

export function isSshHost(host: HostEntry): boolean {
  return host.protocol === "ssh";
}

export function supportsSftp(host: HostEntry): boolean {
  return isSshHost(host);
}

export function supportsRemoteExec(host: HostEntry): boolean {
  return isSshHost(host);
}

export function supportsTunnels(host: HostEntry): boolean {
  return isSshHost(host);
}

function resolveUsername(host: HostEntry, credential?: Credential): string {
  return credential?.username ?? host.username ?? "";
}

export function formatHostAddress(host: HostEntry, credential?: Credential): string {
  const username = resolveUsername(host, credential);
  if (!isSshHost(host)) return host.host;
  return username ? `${username}@${host.host}` : host.host;
}

export function getSnippetScopeLabel(
  snippet: CommandSnippet,
  hostNameResolver?: (id: string) => string | undefined,
  labels?: { host?: string; group?: string; global?: string }
): string {
  if (snippet.scopeType === "host") {
    return hostNameResolver?.(snippet.scopeValue ?? "") ?? labels?.host ?? "Host específico";
  }
  if (snippet.scopeType === "group") {
    return snippet.scopeValue ?? labels?.group ?? "Grupo";
  }
  return labels?.global ?? "Global";
}

export function getAvailableSnippets(
  snippets: CommandSnippet[],
  host: HostEntry
): CommandSnippet[] {
  if (!supportsRemoteExec(host)) return [];
  return snippets
    .filter((snippet) => {
      if (snippet.scopeType === "global") return true;
      if (snippet.scopeType === "host") return snippet.scopeValue === host.id;
      if (snippet.scopeType === "group") return !!host.group && snippet.scopeValue === host.group;
      return false;
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function renderSnippetCommand(
  snippet: CommandSnippet,
  host: HostEntry,
  credential?: Credential,
  cwd = "~"
): string {
  const username = resolveUsername(host, credential);
  const replacements: Record<string, string> = {
    host: host.host,
    user: username,
    port: String(host.port),
    cwd,
    label: host.label,
    group: host.group ?? "",
  };

  return snippet.command.replace(/\$\{(host|user|port|cwd|label|group)\}/g, (_, key: string) => {
    return replacements[key] ?? "";
  });
}

export async function runRemoteCommand(params: {
  host: HostEntry;
  hostId: string;
  snippetId: string;
  cwd?: string;
}): Promise<RemoteExecResult> {
  const { host, hostId, snippetId, cwd } = params;
  if (!supportsRemoteExec(host)) {
    throw new Error(`Execução remota ainda não está disponível para o protocolo ${host.protocol.toUpperCase()}.`);
  }
  return invoke<RemoteExecResult>("ssh_exec", {
    hostId,
    snippetId,
    cwd: cwd ?? "~",
  });
}

export async function startTunnel(params: {
  profile: TunnelProfile;
  host: HostEntry;
  credential?: Credential;
  sshKey?: SshKey;
  sshSettings: AppSettings["ssh"];
}): Promise<void> {
  const { profile, host, credential, sshKey, sshSettings } = params;
  if (!supportsTunnels(host)) {
    throw new Error(`Túneis ainda não estão disponíveis para o protocolo ${host.protocol.toUpperCase()}.`);
  }
  const resolvedSshKey = await resolveSshKeySecrets(sshKey);
  const username = resolveUsername(host, credential);
  const authMethod = credential?.authMethod ?? host.authMethod;
  const password = credential?.password ?? host.passwordRef ?? null;

  await invoke("ssh_start_tunnel", {
    tunnelId: profile.id,
    host: host.host,
    port: host.port,
    username,
    authMethod,
    password,
    privateKeyContent: resolvedSshKey?.privateKeyContent ?? null,
    privateKeyPassphrase: resolvedSshKey?.passphrase ?? null,
    sshCompatPreset: host.sshCompat?.preset ?? "modern",
    keepaliveInterval: host.keepAliveInterval ?? sshSettings.keepAliveInterval,
    connectionTimeout: host.connectionTimeout ?? sshSettings.inactivityTimeout,
    spec: {
      kind: profile.kind,
      bindAddress: profile.bindAddress,
      bindPort: profile.bindPort,
      destinationHost: profile.destinationHost,
      destinationPort: profile.destinationPort,
      localHost: profile.localHost,
      localPort: profile.localPort,
    },
  });
}

export async function stopTunnel(profileId: string): Promise<void> {
  await invoke("ssh_stop_tunnel", { tunnelId: profileId });
}

export function createEmptySnippet(): Omit<CommandSnippet, "id" | "createdAt" | "updatedAt"> {
  return {
    label: "",
    command: "",
    description: "",
    scopeType: "global",
    scopeValue: undefined,
    tags: [],
  };
}

export function createEmptyTunnelProfile(hostId = ""): Omit<TunnelProfile, "id" | "createdAt" | "updatedAt"> {
  return {
    label: "",
    hostId,
    kind: "local",
    bindAddress: "127.0.0.1",
    bindPort: 0,
    destinationHost: "127.0.0.1",
    destinationPort: 0,
    localHost: "127.0.0.1",
    localPort: 0,
    autoStart: false,
  };
}
