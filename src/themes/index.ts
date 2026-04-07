export const THEME_IDS = [
  "dark",
  "light",
  "dracula",
  "nord",
  "catppuccin",
  "solarized",
  "tokyo-night",
  "gruvbox",
  "rose-pine",
  "everforest",
  "kanagawa",
  "one-dark",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

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
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    preview: { bg: "#1a1b26", accent: "#7aa2f7", text: "#c0caf5" },
  },
  {
    id: "gruvbox",
    name: "Gruvbox Dark",
    preview: { bg: "#282828", accent: "#d79921", text: "#ebdbb2" },
  },
  {
    id: "rose-pine",
    name: "Rose Pine",
    preview: { bg: "#191724", accent: "#c4a7e7", text: "#e0def4" },
  },
  {
    id: "everforest",
    name: "Everforest",
    preview: { bg: "#2b3339", accent: "#a7c080", text: "#d3c6aa" },
  },
  {
    id: "kanagawa",
    name: "Kanagawa",
    preview: { bg: "#1f1f28", accent: "#7e9cd8", text: "#dcd7ba" },
  },
  {
    id: "one-dark",
    name: "One Dark",
    preview: { bg: "#282c34", accent: "#61afef", text: "#abb2bf" },
  },
];

export function isThemeId(value: string): value is ThemeId {
  return THEME_IDS.includes(value as ThemeId);
}

export function applyTheme(themeId: ThemeId) {
  document.documentElement.setAttribute("data-theme", themeId);
}
