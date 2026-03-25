import { create } from "zustand";
import { SessionTab } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface SessionsStore {
  tabs: SessionTab[];
  activeTabId: string | null;
  openSession: (hostId: string, hostLabel: string, hostAddress: string) => string;
  closeSession: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabStatus: (tabId: string, status: SessionTab["status"]) => void;
}

export const useSessionsStore = create<SessionsStore>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  openSession: (hostId, hostLabel, hostAddress) => {
    const id = uuidv4();
    const tab: SessionTab = {
      id,
      hostId,
      hostLabel,
      hostAddress,
      status: "connecting",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  closeSession: (tabId) => {
    const { tabs, activeTabId } = get();
    const remaining = tabs.filter((t) => t.id !== tabId);
    let nextActive = activeTabId;
    if (activeTabId === tabId) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      nextActive = remaining[idx]?.id ?? remaining[idx - 1]?.id ?? null;
    }
    set({ tabs: remaining, activeTabId: nextActive });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updateTabStatus: (tabId, status) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, status } : t)),
    })),
}));
