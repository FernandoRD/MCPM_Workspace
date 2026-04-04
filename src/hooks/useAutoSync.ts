import { useEffect, useRef } from "react";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSettingsStore } from "@/store/settings";
import { buildSyncPayload } from "@/lib/sync";
import { pushToProvider } from "@/lib/syncProviders";
import { notify } from "@/lib/notifications";

/**
 * Gerencia o sync automático periódico.
 * - Roda em background usando setInterval.
 * - Sempre faz push (envia dados locais ao provider) sem senha mestra.
 *   Se o usuário tiver "sincronizar credenciais" ativado com senha mestra,
 *   as credenciais são incluídas em texto claro (sem criptografia adicional)
 *   pois não há como pedir a senha em background.
 * - Notifica apenas em caso de erro (sucesso é silencioso para não ser invasivo).
 * - O intervalo reinicia automaticamente se as configurações mudarem.
 */
export function useAutoSync() {
  const sync = useSettingsStore((s) => s.settings.sync);
  const updateSync = useSettingsStore((s) => s.updateSync);

  // Refs garantem que o callback do interval sempre leia os valores mais atuais
  const hostsRef = useRef(useHostsStore.getState().hosts);
  const credentialsRef = useRef(useCredentialsStore.getState().credentials);
  const settingsRef = useRef(useSettingsStore.getState().settings);
  const updateSyncRef = useRef(updateSync);

  useEffect(
    () =>
      useHostsStore.subscribe((s) => {
        hostsRef.current = s.hosts;
      }),
    []
  );
  useEffect(
    () =>
      useCredentialsStore.subscribe((s) => {
        credentialsRef.current = s.credentials;
      }),
    []
  );
  useEffect(
    () =>
      useSettingsStore.subscribe((s) => {
        settingsRef.current = s.settings;
        updateSyncRef.current = s.updateSync;
      }),
    []
  );

  useEffect(() => {
    if (!sync.autoSync || !sync.provider) return;

    const intervalMs = (sync.autoSyncIntervalMinutes ?? 30) * 60_000;

    const runSync = async () => {
      const currentSettings = settingsRef.current;
      // Verifica novamente no momento da execução (pode ter sido desativado)
      if (!currentSettings.sync.autoSync || !currentSettings.sync.provider) return;

      try {
        const payload = await buildSyncPayload(
          hostsRef.current,
          credentialsRef.current,
          currentSettings,
          null // sem senha mestra no sync automático
        );
        const newGistId = await pushToProvider(currentSettings.sync, payload);
        if (newGistId) {
          updateSyncRef.current({
            gist: { ...currentSettings.sync.gist!, gistId: newGistId },
          });
        }
        updateSyncRef.current({ lastSyncAt: new Date().toISOString() });
      } catch (e) {
        notify("SSH Vault", `Erro no sync automático: ${String(e)}`);
      }
    };

    const id = setInterval(runSync, intervalMs);
    return () => clearInterval(id);
  }, [sync.autoSync, sync.provider, sync.autoSyncIntervalMinutes]);
}
