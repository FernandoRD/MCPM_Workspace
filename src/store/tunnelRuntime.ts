import { create } from "zustand";

export type TunnelRuntimeStatus = "idle" | "starting" | "running" | "stopped" | "error";

export interface TunnelRuntimeState {
  tunnelId: string;
  status: TunnelRuntimeStatus;
  message?: string;
  updatedAt: string;
}

interface TunnelRuntimeStore {
  runtimes: Record<string, TunnelRuntimeState>;
  setTunnelStatus: (tunnelId: string, status: TunnelRuntimeStatus, message?: string) => void;
  clearTunnel: (tunnelId: string) => void;
}

export const useTunnelRuntimeStore = create<TunnelRuntimeStore>()((set) => ({
  runtimes: {},

  setTunnelStatus: (tunnelId, status, message) =>
    set((state) => ({
      runtimes: {
        ...state.runtimes,
        [tunnelId]: {
          tunnelId,
          status,
          message,
          updatedAt: new Date().toISOString(),
        },
      },
    })),

  clearTunnel: (tunnelId) =>
    set((state) => ({
      runtimes: Object.fromEntries(
        Object.entries(state.runtimes).filter(([key]) => key !== tunnelId)
      ),
    })),
}));
