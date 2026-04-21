import {
  AppSettings,
  ConnectionProtocol,
  Credential,
  DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS,
  HostEntry,
  SessionConnection,
  TunnelProfile,
} from "@/types";
import { normalizeGroupPath } from "@/lib/groups";

function trimRequired(value: string | undefined): string | undefined {
  return typeof value === "string" ? value.trim() : value;
}

function trimOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function sanitizeGroupPaths(groups: string[]): string[] {
  return Array.from(
    new Set(groups.map((group) => normalizeGroupPath(group)).filter((group): group is string => !!group))
  );
}

function sanitizeTags(tags: string[] | undefined): string[] | undefined {
  if (!tags) return tags;
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function sanitizeProtocol(protocol: ConnectionProtocol | string | undefined): ConnectionProtocol {
  if (protocol === "telnet") return "telnet";
  if (protocol === "rdp") return "rdp";
  if (protocol === "vnc") return "vnc";
  return "ssh";
}

export function sanitizeHostInput<T extends Partial<HostEntry>>(host: T): T {
  return {
    ...host,
    protocol: sanitizeProtocol(host.protocol) as T["protocol"],
    label: trimRequired(host.label) as T["label"],
    host: trimRequired(host.host) as T["host"],
    username: trimOptional(host.username) as T["username"],
    group: normalizeGroupPath(host.group) as T["group"],
    tags: sanitizeTags(host.tags) as T["tags"],
    jumpHostId: trimOptional(host.jumpHostId) as T["jumpHostId"],
    color: trimOptional(host.color) as T["color"],
    totpSecret: trimOptional(host.totpSecret)?.toUpperCase() as T["totpSecret"],
  };
}

export function sanitizeHosts(hosts: HostEntry[]): HostEntry[] {
  return hosts.map((host) => sanitizeHostInput(host));
}

export function sanitizeCredentialInput<T extends Partial<Credential>>(credential: T): T {
  return {
    ...credential,
    label: trimRequired(credential.label) as T["label"],
    username: trimRequired(credential.username) as T["username"],
    keyId: trimOptional(credential.keyId) as T["keyId"],
  };
}

export function sanitizeCredentials(credentials: Credential[]): Credential[] {
  return credentials.map((credential) => sanitizeCredentialInput(credential));
}

export function sanitizeSessionConnection(connection: SessionConnection): SessionConnection {
  return {
    ...connection,
    protocol: sanitizeProtocol(connection.protocol),
    host: connection.host.trim(),
    username: connection.username.trim(),
  };
}

export function sanitizeTunnelProfileInput<T extends Partial<TunnelProfile>>(profile: T): T {
  return {
    ...profile,
    label: trimRequired(profile.label) as T["label"],
    hostId: trimRequired(profile.hostId) as T["hostId"],
    bindAddress: trimRequired(profile.bindAddress) as T["bindAddress"],
    destinationHost: trimRequired(profile.destinationHost) as T["destinationHost"],
    localHost: trimOptional(profile.localHost) as T["localHost"],
  };
}

export function sanitizeTunnelProfiles(profiles: TunnelProfile[]): TunnelProfile[] {
  return profiles.map((profile) => sanitizeTunnelProfileInput(profile));
}

export function sanitizeSettingsInput(settings: AppSettings): AppSettings {
  const rdpWidth = Number.isFinite(settings.rdp.width) ? Math.round(settings.rdp.width) : 1600;
  const rdpHeight = Number.isFinite(settings.rdp.height) ? Math.round(settings.rdp.height) : 900;

  return {
    ...settings,
    rdp: {
      ...settings.rdp,
      width: Math.min(7680, Math.max(640, rdpWidth)),
      height: Math.min(4320, Math.max(480, rdpHeight)),
      internalClientPerformance: {
        ...DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS,
        ...settings.rdp.internalClientPerformance,
      },
    },
    groups: sanitizeGroupPaths(settings.groups),
    sync: {
      ...settings.sync,
      s3: settings.sync.s3
        ? {
            ...settings.sync.s3,
            endpoint: settings.sync.s3.endpoint.trim(),
            bucket: settings.sync.s3.bucket.trim(),
            region: settings.sync.s3.region.trim(),
            accessKey: settings.sync.s3.accessKey.trim(),
          }
        : undefined,
      webdav: settings.sync.webdav
        ? {
            ...settings.sync.webdav,
            url: settings.sync.webdav.url.trim(),
            username: settings.sync.webdav.username.trim(),
            path: settings.sync.webdav.path.trim(),
          }
        : undefined,
      custom: settings.sync.custom
        ? {
            ...settings.sync.custom,
            url: settings.sync.custom.url.trim(),
          }
        : undefined,
    },
    productivity: {
      ...settings.productivity,
      snippets: settings.productivity.snippets.map((snippet) => ({
        ...snippet,
        label: snippet.label.trim(),
        description: snippet.description?.trim() || undefined,
        scopeValue:
          snippet.scopeType === "group"
            ? normalizeGroupPath(snippet.scopeValue) || undefined
            : snippet.scopeValue?.trim() || undefined,
        tags: sanitizeTags(snippet.tags) ?? [],
      })),
      tunnels: sanitizeTunnelProfiles(settings.productivity.tunnels),
      workspaces: settings.productivity.workspaces.map((workspace) => ({
        ...workspace,
        name: workspace.name.trim(),
      })),
    },
  };
}
