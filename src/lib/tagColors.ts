import { CSSProperties } from "react";

interface TagPalette {
  bg: string;
  fg: string;
  border: string;
  bgSelected: string;
  fgSelected: string;
  borderSelected: string;
}

const TAG_PALETTES: TagPalette[] = [
  { bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5", bgSelected: "#fecaca", fgSelected: "#7f1d1d", borderSelected: "#ef4444" },
  { bg: "#ffedd5", fg: "#9a3412", border: "#fdba74", bgSelected: "#fed7aa", fgSelected: "#7c2d12", borderSelected: "#f97316" },
  { bg: "#fef3c7", fg: "#92400e", border: "#fcd34d", bgSelected: "#fde68a", fgSelected: "#78350f", borderSelected: "#f59e0b" },
  { bg: "#dcfce7", fg: "#166534", border: "#86efac", bgSelected: "#bbf7d0", fgSelected: "#14532d", borderSelected: "#22c55e" },
  { bg: "#ccfbf1", fg: "#115e59", border: "#5eead4", bgSelected: "#99f6e4", fgSelected: "#134e4a", borderSelected: "#14b8a6" },
  { bg: "#dbeafe", fg: "#1d4ed8", border: "#93c5fd", bgSelected: "#bfdbfe", fgSelected: "#1e40af", borderSelected: "#3b82f6" },
  { bg: "#e0e7ff", fg: "#4338ca", border: "#a5b4fc", bgSelected: "#c7d2fe", fgSelected: "#3730a3", borderSelected: "#6366f1" },
  { bg: "#f3e8ff", fg: "#7e22ce", border: "#d8b4fe", bgSelected: "#e9d5ff", fgSelected: "#6b21a8", borderSelected: "#a855f7" },
  { bg: "#fce7f3", fg: "#9d174d", border: "#f9a8d4", bgSelected: "#fbcfe8", fgSelected: "#831843", borderSelected: "#ec4899" },
  { bg: "#e5e7eb", fg: "#374151", border: "#cbd5e1", bgSelected: "#d1d5db", fgSelected: "#1f2937", borderSelected: "#94a3b8" },
];

function hashTag(tag: string): number {
  let hash = 0;
  const normalized = tag.trim().toLowerCase();

  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  }

  return hash;
}

export function getTagPalette(tag: string): TagPalette {
  return TAG_PALETTES[hashTag(tag) % TAG_PALETTES.length];
}

export function getTagStyle(tag: string, selected = false): CSSProperties {
  const palette = getTagPalette(tag);

  return selected
    ? {
        backgroundColor: palette.bgSelected,
        color: palette.fgSelected,
        borderColor: palette.borderSelected,
      }
    : {
        backgroundColor: palette.bg,
        color: palette.fg,
        borderColor: palette.border,
      };
}
