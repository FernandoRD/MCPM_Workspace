import { describe, expect, it } from "vitest";
import { applySyncPayload, parseSyncFile, SyncFile } from "@/lib/sync";
import { buildPortableSettings } from "@/lib/portableState";
import { AppSettings, Credential, HostEntry, SshKey } from "@/types";
import { makeCredential, makeHost, makeSettings, makeSshKey } from "./fixtures";

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeSyncFile(overrides: Partial<SyncFile> = {}): SyncFile {
  return {
    app: "ssh-vault",
    version: 1,
    syncedAt: new Date().toISOString(),
    hosts: [],
    credentials: [],
    sshKeys: [],
    settings: buildPortableSettings(makeSettings()),
    ...overrides,
  };
}

async function apply(
  file: SyncFile,
  current: {
    hosts?: HostEntry[];
    credentials?: Credential[];
    sshKeys?: SshKey[];
    settings?: AppSettings;
  } = {},
  mode: "merge" | "replace" = "merge"
) {
  let hosts: HostEntry[] = [];
  let credentials: Credential[] = [];
  let sshKeys: SshKey[] = [];
  let settings = makeSettings();

  const result = await applySyncPayload(
    file,
    null,
    mode,
    current.hosts ?? [],
    current.credentials ?? [],
    current.sshKeys ?? [],
    current.settings ?? makeSettings(),
    (value) => { hosts = value; },
    (value) => { credentials = value; },
    (value) => { sshKeys = value; },
    (value) => { settings = value; }
  );

  return { result, hosts, credentials, sshKeys, settings };
}

describe("parseSyncFile", () => {
  it("aceita o marcador esperado e rejeita JSON ou app inválidos", () => {
    const file = makeSyncFile();
    expect(parseSyncFile(JSON.stringify(file))).toEqual(file);
    expect(() => parseSyncFile("{incompleto")).toThrow("JSON válido");
    expect(() => parseSyncFile('{"app":"outro"}')).toThrow("campo 'app' incorreto");
  });
});

describe("applySyncPayload merge", () => {
  it("adiciona e atualiza entidades sem remover itens exclusivamente locais", async () => {
    const currentHosts = [
      makeHost({ id: "h1", label: "Antigo" }),
      makeHost({ id: "local", label: "Somente local" }),
    ];
    const currentCredentials = [makeCredential({ id: "c1", label: "Credencial antiga" })];
    const currentSshKeys = [makeSshKey({ id: "k-local", label: "Chave local" })];
    const file = makeSyncFile({
      hosts: [makeHost({ id: "h1", label: "Atualizado" }), makeHost({ id: "h2" })],
      credentials: [
        makeCredential({ id: "c1", label: "Credencial atualizada" }),
        makeCredential({ id: "c2" }),
      ],
      sshKeys: [makeSshKey({ id: "k1", privateKeyContent: "" })],
    });

    const applied = await apply(file, {
      hosts: currentHosts,
      credentials: currentCredentials,
      sshKeys: currentSshKeys,
    });

    expect(applied.hosts.map((host) => host.id)).toEqual(["h1", "local", "h2"]);
    expect(applied.hosts.find((host) => host.id === "h1")?.label).toBe("Atualizado");
    expect(applied.credentials.map((credential) => credential.id)).toEqual(["c1", "c2"]);
    expect(applied.sshKeys.map((key) => key.id)).toEqual(["k-local", "k1"]);
    expect(applied.result).toEqual({
      hostsAdded: 1,
      hostsUpdated: 1,
      credentialsAdded: 1,
      credentialsUpdated: 1,
      sshKeysAdded: 1,
      sshKeysUpdated: 0,
    });
  });

  it("remove host quando o tombstone é mais novo que a última atualização", async () => {
    const host = makeHost({ id: "h1", createdAt: daysAgo(10), updatedAt: daysAgo(5) });
    const deletedAt = daysAgo(1);

    const applied = await apply(makeSyncFile({ deletedHosts: { h1: deletedAt } }), {
      hosts: [host],
    });

    expect(applied.hosts).toEqual([]);
    expect(applied.settings.sync.deletedHosts).toEqual({ h1: deletedAt });
  });

  it("preserva host atualizado depois da exclusão e descarta o tombstone obsoleto", async () => {
    const host = makeHost({ id: "h1", createdAt: daysAgo(10), updatedAt: daysAgo(1) });

    const applied = await apply(makeSyncFile({ deletedHosts: { h1: daysAgo(5) } }), {
      hosts: [host],
    });

    expect(applied.hosts).toEqual([host]);
    expect(applied.settings.sync.deletedHosts).toEqual({});
  });

  it("mantém o tombstone mais recente e elimina exclusões expiradas", async () => {
    const localDeletedAt = daysAgo(2);
    const settings = makeSettings({
      sync: {
        provider: null,
        autoSync: false,
        deletedHosts: { recent: localDeletedAt, expired: daysAgo(91) },
      },
    });

    const applied = await apply(
      makeSyncFile({ deletedHosts: { recent: daysAgo(5), remoteExpired: daysAgo(120) } }),
      { settings }
    );

    expect(applied.settings.sync.deletedHosts).toEqual({ recent: localDeletedAt });
  });
});

describe("applySyncPayload replace", () => {
  it("substitui as coleções e contabiliza todos os itens remotos como adicionados", async () => {
    const file = makeSyncFile({
      hosts: [makeHost({ id: "remote" })],
      credentials: [makeCredential({ id: "remote-credential" })],
      sshKeys: [makeSshKey({ id: "remote-key", privateKeyContent: "" })],
    });

    const applied = await apply(
      file,
      {
        hosts: [makeHost({ id: "local" })],
        credentials: [makeCredential({ id: "local-credential" })],
        sshKeys: [makeSshKey({ id: "local-key" })],
      },
      "replace"
    );

    expect(applied.hosts.map((host) => host.id)).toEqual(["remote"]);
    expect(applied.credentials.map((credential) => credential.id)).toEqual(["remote-credential"]);
    expect(applied.sshKeys.map((key) => key.id)).toEqual(["remote-key"]);
    expect(applied.result).toEqual({
      hostsAdded: 1,
      hostsUpdated: 0,
      credentialsAdded: 1,
      credentialsUpdated: 0,
      sshKeysAdded: 1,
      sshKeysUpdated: 0,
    });
  });
});
