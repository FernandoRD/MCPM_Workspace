import { describe, expect, it } from "vitest";
import {
  buildPortableSettings,
  buildTransferSecretsPayload,
  hydrateCredentials,
  hydrateHosts,
  hydrateSshKeys,
  mergePortableSettings,
  sanitizeCredentials,
  sanitizeHosts,
  sanitizeSshKeys,
} from "@/lib/portableState";
import { makeCredential, makeHost, makeSettings, makeSshKey } from "./fixtures";

describe("sanitizeHosts", () => {
  it("remove passwordRef e totpSecret dos hosts", () => {
    const host = makeHost({ passwordRef: "ref-123", totpSecret: "JBSWY3DPEHPK3PXP" });
    const [sanitized] = sanitizeHosts([host]);

    expect(sanitized.passwordRef).toBeUndefined();
    expect(sanitized.totpSecret).toBeUndefined();
    expect(sanitized.id).toBe(host.id);
    expect(sanitized.label).toBe(host.label);
  });

  it("não altera hosts sem segredos", () => {
    const host = makeHost();
    expect(sanitizeHosts([host])).toEqual([host]);
  });
});

describe("sanitizeCredentials", () => {
  it("remove a senha das credenciais", () => {
    const credential = makeCredential({ password: "s3cret" });
    const [sanitized] = sanitizeCredentials([credential]);

    expect(sanitized.password).toBeUndefined();
    expect(sanitized.username).toBe("ubuntu");
  });
});

describe("sanitizeSshKeys", () => {
  it("remove conteúdo da chave privada e passphrase", () => {
    const key = makeSshKey({ privateKeyContent: "KEY", passphrase: "pass" });
    const [sanitized] = sanitizeSshKeys([key]);

    expect(sanitized.privateKeyContent).toBeUndefined();
    expect(sanitized.passphrase).toBeUndefined();
    expect(sanitized.label).toBe("Chave 1");
  });
});

describe("buildPortableSettings", () => {
  it("extrai apenas dados não sensíveis do sync", () => {
    const settings = makeSettings({
      security: { masterPasswordSet: true, verificationPayload: "payload", syncCredentials: true },
      sync: {
        provider: "s3",
        autoSync: true,
        autoSyncIntervalMinutes: 15,
        gist: { token: "ghp_token", gistId: "gist-1" },
        s3: { endpoint: "https://s3.example", bucket: "vault", region: "us-east-1", accessKey: "AK", secretKey: "SK" },
        webdav: { url: "https://dav.example", username: "user", password: "pw", path: "vault.json" },
        custom: { url: "https://custom.example" },
      },
    });

    const portable = buildPortableSettings(settings);

    expect(portable.security).toEqual({ syncCredentials: true });
    expect(portable.sync.gist).toEqual({ gistId: "gist-1" });
    expect(portable.sync.s3).toEqual({
      endpoint: "https://s3.example",
      bucket: "vault",
      region: "us-east-1",
    });
    expect(portable.sync.webdav).toEqual({
      url: "https://dav.example",
      username: "user",
      path: "vault.json",
    });
    expect(portable.sync.custom).toEqual({ url: "https://custom.example" });
    expect(JSON.stringify(portable)).not.toContain("ghp_token");
    expect(JSON.stringify(portable)).not.toContain("SK");
  });

  it("omite provedores não configurados", () => {
    const portable = buildPortableSettings(makeSettings());

    expect(portable.sync.gist).toBeUndefined();
    expect(portable.sync.s3).toBeUndefined();
    expect(portable.sync.webdav).toBeUndefined();
    expect(portable.sync.custom).toBeUndefined();
  });
});

