import { create } from "zustand";

interface UIStore {
  dashboardSearch: string;
  dashboardSelectedGroup: string | null;
  setDashboardSearch: (v: string) => void;
  setDashboardSelectedGroup: (v: string | null) => void;
}

export const useUIStore = create<UIStore>()((set) => ({
  dashboardSearch: "",
  dashboardSelectedGroup: null,
  setDashboardSearch: (v) => set({ dashboardSearch: v }),
  setDashboardSelectedGroup: (v) => set({ dashboardSelectedGroup: v }),
}));
