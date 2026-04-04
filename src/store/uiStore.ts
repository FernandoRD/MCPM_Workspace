import { create } from "zustand";

export type DashboardSortBy = "label-asc" | "label-desc" | "recent" | "oldest";

interface UIStore {
  dashboardSearch: string;
  dashboardSelectedGroup: string | null;
  dashboardSortBy: DashboardSortBy;
  dashboardSelectedTags: string[];
  commandPaletteOpen: boolean;
  setDashboardSearch: (v: string) => void;
  setDashboardSelectedGroup: (v: string | null) => void;
  setDashboardSortBy: (v: DashboardSortBy) => void;
  toggleDashboardTag: (tag: string) => void;
  clearDashboardTags: () => void;
  openCommandPalette: () => void;
  closeCommandPalette: () => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  dashboardSearch: "",
  dashboardSelectedGroup: null,
  dashboardSortBy: "label-asc",
  dashboardSelectedTags: [],
  commandPaletteOpen: false,
  setDashboardSearch: (v) => set({ dashboardSearch: v }),
  setDashboardSelectedGroup: (v) => set({ dashboardSelectedGroup: v }),
  setDashboardSortBy: (v) => set({ dashboardSortBy: v }),
  toggleDashboardTag: (tag) =>
    set((s) => ({
      dashboardSelectedTags: s.dashboardSelectedTags.includes(tag)
        ? s.dashboardSelectedTags.filter((t) => t !== tag)
        : [...s.dashboardSelectedTags, tag],
    })),
  clearDashboardTags: () => set({ dashboardSelectedTags: [] }),
  openCommandPalette: () => set({ commandPaletteOpen: true }),
  closeCommandPalette: () => set({ commandPaletteOpen: false }),
}));
