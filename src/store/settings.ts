import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { AppSettings, RdpInternalClientPerformanceSettings, DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS } from "@/types";
import { sanitizeSettingsInput } from "@/lib/inputSanitizers";
import { logFrontendError } from "@/lib/logger";
import { applyTheme, isThemeId, ThemeId } from "@/themes";
import i18n from "@/lib/i18n";

interface SettingsStore {
  settings: AppSettings;
  initialized: boolean;
  init: () => Promise<void>;
  setTheme: (themeId: ThemeId) => void;
  setLocale: (locale: string) => void;
  updateTerminal: (terminal: Partial<AppSettings["terminal"]>) => void;
  updateSecurity: (security: Partial<AppSettings["security"]>) => void;
  updateSsh: (ssh: Partial<AppSettings["ssh"]>) => void;
  updateRdp: (rdp: Partial<AppSettings["rdp"]>) => void;
  updateVnc: (vnc: Partial<AppSettings["vnc"]>) => void;
  updateRdpInternalClientPerformance: (
    performance: Partial<RdpInternalClientPerformanceSettings>
  ) => void;
  updateSync: (sync: Partial<AppSettings["sync"]>) => void;
  updateGroups: (groups: string[]) => void;
  updateProductivity: (productivity: Partial<AppSettings["productivity"]>) => void;
  replaceSettings: (settings: AppSettings) => void;
  resetSettings: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  themeId: "dark",
  locale: "pt-BR",
  terminal: {
    fontSize: 14,
    fontFamily: "JetBrains Mono",
    cursorStyle: "block",
    cursorBlink: true,
    scrollback: 5000,
    sessionOpenMode: "tab",
  },
  security: {
    masterPasswordSet: false,
    syncCredentials: false,
  },
  ssh: {
    keepAliveInterval: 60,
    inactivityTimeout: 0,
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
    internalClientPerformance: DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS,
  },
  vnc: {
    linuxClient: "auto",
    fullscreen: false,
    viewOnly: false,
  },
  sync: {
    provider: null,
    autoSync: false,
    autoSyncIntervalMinutes: 30,
  },
  groups: [],
  productivity: {
    snippets: [],
    tunnels: [],
    workspaces: [],
  },
};

function normalizeSettings(settings?: Partial<AppSettings> | null): AppSettings {
  const normalized = sanitizeSettingsInput({
    ...DEFAULT_SETTINGS,
    ...settings,
    terminal: {
      ...DEFAULT_SETTINGS.terminal,
      ...(settings?.terminal ?? {}),
    },
    security: {
      ...DEFAULT_SETTINGS.security,
      ...(settings?.security ?? {}),
    },
    ssh: {
      ...DEFAULT_SETTINGS.ssh,
      ...(settings?.ssh ?? {}),
    },
    rdp: {
      ...DEFAULT_SETTINGS.rdp,
      ...(settings?.rdp ?? {}),
      internalClientPerformance: {
        ...DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS,
        ...(settings?.rdp?.internalClientPerformance ?? {}),
      },
    },
    vnc: {
      ...DEFAULT_SETTINGS.vnc,
      ...(settings?.vnc ?? {}),
    },
    sync: {
      ...DEFAULT_SETTINGS.sync,
      ...(settings?.sync ?? {}),
    },
    groups: settings?.groups ?? DEFAULT_SETTINGS.groups,
    productivity: {
      ...DEFAULT_SETTINGS.productivity,
      ...(settings?.productivity ?? {}),
      snippets: settings?.productivity?.snippets ?? DEFAULT_SETTINGS.productivity.snippets,
      tunnels: settings?.productivity?.tunnels ?? DEFAULT_SETTINGS.productivity.tunnels,
      workspaces: settings?.productivity?.workspaces ?? DEFAULT_SETTINGS.productivity.workspaces,
    },
  });

  return {
    ...normalized,
    themeId: isThemeId(normalized.themeId) ? normalized.themeId : DEFAULT_SETTINGS.themeId,
  };
}

function persistSettings(settings: AppSettings) {
  invoke("db_save_settings", { settings: normalizeSettings(settings) }).catch((error) => {
    logFrontendError("settings.persist", "Falha ao persistir configurações", error);
  });
}

