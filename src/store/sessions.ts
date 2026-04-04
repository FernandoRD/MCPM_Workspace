import { create } from "zustand";
import { SessionConnection, SessionTab, SplitDirection } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface SessionsStore {
  tabs: SessionTab[];
  activeTabId: string | null;
  /** Abre uma aba de terminal. O primeiro pane.id === tab.id (compat. retroativa). */
  openSession: (hostId: string, hostLabel: string, hostAddress: string) => string;
  /** Abre uma aba de terminal temporária sem host salvo. */
  openQuickConnectSession: (connection: SessionConnection, hostLabel: string, hostAddress: string) => string;
  /** Abre uma aba de SFTP. */
  openSftpTab: (hostId: string, hostLabel: string, hostAddress: string) => string;
  /** Garante que um tab exista na store atual. Útil para janelas dedicadas. */
  ensureSession: (tab: SessionTab) => void;
  closeSession: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  /** Atualiza status do pane pelo paneId (busca em todos os tabs). */
  updatePaneStatus: (paneId: string, status: SessionTab["status"]) => void;
  /** Compat. retroativa — delega para updatePaneStatus. */
  updateTabStatus: (tabId: string, status: SessionTab["status"]) => void;
  /** Adiciona um pane ao tab (split). Retorna o novo paneId. */
  addPane: (tabId: string, direction: SplitDirection) => string;
  /** Remove um pane do tab. Se for o último, fecha o tab. */
  closePane: (tabId: string, paneId: string) => void;
}

export const useSessionsStore = create<SessionsStore>()((set, get) => ({
  tabs: [],
  activeTabId: null,

  openSession: (hostId, hostLabel, hostAddress) => {
    const id = uuidv4();
    const tab: SessionTab = {
      id,
      type: "terminal",
      hostId,
      hostLabel,
      hostAddress,
      status: "connecting",
      panes: [{ id, status: "connecting" }],
      splitDirection: "horizontal",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  openQuickConnectSession: (connection, hostLabel, hostAddress) => {
    const id = uuidv4();
    const tab: SessionTab = {
      id,
      type: "terminal",
      hostId: `quick-connect:${id}`,
      hostLabel,
      hostAddress,
      connection,
      status: "connecting",
      panes: [{ id, status: "connecting" }],
      splitDirection: "horizontal",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  openSftpTab: (hostId, hostLabel, hostAddress) => {
    const id = uuidv4();
    const tab: SessionTab = {
      id,
      type: "sftp",
      hostId,
      hostLabel,
      hostAddress,
      status: "connecting",
      panes: [],
      splitDirection: "horizontal",
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: id }));
    return id;
  },

  ensureSession: (tab) =>
    set((s) => {
      if (s.tabs.some((entry) => entry.id === tab.id)) {
        return { activeTabId: tab.id };
      }
      return { tabs: [...s.tabs, tab], activeTabId: tab.id };
    }),

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

  updatePaneStatus: (paneId, status) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        const hasPane = tab.panes.some((p) => p.id === paneId);
        if (!hasPane && tab.id !== paneId) return tab;
        // sftp tab: update tab status directly
        if (tab.type === "sftp") return { ...tab, status };
        const panes = tab.panes.map((p) => p.id === paneId ? { ...p, status } : p);
        // Tab status = first pane status
        const tabStatus = panes[0]?.status ?? status;
        return { ...tab, panes, status: tabStatus };
      }),
    })),

  updateTabStatus: (tabId, status) => get().updatePaneStatus(tabId, status),

  addPane: (tabId, direction) => {
    const newPaneId = uuidv4();
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          splitDirection: direction,
          panes: [...tab.panes, { id: newPaneId, status: "connecting" }],
        };
      }),
    }));
    return newPaneId;
  },

  closePane: (tabId, paneId) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.panes.length <= 1) {
      // Last pane — close the whole tab
      get().closeSession(tabId);
      return;
    }
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const panes = t.panes.filter((p) => p.id !== paneId);
        return { ...t, panes, status: panes[0]?.status ?? "disconnected" };
      }),
    }));
  },
}));
