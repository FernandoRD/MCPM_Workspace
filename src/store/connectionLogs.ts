import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";

export interface ConnectionLog {
  id: string;
  hostId: string;
  hostLabel: string;
  hostAddress: string;
  /** "terminal" | "sftp" */
  sessionType: string;
  connectedAt: string;
  disconnectedAt?: string;
  durationSecs?: number;
  /** "connected" | "disconnected" | "error" */
  status: string;
}

interface ConnectionLogsStore {
  logs: ConnectionLog[];
  initialized: boolean;
  init: () => Promise<void>;
  /** Abre um log (conexão iniciada). Retorna o id gerado. */
  openLog: (entry: Omit<ConnectionLog, "id" | "disconnectedAt" | "durationSecs">) => string;
  /** Fecha um log existente com status e timestamp. */
  closeLog: (id: string, status: "disconnected" | "error") => void;
  clearLogs: () => void;
}

export const useConnectionLogsStore = create<ConnectionLogsStore>()((set, get) => ({
  logs: [],
  initialized: false,

  init: async () => {
    try {
      const logs = await invoke<ConnectionLog[]>("db_get_connection_logs", { limit: 200 });
      set({ logs, initialized: true });
    } catch {
      set({ initialized: true });
    }
  },

  openLog: (entry) => {
    const id = uuidv4();
    const log: ConnectionLog = { ...entry, id };
    set((s) => ({ logs: [log, ...s.logs] }));
    invoke("db_add_connection_log", { log }).catch(console.error);
    return id;
  },

  closeLog: (id, status) => {
    const disconnectedAt = new Date().toISOString();
    set((s) => {
      const logs = s.logs.map((l) => {
        if (l.id !== id) return l;
        const durationSecs = Math.round(
          (new Date(disconnectedAt).getTime() - new Date(l.connectedAt).getTime()) / 1000
        );
        return { ...l, disconnectedAt, durationSecs, status };
      });
      const updated = logs.find((l) => l.id === id);
      if (updated) invoke("db_add_connection_log", { log: updated }).catch(console.error);
      return { logs };
    });
  },

  clearLogs: () => {
    set({ logs: [] });
    invoke("db_clear_connection_logs").catch(console.error);
  },
}));