describe("buildTransferSecretsPayload", () => {
  it("retorna undefined quando não há segredos", () => {
    const payload = buildTransferSecretsPayload(
      [makeHost()],
      [makeCredential()],
      [makeSshKey({ privateKeyContent: "" })],
      makeSettings()
    );

    expect(payload).toBeUndefined();
  });

  it("agrupa segredos de credenciais, hosts e chaves por id", () => {
    const payload = buildTransferSecretsPayload(
      [makeHost({ id: "h1", totpSecret: "TOTP" }), makeHost({ id: "h2" })],
      [makeCredential({ id: "c1", password: "pw" }), makeCredential({ id: "c2" })],
      [makeSshKey({ id: "k1", privateKeyContent: "KEY", passphrase: "pp" })],
      makeSettings()
    );

    expect(payload?.credentials).toEqual({ c1: { password: "pw" } });
    expect(payload?.hosts).toEqual({ h1: { totpSecret: "TOTP" } });
    expect(payload?.sshKeys).toEqual({ k1: { privateKeyContent: "KEY", passphrase: "pp" } });
  });

  it("inclui tokens dos provedores de sync", () => {
    const settings = makeSettings({
      sync: {
        provider: "webdav",
        autoSync: false,
        gist: { token: "ghp_token" },
        s3: { endpoint: "", bucket: "", region: "", accessKey: "AK", secretKey: "SK" },
        webdav: { url: "", username: "", password: "dave", path: "" },
      },
    });

    const payload = buildTransferSecretsPayload([], [], [], settings);

    expect(payload?.settings?.sync).toEqual({
      gist: { token: "ghp_token" },
      s3: { accessKey: "AK", secretKey: "SK" },
      webdav: { password: "dave" },
    });
  });

  it("só inclui verificationPayload quando a senha mestra está definida", () => {
    const withoutMaster = buildTransferSecretsPayload(
      [],
      [],
      [],
      makeSettings({ security: { masterPasswordSet: false, verificationPayload: "vp", syncCredentials: false } })
    );
    expect(withoutMaster).toBeUndefined();

    const withMaster = buildTransferSecretsPayload(
      [],
      [],
      [],
      makeSettings({ security: { masterPasswordSet: true, verificationPayload: "vp", syncCredentials: false } })
    );
    expect(withMaster?.settings?.security).toEqual({ verificationPayload: "vp" });
  });
});

describe("hydrateCredentials", () => {
  it("restaura senhas a partir dos segredos", () => {
    const credentials = [makeCredential({ id: "c1" })];
    const [hydrated] = hydrateCredentials(credentials, { c1: { password: "pw" } });

    expect(hydrated.password).toBe("pw");
  });

  it("preserva a senha atual quando não há segredo novo", () => {
    const incoming = [makeCredential({ id: "c1" })];
    const current = [makeCredential({ id: "c1", password: "atual" })];
    const [hydrated] = hydrateCredentials(incoming, undefined, current);

    expect(hydrated.password).toBe("atual");
  });

  it("segredos novos têm prioridade sobre o estado atual", () => {
    const incoming = [makeCredential({ id: "c1" })];
    const current = [makeCredential({ id: "c1", password: "atual" })];
    const [hydrated] = hydrateCredentials(incoming, { c1: { password: "nova" } }, current);

    expect(hydrated.password).toBe("nova");
  });
});

describe("hydrateHosts", () => {
  it("restaura totpSecret dos segredos ou do estado atual", () => {
    const incoming = [makeHost({ id: "h1" }), makeHost({ id: "h2" })];
    const current = [makeHost({ id: "h2", totpSecret: "ATUAL" })];

    const hydrated = hydrateHosts(incoming, { h1: { totpSecret: "NOVO" } }, current);

    expect(hydrated[0].totpSecret).toBe("NOVO");
    expect(hydrated[1].totpSecret).toBe("ATUAL");
  });
});

