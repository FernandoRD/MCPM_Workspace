import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { Credential } from "@/types";
import { sanitizeCredentialInput, sanitizeCredentials } from "@/lib/inputSanitizers";
import { logFrontendError } from "@/lib/logger";
import { v4 as uuidv4 } from "uuid";

interface CredentialsStore {
  credentials: Credential[];
  initialized: boolean;
  init: () => Promise<void>;
  addCredential: (data: Omit<Credential, "id" | "createdAt" | "updatedAt">) => string;
  updateCredential: (id: string, data: Partial<Omit<Credential, "id" | "createdAt" | "updatedAt">>) => void;
  deleteCredential: (id: string) => void;
  getCredential: (id: string) => Credential | undefined;
  /** Substitui todas as credenciais (usado pelo sync remoto) */
  replaceCredentials: (credentials: Credential[]) => void;
}

export const useCredentialsStore = create<CredentialsStore>()((set, get) => ({
  credentials: [],
  initialized: false,

  init: async () => {
    try {
      const credentials = sanitizeCredentials(await invoke<Credential[]>("db_get_credentials"));

      if (credentials.length === 0) {
        // Migra do localStorage se existir
        const legacy = localStorage.getItem("ssh-vault-credentials");
        if (legacy) {
          try {
            const parsed = JSON.parse(legacy);
            const legacyCredentials = sanitizeCredentials(parsed.state?.credentials ?? []);
            if (legacyCredentials.length > 0) {
              for (const credential of legacyCredentials) {
                await invoke("db_save_credential", { credential });
              }
              localStorage.removeItem("ssh-vault-credentials");
              set({ credentials: legacyCredentials, initialized: true });
              return;
            }
          } catch {
            // ignora erros de parse
          }
        }
      }

      set({ credentials, initialized: true });
    } catch (e) {
      logFrontendError("credentials.init", "Falha ao inicializar credentials store", e);
      set({ initialized: true });
    }
  },

  addCredential: (data) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const credential = sanitizeCredentialInput<Credential>({ ...data, id, createdAt: now, updatedAt: now });
    set((s) => ({ credentials: [...s.credentials, credential] }));
    invoke("db_save_credential", { credential }).catch((error) => {
      logFrontendError("credentials.add", "Falha ao salvar credencial", error, { id });
    });
    return id;
  },

  updateCredential: (id, data) =>
    set((s) => {
      const credentials = s.credentials.map((c) =>
        c.id === id
          ? sanitizeCredentialInput({ ...c, ...data, updatedAt: new Date().toISOString() })
          : c
      );
      const updated = credentials.find((c) => c.id === id);
      if (updated) {
        invoke("db_save_credential", { credential: updated }).catch((error) => {
          logFrontendError("credentials.update", "Falha ao atualizar credencial", error, { id });
        });
      }
      return { credentials };
    }),

  deleteCredential: (id) => {
    set((s) => ({ credentials: s.credentials.filter((c) => c.id !== id) }));
    invoke("db_delete_credential", { id }).catch((error) => {
      logFrontendError("credentials.delete", "Falha ao remover credencial", error, { id });
    });
  },

  getCredential: (id) => get().credentials.find((c) => c.id === id),

  /** Substitui todas as credenciais (usado pelo sync remoto) */
  replaceCredentials: (credentials) => {
    const sanitizedCredentials = sanitizeCredentials(credentials);
    set({ credentials: sanitizedCredentials });
    invoke("db_clear_credentials")
      .then(() => Promise.all(sanitizedCredentials.map((credential) => invoke("db_save_credential", { credential }))))
      .catch((error) => {
        logFrontendError("credentials.replace", "Falha ao substituir credenciais", error, {
          count: sanitizedCredentials.length,
        });
      });
  },
}));
