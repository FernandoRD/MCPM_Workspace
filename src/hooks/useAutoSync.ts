import { useEffect, useRef } from "react";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSettingsStore } from "@/store/settings";
import { buildSyncPayload } from "@/lib/sync";
import { pushToProvider } from "@/lib/syncProviders";
import { notify } from "@/lib/notifications";

/**
 * Gerencia o sync automático periódico.
 *
 * Comportamento:
 * - Ao ativar (ou reiniciar o app com autoSync já ligado), verifica se o tempo
 *   decorrido desde o último sync já excede o intervalo configurado. Se sim,
 *   dispara um sync imediato antes de iniciar o timer periódico.
 * - Usa setInterval para os disparos periódicos subsequentes.
 * - Só faz push (dados locais → provider). Não pede senha mestra em background;
 *   credenciais são incluídas sem criptografia extra se syncCredentials estiver
 *   ativo — o aviso fica visível na UI.
 * - Notifica apenas em caso de erro (sucesso é silencioso).
 * - O intervalo reinicia automaticamente se as configurações mudarem.
 */
export function useAutoSync() {
  const sync = useSettingsStore((s) => s.settings.sync);
  const updateSync = useSettingsStore((s) => s.updateSync);

  const hostsRef = useRef(useHostsStore.getState().hosts);
  const credentialsRef = useRef(useCredentialsStore.getState().credentials);
  const settingsRef = useRef(useSettingsStore.getState().settings);
  const updateSyncRef = useRef(updateSync);

  useEffect(() => useHostsStore.subscribe((s) => { hostsRef.current = s.hosts; }), []);
  useEffect(() => useCredentialsStore.subscribe((s) => { credentialsRef.current = s.credentials; }), []);
  useEffect(() => useSettingsStore.subscribe((s) => {
    settingsRef.current = s.settings;
    updateSyncRef.current = s.updateSync;
  }), []);

  useEffect(() => {
    if (!sync.autoSync || !sync.provider) return;

    const intervalMs = (sync.autoSyncIntervalMinutes ?? 30) * 60_000;

    const runSync = async () => {
      const currentSettings = settingsRef.current;
      if (!currentSettings.sync.autoSync || !currentSettings.sync.provider) return;

      try {
        const payload = await buildSyncPayload(
          hostsRef.current,
          credentialsRef.current,
          currentSettings,
          null
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

    // Dispara imediatamente se o tempo decorrido desde o último sync já
    // ultrapassa o intervalo configurado (cobre reinícios do app).
    const elapsed = sync.lastSyncAt
      ? Date.now() - new Date(sync.lastSyncAt).getTime()
      : Infinity;

    let immediateTimer: ReturnType<typeof setTimeout> | null = null;
    if (elapsed >= intervalMs) {
      immediateTimer = setTimeout(runSync, 0);
    }

    const periodicId = setInterval(runSync, intervalMs);

    return () => {
      if (immediateTimer !== null) clearTimeout(immediateTimer);
      clearInterval(periodicId);
    };
  }, [sync.autoSync, sync.provider, sync.autoSyncIntervalMinutes]);
}