export const useSettingsStore = create<SettingsStore>()((set, _get) => ({
  settings: DEFAULT_SETTINGS,
  initialized: false,

  init: async () => {
    try {
      const loaded = await invoke<AppSettings | null>("db_get_settings");

      if (!loaded) {
        // Migra do localStorage se existir
        const legacy = localStorage.getItem("ssh-vault-settings");
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            const legacySettings = normalizeSettings(parsed.state?.settings);
            await invoke("db_save_settings", { settings: legacySettings });
            localStorage.removeItem("ssh-vault-settings");
            applyTheme(legacySettings.themeId as ThemeId);
            i18n.changeLanguage(legacySettings.locale);
            set({ settings: legacySettings, initialized: true });
            return;
          } catch {
            // ignora erros de parse
          }
        }
        // Sem dados: aplica defaults
        applyTheme(DEFAULT_SETTINGS.themeId as ThemeId);
        i18n.changeLanguage(DEFAULT_SETTINGS.locale);
        set({ initialized: true });
        return;
      }

      const normalized = normalizeSettings(loaded);
      applyTheme(normalized.themeId as ThemeId);
      i18n.changeLanguage(normalized.locale);
      set({ settings: normalized, initialized: true });
    } catch (e) {
      logFrontendError("settings.init", "Falha ao inicializar settings store", e);
      applyTheme(DEFAULT_SETTINGS.themeId as ThemeId);
      i18n.changeLanguage(DEFAULT_SETTINGS.locale);
      set({ initialized: true });
    }
  },

  setTheme: (themeId) => {
    applyTheme(themeId);
    set((s) => {
      const settings = { ...s.settings, themeId };
      persistSettings(settings);
      return { settings };
    });
  },

  setLocale: (locale) => {
    i18n.changeLanguage(locale);
    set((s) => {
      const settings = { ...s.settings, locale };
      persistSettings(settings);
      return { settings };
    });
  },

  updateTerminal: (terminal) =>
    set((s) => {
      const settings = {
        ...s.settings,
        terminal: { ...s.settings.terminal, ...terminal },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateSecurity: (security) =>
    set((s) => {
      const settings = {
        ...s.settings,
        security: { ...s.settings.security, ...security },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateSsh: (ssh) =>
    set((s) => {
      const settings = {
        ...s.settings,
        ssh: { ...DEFAULT_SETTINGS.ssh, ...s.settings.ssh, ...ssh },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateRdp: (rdp) =>
    set((s) => {
      const settings = {
        ...s.settings,
        rdp: {
          ...DEFAULT_SETTINGS.rdp,
          ...s.settings.rdp,
          ...rdp,
          internalClientPerformance: {
            ...DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS,
            ...s.settings.rdp.internalClientPerformance,
            ...rdp.internalClientPerformance,
          },
        },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateVnc: (vnc) =>
    set((s) => {
      const settings = {
        ...s.settings,
        vnc: { ...DEFAULT_SETTINGS.vnc, ...s.settings.vnc, ...vnc },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateRdpInternalClientPerformance: (performance) =>
    set((s) => {
      const settings = {
        ...s.settings,
        rdp: {
          ...DEFAULT_SETTINGS.rdp,
          ...s.settings.rdp,
          internalClientPerformance: {
            ...DEFAULT_RDP_INTERNAL_CLIENT_PERFORMANCE_SETTINGS,
            ...s.settings.rdp.internalClientPerformance,
            ...performance,
          },
        },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateSync: (sync) =>
    set((s) => {
      const settings = {
        ...s.settings,
        sync: { ...s.settings.sync, ...sync },
      };
      persistSettings(settings);
      return { settings };
    }),

  updateGroups: (groups) =>
    set((s) => {
      const settings = { ...s.settings, groups };
      persistSettings(settings);
      return { settings };
    }),

  updateProductivity: (productivity) =>
    set((s) => {
      const settings = {
        ...s.settings,
        productivity: { ...DEFAULT_SETTINGS.productivity, ...s.settings.productivity, ...productivity },
      };
      persistSettings(settings);
      return { settings };
    }),

  replaceSettings: (settings) => {
    const normalized = normalizeSettings(settings);
    applyTheme(normalized.themeId as ThemeId);
    i18n.changeLanguage(normalized.locale);
    set({ settings: normalized });
    persistSettings(normalized);
  },

  resetSettings: () => {
    applyTheme(DEFAULT_SETTINGS.themeId as ThemeId);
    i18n.changeLanguage(DEFAULT_SETTINGS.locale);
    set({ settings: DEFAULT_SETTINGS });
    persistSettings(DEFAULT_SETTINGS);
  },
}));
