import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { SshHost } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface HostsStore {
  hosts: SshHost[];
  initialized: boolean;
  init: () => Promise<void>;
  addHost: (host: Omit<SshHost, "id" | "createdAt" | "updatedAt" | "tags">) => SshHost;
  updateHost: (id: string, data: Partial<SshHost>) => void;
  deleteHost: (id: string) => void;
  duplicateHost: (id: string) => void;
  setLastConnected: (id: string) => void;
  getHost: (id: string) => SshHost | undefined;
  getGroups: () => string[];
  /** Substitui todos os hosts (usado pelo sync remoto) */
  replaceHosts: (hosts: SshHost[]) => void;
}

export const useHostsStore = create<HostsStore>()((set, get) => ({
  hosts: [],
  initialized: false,

  init: async () => {
    try {
      const hosts = await invoke<SshHost[]>("db_get_hosts");

      if (hosts.length === 0) {
        // Migra dados do localStorage se existirem
        const legacy = localStorage.getItem("ssh-vault-hosts");
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            const legacyHosts: SshHost[] = parsed.state?.hosts ?? [];
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
      console.error("Falha ao inicializar hosts store:", e);
      set({ initialized: true });
    }
  },

  addHost: (data) => {
    const now = new Date().toISOString();
    const newHost: SshHost = {
      ...data,
      id: uuidv4(),
      tags: [],
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ hosts: [...s.hosts, newHost] }));
    invoke("db_save_host", { host: newHost }).catch(console.error);
    return newHost;
  },

  updateHost: (id, data) =>
    set((s) => {
      const hosts = s.hosts.map((h) =>
        h.id === id ? { ...h, ...data, updatedAt: new Date().toISOString() } : h
      );
      const updated = hosts.find((h) => h.id === id);
      if (updated) invoke("db_save_host", { host: updated }).catch(console.error);
      return { hosts };
    }),

  deleteHost: (id) => {
    set((s) => ({ hosts: s.hosts.filter((h) => h.id !== id) }));
    invoke("db_delete_host", { id }).catch(console.error);
  },

  duplicateHost: (id) => {
    const original = get().hosts.find((h) => h.id === id);
    if (!original) return;
    const now = new Date().toISOString();
    const copy: SshHost = {
      ...original,
      id: uuidv4(),
      label: `${original.label} (cópia)`,
      createdAt: now,
      updatedAt: now,
      lastConnectedAt: undefined,
    };
    set((s) => ({ hosts: [...s.hosts, copy] }));
    invoke("db_save_host", { host: copy }).catch(console.error);
  },

  setLastConnected: (id) =>
    set((s) => {
      const hosts = s.hosts.map((h) =>
        h.id === id ? { ...h, lastConnectedAt: new Date().toISOString() } : h
      );
      const updated = hosts.find((h) => h.id === id);
      if (updated) invoke("db_save_host", { host: updated }).catch(console.error);
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
    set({ hosts });
    invoke("db_clear_hosts")
      .then(() => Promise.all(hosts.map((host) => invoke("db_save_host", { host }))))
      .catch(console.error);
  },
}));
