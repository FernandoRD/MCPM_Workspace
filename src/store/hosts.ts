import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { HostEntry } from "@/types";
import { sanitizeHostInput, sanitizeHosts } from "@/lib/inputSanitizers";
import { logFrontendError } from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";

interface HostsStore {
  hosts: HostEntry[];
  initialized: boolean;
  init: () => Promise<void>;
  addHost: (host: Omit<HostEntry, "id" | "createdAt" | "updatedAt" | "tags">) => HostEntry;
  updateHost: (id: string, data: Partial<HostEntry>) => void;
  deleteHost: (id: string) => void;
  duplicateHost: (id: string) => void;
  setLastConnected: (id: string) => void;
  getHost: (id: string) => HostEntry | undefined;
  getGroups: () => string[];
  /** Substitui todos os hosts (usado pelo sync remoto) */
  replaceHosts: (hosts: HostEntry[]) => void;
}

export const useHostsStore = create<HostsStore>()((set, get) => ({
  hosts: [],
  initialized: false,

  init: async () => {
    try {
      const hosts = sanitizeHosts(await invoke<HostEntry[]>("db_get_hosts"));

      if (hosts.length === 0) {
        // Migra dados do localStorage se existirem
        const legacy = localStorage.getItem("ssh-vault-hosts");
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            const legacyHosts = sanitizeHosts(parsed.state?.hosts ?? []);
            if (legacyHosts.length > 0) {
              for (const host of legacyHosts) {
                await invoke("db_save_host", { host });
              }
              localStorage.removeItem("ssh-vault-hosts");
              set({ hosts: legacyHosts, initialized: true });
              return;
            }
          } catch {
            // ignora erros de parse
          }
        }
      }

      set({ hosts, initialized: true });
    } catch (e) {
      logFrontendError("hosts.init", "Falha ao inicializar hosts store", e);
      set({ initialized: true });
    }
  },

  addHost: (data) => {
    const now = new Date().toISOString();
    const newHost = sanitizeHostInput<HostEntry>({
      ...data,
      id: uuidv4(),
      tags: [],
      createdAt: now,
      updatedAt: now,
    });
    set((s) => ({ hosts: [...s.hosts, newHost] }));
    invoke("db_save_host", { host: newHost }).catch((error) => {
      logFrontendError("hosts.add", "Falha ao salvar host", error, { id: newHost.id });
    });
    return newHost;
  },

  updateHost: (id, data) =>
    set((s) => {
      const hosts = s.hosts.map((h) =>
        h.id === id
          ? sanitizeHostInput({ ...h, ...data, updatedAt: new Date().toISOString() })
          : h
      );
      const updated = hosts.find((h) => h.id === id);
      if (updated) {
        invoke("db_save_host", { host: updated }).catch((error) => {
          logFrontendError("hosts.update", "Falha ao atualizar host", error, { id });
        });
      }
      return { hosts };
    }),

  deleteHost: (id) => {
    set((s) => ({ hosts: s.hosts.filter((h) => h.id !== id) }));
    invoke("db_delete_host", { id }).catch((error) => {
      logFrontendError("hosts.delete", "Falha ao remover host", error, { id });
    });
  },

  duplicateHost: (id) => {
    const original = get().hosts.find((h) => h.id === id);
    if (!original) return;
    const now = new Date().toISOString();
    const copy = sanitizeHostInput<HostEntry>({
      ...original,
      id: uuidv4(),
      label: `${original.label} (cópia)`,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: undefined,
    });
    set((s) => ({ hosts: [...s.hosts, copy] }));
    invoke("db_save_host", { host: copy }).catch((error) => {
      logFrontendError("hosts.duplicate", "Falha ao duplicar host", error, { id: copy.id });
    });
  },

  setLastConnected: (id) =>
    set((s) => {
      const hosts = s.hosts.map((h) =>
        h.id === id ? { ...h, lastConnectedAt: new Date().toISOString() } : h
      );
      const updated = hosts.find((h) => h.id === id);
      if (updated) {
        invoke("db_save_host", { host: updated }).catch((error) => {
          logFrontendError("hosts.setLastConnected", "Falha ao atualizar último acesso do host", error, { id });
        });
      }
      return { hosts };
    }),

  getHost: (id) => get().hosts.find((h) => h.id === id),

  getGroups: () => {
    const groups = get()
      .hosts.map((h) => h.group)
      .filter((g): g is string => !!g);
    return [...new Set(groups)].sort();
  },

  replaceHosts: (hosts) => {
    const sanitizedHosts = sanitizeHosts(hosts);
    set({ hosts: sanitizedHosts });
    invoke("db_clear_hosts")
      .then(() => Promise.all(sanitizedHosts.map((host) => invoke("db_save_host", { host }))))
      .catch((error) => {
        logFrontendError("hosts.replace", "Falha ao substituir hosts", error, {
          count: sanitizedHosts.length,
        });
      });
  },
}));
