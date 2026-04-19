import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { logFrontendError } from "@/lib/logger";

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
  message?: string;
  /** "connected" | "disconnected" | "error" */
  status: string;
}

interface ConnectionLogsStore {
  logs: ConnectionLog[];
  initialized: boolean;
  init: () => Promise<void>;
  /** Registra um log e retorna o id gerado. */
  openLog: (entry: Omit<ConnectionLog, "id" | "disconnectedAt" | "durationSecs">) => string;
  /** Fecha um log existente com status, timestamp e mensagem opcional. */
  closeLog: (id: string, status: "disconnected" | "error", message?: string) => void;
  clearLogs: () => void;
}

export const useConnectionLogsStore = create<ConnectionLogsStore>()((set, _get) => ({
  logs: [],
  initialized: false,

  init: async () => {
    try {
      const logs = await invoke<ConnectionLog[]>("db_get_connection_logs", { limit: 200 });
      set({ logs, initialized: true });
    } catch (error) {
      logFrontendError("connectionLogs.init", "Falha ao inicializar log de conexões", error);
      set({ initialized: true });
    }
  },

  openLog: (entry) => {
    const id = uuidv4();
    const log: ConnectionLog = { ...entry, id };
    set((s) => ({ logs: [log, ...s.logs] }));
    invoke("db_add_connection_log", { log }).catch((error) => {
      logFrontendError("connectionLogs.openLog", "Falha ao persistir log de conexão", error, {
        logId: id,
        hostId: entry.hostId,
        sessionType: entry.sessionType,
      });
    });
    return id;
  },

  closeLog: (id, status, message) => {
    const disconnectedAt = new Date().toISOString();
    set((s) => {
      const logs = s.logs.map((l) => {
        if (l.id !== id) return l;
        const durationSecs = Math.round(
          (new Date(disconnectedAt).getTime() - new Date(l.connectedAt).getTime()) / 1000
        );
        return { ...l, disconnectedAt, durationSecs, status, message: message ?? l.message };
      });
      const updated = logs.find((l) => l.id === id);
      if (updated) {
        invoke("db_add_connection_log", { log: updated }).catch((error) => {
          logFrontendError("connectionLogs.closeLog", "Falha ao atualizar log de conexão", error, {
            logId: id,
            status,
          });
        });
      }
      return { logs };
    });
  },

  clearLogs: () => {
    set({ logs: [] });
    invoke("db_clear_connection_logs").catch((error) => {
      logFrontendError("connectionLogs.clearLogs", "Falha ao limpar log de conexões", error);
    });
  },
}));