describe("hydrateSshKeys", () => {
  it("usa string vazia quando não há conteúdo de chave privada", () => {
    const [hydrated] = hydrateSshKeys([makeSshKey({ id: "k1", privateKeyContent: "" })]);

    expect(hydrated.privateKeyContent).toBe("");
    expect(hydrated.passphrase).toBeUndefined();
  });

  it("restaura chave e passphrase dos segredos", () => {
    const [hydrated] = hydrateSshKeys(
      [makeSshKey({ id: "k1", privateKeyContent: "" })],
      { k1: { privateKeyContent: "KEY", passphrase: "pp" } }
    );

    expect(hydrated.privateKeyContent).toBe("KEY");
    expect(hydrated.passphrase).toBe("pp");
  });
});

describe("mergePortableSettings", () => {
  it("mantém o estado atual quando incoming é nulo", () => {
    const current = makeSettings({ themeId: "light" });
    expect(mergePortableSettings(current, null)).toEqual(current);
    expect(mergePortableSettings(current, undefined)).toEqual(current);
  });

  it("aplica campos recebidos por cima do estado atual", () => {
    const current = makeSettings({ themeId: "dark", locale: "pt-BR" });
    const merged = mergePortableSettings(current, { themeId: "light", groups: ["Prod"] });

    expect(merged.themeId).toBe("light");
    expect(merged.locale).toBe("pt-BR");
    expect(merged.groups).toEqual(["Prod"]);
  });

  it("faz merge raso de dashboard e preserva chaves ausentes", () => {
    const current = makeSettings();
    const merged = mergePortableSettings(current, {
      dashboard: { cardMode: "compact" },
    });

    expect(merged.dashboard.cardMode).toBe("compact");
  });

  it("faz merge profundo de rdp.internalClientPerformance", () => {
    const current = makeSettings();
    current.rdp.internalClientPerformance.wallpaper = true;

    const merged = mergePortableSettings(current, {
      rdp: { ...current.rdp, width: 1920, internalClientPerformance: { fontSmoothing: true } as never },
    });

    expect(merged.rdp.width).toBe(1920);
    expect(merged.rdp.internalClientPerformance.wallpaper).toBe(true);
    expect(merged.rdp.internalClientPerformance.fontSmoothing).toBe(true);
  });

  it("combina gistId recebido com token dos segredos", () => {
    const current = makeSettings();
    const merged = mergePortableSettings(
      current,
      { sync: { gist: { gistId: "gist-9" } } as never },
      { sync: { gist: { token: "ghp_new" } } }
    );

    expect(merged.sync.gist).toEqual({ gistId: "gist-9", token: "ghp_new" });
  });

  it("preserva o token atual quando os segredos não trazem token", () => {
    const current = makeSettings({
      sync: { provider: "githubGist", autoSync: false, gist: { token: "ghp_old", gistId: "gist-1" } },
    });
    const merged = mergePortableSettings(current, { sync: { gist: { gistId: "gist-2" } } as never });

    expect(merged.sync.gist).toEqual({ gistId: "gist-2", token: "ghp_old" });
  });

  it("usa 'vault.json' como fallback de webdav.path quando nenhum valor existe", () => {
    const merged = mergePortableSettings(makeSettings(), {
      sync: {
        provider: "webdav",
        autoSync: false,
        webdav: { url: "https://dav.example", username: "u" } as never,
      },
    });

    expect(merged.sync.webdav?.url).toBe("https://dav.example");
    expect(merged.sync.webdav?.path).toBe("vault.json");
  });

  it("define masterPasswordSet quando chega verificationPayload nos segredos", () => {
    const merged = mergePortableSettings(makeSettings(), undefined, {
      security: { verificationPayload: "vp" },
    });

    expect(merged.security.masterPasswordSet).toBe(true);
    expect(merged.security.verificationPayload).toBe("vp");
  });

  it("substitui productivity inteiramente quando recebido", () => {
    const current = makeSettings();
    const snippet = {
      id: "s1",
      label: "Snippet",
      command: "ls",
      scopeType: "global" as const,
      tags: [],
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };
    const merged = mergePortableSettings(current, {
      productivity: { snippets: [snippet], tunnels: [], workspaces: [] },
    });

    expect(merged.productivity.snippets).toEqual([snippet]);
  });
});
