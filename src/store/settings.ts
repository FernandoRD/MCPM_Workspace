import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AppSettings } from "@/types";
import { applyTheme, ThemeId } from "@/themes";
import i18n from "@/lib/i18n";

interface SettingsStore {
  settings: AppSettings;
  setTheme: (themeId: ThemeId) => void;
  setLocale: (locale: string) => void;
  updateTerminal: (terminal: Partial<AppSettings["terminal"]>) => void;
  updateSecurity: (security: Partial<AppSettings["security"]>) => void;
  updateSync: (sync: Partial<AppSettings["sync"]>) => void;
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
  },
  security: {
    masterPasswordSet: false,
    syncCredentials: false,
  },
  sync: {
    provider: null,
    autoSync: false,
  },
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,

      setTheme: (themeId) => {
        applyTheme(themeId);
        set((s) => ({ settings: { ...s.settings, themeId } }));
      },

      setLocale: (locale) => {
        i18n.changeLanguage(locale);
        set((s) => ({ settings: { ...s.settings, locale } }));
      },

      updateTerminal: (terminal) =>
        set((s) => ({
          settings: {
            ...s.settings,
            terminal: { ...s.settings.terminal, ...terminal },
          },
        })),

      updateSecurity: (security) =>
        set((s) => ({
          settings: {
            ...s.settings,
            security: { ...s.settings.security, ...security },
          },
        })),

      updateSync: (sync) =>
        set((s) => ({
          settings: {
            ...s.settings,
            sync: { ...s.settings.sync, ...sync },
          },
        })),

      resetSettings: () => {
        applyTheme(DEFAULT_SETTINGS.themeId as ThemeId);
        i18n.changeLanguage(DEFAULT_SETTINGS.locale);
        set({ settings: DEFAULT_SETTINGS });
      },

      _hydrate: () => {
        const { settings } = get();
        applyTheme(settings.themeId as ThemeId);
        i18n.changeLanguage(settings.locale);
      },
    }),
    {
      name: "ssh-vault-settings",
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.settings.themeId as ThemeId);
          i18n.changeLanguage(state.settings.locale);
        }
      },
    }
  )
);
