import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ptBR from "@/locales/pt-BR/translation.json";
import enUS from "@/locales/en-US/translation.json";

export type LocaleId = "pt-BR" | "en-US";

export const LOCALES: { id: LocaleId; label: string; flag: string }[] = [
  { id: "pt-BR", label: "Português (BR)", flag: "🇧🇷" },
  { id: "en-US", label: "English (US)", flag: "🇺🇸" },
];

i18n.use(initReactI18next).init({
  resources: {
    "pt-BR": { translation: ptBR },
    "en-US": { translation: enUS },
  },
  lng: "pt-BR",
  fallbackLng: "en-US",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
