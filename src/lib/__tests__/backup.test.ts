import { describe, expect, it } from "vitest";
import { BackupFile, hydrateBackupData, parseBackupFile } from "@/lib/backup";
import { buildPortableSettings } from "@/lib/portableState";
import { makeCredential, makeHost, makeSettings, makeSshKey } from "./fixtures";

function makeBackup(overrides: Partial<BackupFile> = {}): BackupFile {
  return {
    app: "ssh-vault",
    version: 1,
    exportedAt: "2024-01-01T00:00:00.000Z",
    hosts: [makeHost()],
    credentials: [makeCredential()],
    sshKeys: [makeSshKey({ privateKeyContent: "" })],
    settings: buildPortableSettings(makeSettings()),
    ...overrides,
  };
}

describe("parseBackupFile", () => {
  it("aceita um backup válido", () => {
    const backup = makeBackup();
    expect(parseBackupFile(JSON.stringify(backup))).toEqual(backup);
  });

  it("rejeita JSON inválido", () => {
    expect(() => parseBackupFile("{incompleto")).toThrow("JSON");
  });

  it("rejeita marcador, versão e hosts inválidos", () => {
    expect(() => parseBackupFile(JSON.stringify({ ...makeBackup(), app: "outro" }))).toThrow();
    expect(() => parseBackupFile(JSON.stringify({ ...makeBackup(), version: 2 }))).toThrow();
    expect(() => parseBackupFile(JSON.stringify({ ...makeBackup(), hosts: null }))).toThrow();
  });
});

describe("hydrateBackupData", () => {
  it("restaura segredos e configurações portáveis", () => {
    const backup = makeBackup({
      hosts: [makeHost({ id: "h1" })],
      credentials: [makeCredential({ id: "c1" })],
      sshKeys: [makeSshKey({ id: "k1", privateKeyContent: "" })],
    });

    const hydrated = hydrateBackupData(backup, {
      hosts: { h1: { totpSecret: "TOTP" } },
      credentials: { c1: { password: "senha" } },
      sshKeys: { k1: { privateKeyContent: "PRIVATE", passphrase: "frase" } },
      settings: { security: { verificationPayload: "verificação" } },
    });

    expect(hydrated.hosts[0].totpSecret).toBe("TOTP");
    expect(hydrated.credentials[0].password).toBe("senha");
    expect(hydrated.sshKeys[0]).toMatchObject({
      privateKeyContent: "PRIVATE",
      passphrase: "frase",
    });
    expect(hydrated.settings?.security).toMatchObject({
      masterPasswordSet: true,
      verificationPayload: "verificação",
    });
  });

  it("tolera coleções ausentes em backups legados", () => {
    const backup = makeBackup({
      hosts: undefined as unknown as BackupFile["hosts"],
      credentials: undefined as unknown as BackupFile["credentials"],
      sshKeys: undefined as unknown as BackupFile["sshKeys"],
    });

    const hydrated = hydrateBackupData(backup, null);
    expect(hydrated.hosts).toEqual([]);
    expect(hydrated.credentials).toEqual([]);
    expect(hydrated.sshKeys).toEqual([]);
  });

  it("retorna settings nulo quando o backup não as contém", () => {
    const backup = makeBackup({ settings: undefined as unknown as BackupFile["settings"] });
    expect(hydrateBackupData(backup, null).settings).toBeNull();
  });
});
