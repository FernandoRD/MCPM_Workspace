import { create } from "zustand";
import { SessionConnection, SessionTab, SplitDirection, SftpTabSnapshot, TabType, TerminalPaneSnapshot } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface SessionsStore {
  tabs: SessionTab[];
  activeTabId: string | null;
  terminalSnapshots: Record<string, TerminalPaneSnapshot>;
  sftpSnapshots: Record<string, SftpTabSnapshot>;
  /** Abre uma aba de terminal. O primeiro pane.id === tab.id (compat. retroativa). */
  openSession: (hostId: string, hostLabel: string, hostAddress: string) => string;
  /** Abre uma aba de terminal temporária sem host salvo. */
  openQuickConnectSession: (
    connection: SessionConnection,
    hostLabel: string,
    hostAddress: string,
    type?: Extract<TabType, "terminal" | "rdp">
  ) => string;
  /** Abre uma aba de SFTP. */
  openSftpTab: (hostId: string, hostLabel: string, hostAddress: string) => string;
  /** Abre uma aba de RDP. */
  openRdpTab: (hostId: string, hostLabel: string, hostAddress: string) => string;
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
  appendTerminalOutput: (paneId: string, chunkBase64: string) => void;
  clearTerminalSnapshot: (paneId: string) => void;
  updateSftpSnapshot: (tabId: string, snapshot: Partial<SftpTabSnapshot>) => void;
  clearSftpSnapshot: (tabId: string) => void;
}

const MAX_TERMINAL_SNAPSHOT_CHARS = 1_000_000;

export const useSessionsStore = create<SessionsStore>()((set, get) => ({
  tabs: [],
  activeTabId: null,
  terminalSnapshots: {},
  sftpSnapshots: {},

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

  openQuickConnectSession: (connection, hostLabel, hostAddress, type = "terminal") => {
    const id = uuidv4();
    const tab: SessionTab = {
      id,
      type,
      hostId: `quick-connect:${id}`,
      hostLabel,
      hostAddress,
      connection,
      status: "connecting",
      panes: type === "terminal" ? [{ id, status: "connecting" }] : [],
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

  openRdpTab: (hostId, hostLabel, hostAddress) => {
    const id = uuidv4();
    const tab: SessionTab = {
      id,
      type: "rdp",
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
    const closingTab = tabs.find((t) => t.id === tabId);
    const remaining = tabs.filter((t) => t.id !== tabId);
    let nextActive = activeTabId;
    if (activeTabId === tabId) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      nextActive = remaining[idx]?.id ?? remaining[idx - 1]?.id ?? null;
    }
    set((s) => {
      const terminalSnapshots = { ...s.terminalSnapshots };
      const sftpSnapshots = { ...s.sftpSnapshots };
      if (closingTab?.type === "terminal") {
        for (const pane of closingTab.panes) {
          delete terminalSnapshots[pane.id];
        }
      }
      delete sftpSnapshots[tabId];
      return { tabs: remaining, activeTabId: nextActive, terminalSnapshots, sftpSnapshots };
    });
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  updatePaneStatus: (paneId, status) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        const hasPane = tab.panes.some((p) => p.id === paneId);
        if (!hasPane && tab.id !== paneId) return tab;
        // non-terminal tabs: update tab status directly
        if (tab.type !== "terminal") return { ...tab, status };
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
      terminalSnapshots: Object.fromEntries(
        Object.entries(s.terminalSnapshots).filter(([id]) => id !== paneId)
      ),
    }));
  },

  appendTerminalOutput: (paneId, chunkBase64) =>
    set((s) => {
      const currentChunks = s.terminalSnapshots[paneId]?.outputBase64Chunks ?? [];
      const nextChunks = [...currentChunks, chunkBase64];
      let totalChars = nextChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      while (totalChars > MAX_TERMINAL_SNAPSHOT_CHARS && nextChunks.length > 1) {
        const removed = nextChunks.shift();
        totalChars -= removed?.length ?? 0;
      }

      return {
        terminalSnapshots: {
          ...s.terminalSnapshots,
          [paneId]: {
            outputBase64Chunks: nextChunks,
          },
        },
      };
    }),

  clearTerminalSnapshot: (paneId) =>
    set((s) => ({
      terminalSnapshots: Object.fromEntries(
        Object.entries(s.terminalSnapshots).filter(([id]) => id !== paneId)
      ),
    })),

  updateSftpSnapshot: (tabId, snapshot) =>
    set((s) => ({
      sftpSnapshots: {
        ...s.sftpSnapshots,
        [tabId]: {
          currentPath: snapshot.currentPath ?? s.sftpSnapshots[tabId]?.currentPath ?? "/",
          entries: snapshot.entries ?? s.sftpSnapshots[tabId]?.entries ?? [],
        },
      },
    })),

  clearSftpSnapshot: (tabId) =>
    set((s) => ({
      sftpSnapshots: Object.fromEntries(
        Object.entries(s.sftpSnapshots).filter(([id]) => id !== tabId)
      ),
    })),
}));
