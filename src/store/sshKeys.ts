import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { SshKey } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface SshKeysStore {
  sshKeys: SshKey[];
  initialized: boolean;
  init: () => Promise<void>;
  addSshKey: (data: Omit<SshKey, "id" | "createdAt" | "updatedAt">) => string;
  updateSshKey: (id: string, data: Partial<Omit<SshKey, "id" | "createdAt" | "updatedAt">>) => void;
  deleteSshKey: (id: string) => void;
  getSshKey: (id: string) => SshKey | undefined;
  replaceSshKeys: (keys: SshKey[]) => void;
}

export const useSshKeysStore = create<SshKeysStore>()((set, get) => ({
  sshKeys: [],
  initialized: false,

  init: async () => {
    try {
      const sshKeys = await invoke<SshKey[]>("db_get_ssh_keys");
      set({ sshKeys, initialized: true });
    } catch (e) {
      console.error("Falha ao inicializar sshKeys store:", e);
      set({ initialized: true });
    }
  },

  addSshKey: (data) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const sshKey: SshKey = { ...data, id, createdAt: now, updatedAt: now };
    set((s) => ({ sshKeys: [...s.sshKeys, sshKey] }));
    invoke("db_save_ssh_key", { sshKey }).catch(console.error);
    return id;
  },

  updateSshKey: (id, data) =>
    set((s) => {
      const sshKeys = s.sshKeys.map((k) =>
        k.id === id ? { ...k, ...data, updatedAt: new Date().toISOString() } : k
      );
      const updated = sshKeys.find((k) => k.id === id);
      if (updated) invoke("db_save_ssh_key", { sshKey: updated }).catch(console.error);
      return { sshKeys };
    }),

  deleteSshKey: (id) => {
    set((s) => ({ sshKeys: s.sshKeys.filter((k) => k.id !== id) }));
    invoke("db_delete_ssh_key", { id }).catch(console.error);
  },

  getSshKey: (id) => get().sshKeys.find((k) => k.id === id),

  replaceSshKeys: (sshKeys) => {
    set({ sshKeys });
    invoke("db_clear_ssh_keys")
      .then(() => Promise.all(sshKeys.map((sshKey) => invoke("db_save_ssh_key", { sshKey }))))
      .catch(console.error);
  },
}));
