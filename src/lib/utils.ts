import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(iso: string | undefined, locale: string = "pt-BR"): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function getHostColor(host: { color?: string; group?: string }): string {
  if (host.color) return host.color;
  const palette = [
    "#388bfd", "#3fb950", "#d29922", "#f85149",
    "#bd93f9", "#88c0d0", "#cba6f7", "#50fa7b",
  ];
  const seed = (host.group ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[seed % palette.length];
}
