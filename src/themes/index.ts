export type ThemeId = "dark" | "light" | "dracula" | "nord" | "catppuccin" | "solarized";

export interface Theme {
  id: ThemeId;
  name: string;
  preview: {
    bg: string;
    accent: string;
    text: string;
  };
}

export const THEMES: Theme[] = [
  {
    id: "dark",
    name: "Dark",
    preview: { bg: "#0f1117", accent: "#388bfd", text: "#e6edf3" },
  },
  {
    id: "light",
    name: "Light",
    preview: { bg: "#ffffff", accent: "#0969da", text: "#1f2328" },
  },
  {
    id: "dracula",
    name: "Dracula",
    preview: { bg: "#282a36", accent: "#bd93f9", text: "#f8f8f2" },
  },
  {
    id: "nord",
    name: "Nord",
    preview: { bg: "#2e3440", accent: "#88c0d0", text: "#eceff4" },
  },
  {
    id: "catppuccin",
    name: "Catppuccin",
    preview: { bg: "#1e1e2e", accent: "#cba6f7", text: "#cdd6f4" },
  },
  {
    id: "solarized",
    name: "Solarized Dark",
    preview: { bg: "#002b36", accent: "#268bd2", text: "#fdf6e3" },
  },
];

export function applyTheme(themeId: ThemeId) {
  document.documentElement.setAttribute("data-theme", themeId);
}
