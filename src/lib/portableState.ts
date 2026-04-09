import { AppSettings, Credential, HostEntry, SshKey } from "@/types";

export interface PortableSyncSettings {
  themeId: string;
  locale: string;
  terminal: AppSettings["terminal"];
  ssh: AppSettings["ssh"];
  rdp: AppSettings["rdp"];
  security: Pick<AppSettings["security"], "syncCredentials">;
  sync: {
    provider: AppSettings["sync"]["provider"];
    autoSync: boolean;
    autoSyncIntervalMinutes?: number;
    gist?: { gistId?: string };
    s3?: { endpoint: string; bucket: string; region: string };
    webdav?: { url: string; username: string; path: string };
    custom?: { url: string };
  };
  groups: string[];
  productivity: AppSettings["productivity"];
}

export interface TransferSecretsPayload {
  credentials?: Record<string, { password?: string }>;
  hosts?: Record<string, { totpSecret?: string }>;
  sshKeys?: Record<string, { privateKeyContent?: string; passphrase?: string }>;
  settings?: {
    security?: {
      verificationPayload?: string;
    };
    sync?: {
      gist?: { token: string };
      s3?: { accessKey: string; secretKey: string };
      webdav?: { password: string };
    };
  };
}

export function sanitizeHosts(hosts: HostEntry[]): HostEntry[] {
  return hosts.map(({ passwordRef: _passwordRef, totpSecret: _totpSecret, ...rest }) => rest as HostEntry);
}

export function sanitizeCredentials(credentials: Credential[]): Credential[] {
  return credentials.map(({ password: _password, ...rest }) => rest as Credential);
}

export function sanitizeSshKeys(sshKeys: SshKey[]): SshKey[] {
  return sshKeys.map(
    ({ privateKeyContent: _privateKeyContent, passphrase: _passphrase, ...rest }) => rest as SshKey
  );
}

export function buildPortableSettings(settings: AppSettings): PortableSyncSettings {
  return {
    themeId: settings.themeId,
    locale: settings.locale,
    terminal: settings.terminal,
    ssh: settings.ssh,
    rdp: settings.rdp,
    security: {
      syncCredentials: settings.security.syncCredentials,
    },
    sync: {
      provider: settings.sync.provider,
      autoSync: settings.sync.autoSync,
      autoSyncIntervalMinutes: settings.sync.autoSyncIntervalMinutes,
      gist: settings.sync.gist ? { gistId: settings.sync.gist.gistId } : undefined,
      s3: settings.sync.s3
        ? {
            endpoint: settings.sync.s3.endpoint,
            bucket: settings.sync.s3.bucket,
            region: settings.sync.s3.region,
          }
        : undefined,
      webdav: settings.sync.webdav
        ? {
            url: settings.sync.webdav.url,
            username: settings.sync.webdav.username,
            path: settings.sync.webdav.path,
          }
        : undefined,
      custom: settings.sync.custom ? { url: settings.sync.custom.url } : undefined,
    },
    groups: settings.groups,
    productivity: settings.productivity,
  };
}

