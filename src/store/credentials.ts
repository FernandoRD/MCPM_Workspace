import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Credential } from "@/types";
import { v4 as uuidv4 } from "uuid";

interface CredentialsStore {
  credentials: Credential[];
  addCredential: (data: Omit<Credential, "id" | "createdAt" | "updatedAt">) => string;
  updateCredential: (id: string, data: Partial<Omit<Credential, "id" | "createdAt" | "updatedAt">>) => void;
  deleteCredential: (id: string) => void;
  getCredential: (id: string) => Credential | undefined;
}

export const useCredentialsStore = create<CredentialsStore>()(
  persist(
    (set, get) => ({
      credentials: [],
      addCredential: (data) => {
        const id = uuidv4();
        const now = new Date().toISOString();
        const credential: Credential = { ...data, id, createdAt: now, updatedAt: now };
        set((s) => ({ credentials: [...s.credentials, credential] }));
        return id;
      },
      updateCredential: (id, data) =>
        set((s) => ({
          credentials: s.credentials.map((c) =>
            c.id === id ? { ...c, ...data, updatedAt: new Date().toISOString() } : c
          ),
        })),
      deleteCredential: (id) =>
        set((s) => ({ credentials: s.credentials.filter((c) => c.id !== id) })),
      getCredential: (id) => get().credentials.find((c) => c.id === id),
    }),
    { name: "ssh-vault-credentials" }
  )
);
