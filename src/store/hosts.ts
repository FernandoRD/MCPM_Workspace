import { create } from "zustand";
import { persist } from "zustand/middleware";
import { SshHost } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface HostsStore {
  hosts: SshHost[];
  addHost: (host: Omit<SshHost, "id" | "createdAt" | "updatedAt" | "tags">) => SshHost;
  updateHost: (id: string, data: Partial<SshHost>) => void;
  deleteHost: (id: string) => void;
  duplicateHost: (id: string) => void;
  setLastConnected: (id: string) => void;
  getHost: (id: string) => SshHost | undefined;
  getGroups: () => string[];
}

export const useHostsStore = create<HostsStore>()(
  persist(
    (set, get) => ({
      hosts: [],

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
        return newHost;
      },

      updateHost: (id, data) =>
        set((s) => ({
          hosts: s.hosts.map((h) =>
            h.id === id ? { ...h, ...data, updatedAt: new Date().toISOString() } : h
          ),
        })),

      deleteHost: (id) =>
        set((s) => ({ hosts: s.hosts.filter((h) => h.id !== id) })),

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
      },

      setLastConnected: (id) =>
        set((s) => ({
          hosts: s.hosts.map((h) =>
            h.id === id
              ? { ...h, lastConnectedAt: new Date().toISOString() }
              : h
          ),
        })),

      getHost: (id) => get().hosts.find((h) => h.id === id),

      getGroups: () => {
        const groups = get()
          .hosts.map((h) => h.group)
          .filter((g): g is string => !!g);
        return [...new Set(groups)].sort();
      },
    }),
    { name: "ssh-vault-hosts" }
  )
);