export function buildTransferSecretsPayload(
  hosts: HostEntry[],
  credentials: Credential[],
  sshKeys: SshKey[],
  settings: AppSettings
): TransferSecretsPayload | undefined {
  const payload: TransferSecretsPayload = {};

  const credentialSecrets = credentials.reduce<Record<string, { password?: string }>>((acc, credential) => {
    if (credential.password) {
      acc[credential.id] = { password: credential.password };
    }
    return acc;
  }, {});
  if (Object.keys(credentialSecrets).length > 0) {
    payload.credentials = credentialSecrets;
  }

  const hostSecrets = hosts.reduce<Record<string, { totpSecret?: string }>>((acc, host) => {
    if (host.totpSecret) {
      acc[host.id] = { totpSecret: host.totpSecret };
    }
    return acc;
  }, {});
  if (Object.keys(hostSecrets).length > 0) {
    payload.hosts = hostSecrets;
  }

  const sshKeySecrets = sshKeys.reduce<Record<string, { privateKeyContent?: string; passphrase?: string }>>(
    (acc, sshKey) => {
      if (sshKey.privateKeyContent || sshKey.passphrase) {
        acc[sshKey.id] = {
          ...(sshKey.privateKeyContent ? { privateKeyContent: sshKey.privateKeyContent } : {}),
          ...(sshKey.passphrase ? { passphrase: sshKey.passphrase } : {}),
        };
      }
      return acc;
    },
    {}
  );
  if (Object.keys(sshKeySecrets).length > 0) {
    payload.sshKeys = sshKeySecrets;
  }

  const syncSecrets: NonNullable<TransferSecretsPayload["settings"]>["sync"] = {};
  if (settings.sync.gist?.token) {
    syncSecrets.gist = { token: settings.sync.gist.token };
  }
  if (settings.sync.s3?.accessKey || settings.sync.s3?.secretKey) {
    syncSecrets.s3 = {
      accessKey: settings.sync.s3?.accessKey ?? "",
      secretKey: settings.sync.s3?.secretKey ?? "",
    };
  }
  if (settings.sync.webdav?.password) {
    syncSecrets.webdav = { password: settings.sync.webdav.password };
  }

  const securitySecrets =
    settings.security.masterPasswordSet && settings.security.verificationPayload
      ? { verificationPayload: settings.security.verificationPayload }
      : undefined;

  if (securitySecrets || Object.keys(syncSecrets).length > 0) {
    payload.settings = {
      ...(securitySecrets ? { security: securitySecrets } : {}),
      ...(Object.keys(syncSecrets).length > 0 ? { sync: syncSecrets } : {}),
    };
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

export function hydrateCredentials(
  credentials: Credential[],
  secrets?: TransferSecretsPayload["credentials"],
  currentCredentials: Credential[] = []
): Credential[] {
  const currentById = new Map(currentCredentials.map((credential) => [credential.id, credential]));
  return credentials.map((credential) => ({
    ...credential,
    password: secrets?.[credential.id]?.password ?? currentById.get(credential.id)?.password,
  }));
}

export function hydrateHosts(
  hosts: HostEntry[],
  secrets?: TransferSecretsPayload["hosts"],
  currentHosts: HostEntry[] = []
): HostEntry[] {
  const currentById = new Map(currentHosts.map((host) => [host.id, host]));
  return hosts.map((host) => ({
    ...host,
    totpSecret: secrets?.[host.id]?.totpSecret ?? currentById.get(host.id)?.totpSecret,
  }));
}

export function hydrateSshKeys(
  sshKeys: SshKey[],
  secrets?: TransferSecretsPayload["sshKeys"],
  currentSshKeys: SshKey[] = []
): SshKey[] {
  const currentById = new Map(currentSshKeys.map((sshKey) => [sshKey.id, sshKey]));
  return sshKeys.map((sshKey) => ({
    ...sshKey,
    privateKeyContent:
      secrets?.[sshKey.id]?.privateKeyContent ?? currentById.get(sshKey.id)?.privateKeyContent ?? "",
    passphrase: secrets?.[sshKey.id]?.passphrase ?? currentById.get(sshKey.id)?.passphrase,
  }));
}

export function mergePortableSettings(
  current: AppSettings,
  incoming?: Partial<PortableSyncSettings> | null,
  secrets?: TransferSecretsPayload["settings"]
): AppSettings {
  const nextGist =
    incoming?.sync?.gist || secrets?.sync?.gist || current.sync.gist
      ? {
          token: secrets?.sync?.gist?.token ?? current.sync.gist?.token ?? "",
          gistId: incoming?.sync?.gist?.gistId ?? current.sync.gist?.gistId,
        }
      : undefined;

  const nextS3 =
    incoming?.sync?.s3 || secrets?.sync?.s3 || current.sync.s3
      ? {
          endpoint: incoming?.sync?.s3?.endpoint ?? current.sync.s3?.endpoint ?? "",
          bucket: incoming?.sync?.s3?.bucket ?? current.sync.s3?.bucket ?? "",
          region: incoming?.sync?.s3?.region ?? current.sync.s3?.region ?? "",
          accessKey: secrets?.sync?.s3?.accessKey ?? current.sync.s3?.accessKey ?? "",
          secretKey: secrets?.sync?.s3?.secretKey ?? current.sync.s3?.secretKey ?? "",
        }
      : undefined;

  const nextWebdav =
    incoming?.sync?.webdav || secrets?.sync?.webdav || current.sync.webdav
      ? {
          url: incoming?.sync?.webdav?.url ?? current.sync.webdav?.url ?? "",
          username: incoming?.sync?.webdav?.username ?? current.sync.webdav?.username ?? "",
          password: secrets?.sync?.webdav?.password ?? current.sync.webdav?.password ?? "",
          path: incoming?.sync?.webdav?.path ?? current.sync.webdav?.path ?? "vault.json",
        }
      : undefined;

  const nextCustom =
    incoming?.sync?.custom || current.sync.custom
      ? {
          url: incoming?.sync?.custom?.url ?? current.sync.custom?.url ?? "",
        }
      : undefined;

  return {
    ...current,
    themeId: incoming?.themeId ?? current.themeId,
    locale: incoming?.locale ?? current.locale,
    terminal: incoming?.terminal ? { ...current.terminal, ...incoming.terminal } : current.terminal,
    ssh: incoming?.ssh ? { ...current.ssh, ...incoming.ssh } : current.ssh,
    rdp: incoming?.rdp
      ? {
          ...current.rdp,
          ...incoming.rdp,
          internalClientPerformance: {
            ...current.rdp.internalClientPerformance,
            ...incoming.rdp.internalClientPerformance,
          },
        }
      : current.rdp,
    security: {
      ...current.security,
      syncCredentials: incoming?.security?.syncCredentials ?? current.security.syncCredentials,
      ...(secrets?.security?.verificationPayload
        ? {
            masterPasswordSet: true,
            verificationPayload: secrets.security.verificationPayload,
          }
        : {}),
    },
    sync: {
      ...current.sync,
      provider: incoming?.sync?.provider ?? current.sync.provider,
      autoSync: incoming?.sync?.autoSync ?? current.sync.autoSync,
      autoSyncIntervalMinutes:
        incoming?.sync?.autoSyncIntervalMinutes ?? current.sync.autoSyncIntervalMinutes,
      gist: nextGist,
      s3: nextS3,
      webdav: nextWebdav,
      custom: nextCustom,
    },
    groups: incoming?.groups ?? current.groups,
    productivity: incoming?.productivity
      ? {
          snippets: incoming.productivity.snippets,
          tunnels: incoming.productivity.tunnels,
          workspaces: incoming.productivity.workspaces,
        }
      : current.productivity,
  };
}
