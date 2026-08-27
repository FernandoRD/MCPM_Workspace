import { AppSettings, Credential, HostEntry, SshKey } from "@/types";

export function makeHost(overrides: Partial<HostEntry> = {}): HostEntry {
  return {
    id: "host-1",
    label: "Host 1",
    host: "10.0.0.1",
    port: 22,
    protocol: "ssh",
    authMethod: "agent",
    tags: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    id: "cred-1",
    label: "Credencial 1",
    username: "ubuntu",
    authMethod: "password",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeSshKey(overrides: Partial<SshKey> = {}): SshKey {
  return {
    id: "key-1",
    label: "Chave 1",
    privateKeyContent: "PRIVATE KEY",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  const base: AppSettings = {
    themeId: "dark",
    locale: "pt-BR",
    dashboard: { cardMode: "full" },
    terminal: {
      fontSize: 14,
      fontFamily: "monospace",
      cursorStyle: "block",
      cursorBlink: true,
      scrollback: 5000,
      sessionOpenMode: "tab",
      rightClickBehavior: "contextMenu",
    },
    ssh: {
      keepAliveInterval: 60,
      inactivityTimeout: 0,
      sftpOpenMode: "sameTab",
    },
    rdp: {
      launchMode: "native",
      linuxClient: "auto",
      fullscreen: false,
      dynamicResolution: true,
      width: 1600,
      height: 900,
      multimon: false,
      clipboard: true,
      audioMode: "redirect",
      certificateMode: "ignore",
      internalClientPerformance: {
        wallpaper: false,
        fullWindowDrag: false,
        menuAnimations: false,
        theming: false,
        cursorShadow: false,
        cursorSettings: false,
        fontSmoothing: false,
        desktopComposition: false,
      },
    },
    vnc: {
      linuxClient: "auto",
      fullscreen: false,
      viewOnly: false,
    },
    security: {
      masterPasswordSet: false,
      syncCredentials: false,
    },
    sync: {
      provider: null,
      autoSync: false,
    },
    groups: [],
    productivity: {
      snippets: [],
      tunnels: [],
      workspaces: [],
    },
  };

  return { ...base, ...overrides };
}
