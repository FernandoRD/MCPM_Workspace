import { useEffect, useRef } from "react";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { useSettingsStore } from "@/store/settings";
import { buildSyncPayload } from "@/lib/sync";
import { pushToProvider } from "@/lib/syncProviders";
import { notify } from "@/lib/notifications";
import { APP_NAME } from "@/lib/appInfo";
import { getSessionMasterPassword } from "@/lib/masterPasswordSession";
import i18n from "@/lib/i18n";

/**
 * Gerencia o sync automático periódico.
 *
 * Comportamento:
 * - Só inicia depois de existir um primeiro sync manual (`lastSyncAt`). Isso
 *   evita que uma instalação nova faça push de um vault vazio por acidente.
 * - Usa setInterval para os disparos periódicos subsequentes.
 * - Só faz push (dados locais → provider) quando uma senha mestra foi
 *   configurada. Se o sync de credenciais estiver ativo, exige que a senha
 *   mestra tenha sido informada nesta sessão para cifrar os segredos.
 * - Notifica apenas em caso de erro (sucesso é silencioso).
 * - O intervalo reinicia automaticamente se as configurações mudarem.
 */
export function useAutoSync() {
  const sync = useSettingsStore((s) => s.settings.sync);
  const security = useSettingsStore((s) => s.settings.security);
  const updateSync = useSettingsStore((s) => s.updateSync);

  const hostsRef = useRef(useHostsStore.getState().hosts);
  const credentialsRef = useRef(useCredentialsStore.getState().credentials);
  const sshKeysRef = useRef(useSshKeysStore.getState().sshKeys);
  const settingsRef = useRef(useSettingsStore.getState().settings);
  const updateSyncRef = useRef(updateSync);

  useEffect(() => useHostsStore.subscribe((s) => { hostsRef.current = s.hosts; }), []);
  useEffect(() => useCredentialsStore.subscribe((s) => { credentialsRef.current = s.credentials; }), []);
  useEffect(() => useSshKeysStore.subscribe((s) => { sshKeysRef.current = s.sshKeys; }), []);
  useEffect(() => useSettingsStore.subscribe((s) => {
    settingsRef.current = s.settings;
    updateSyncRef.current = s.updateSync;
  }), []);

  useEffect(() => {
    if (!sync.autoSync || !sync.provider) return;
    if (!sync.lastSyncAt) return;
    if (!security.masterPasswordSet) {
      notify(APP_NAME, i18n.t("sync.autoSync.blockedNoMasterPassword"));
      return;
    }

    const intervalMs = (sync.autoSyncIntervalMinutes ?? 30) * 60_000;

    const runSync = async () => {
      const currentSettings = settingsRef.current;
      if (!currentSettings.sync.autoSync || !currentSettings.sync.provider) return;
      if (!currentSettings.sync.lastSyncAt) return;
      if (!currentSettings.security.masterPasswordSet) return;

      const masterPassword = getSessionMasterPassword();
      if (currentSettings.security.syncCredentials && !masterPassword) {
        notify(APP_NAME, i18n.t("sync.autoSync.blockedNeedsSessionPassword"));
        return;
      }

      try {
        const payload = await buildSyncPayload(
          hostsRef.current,
          credentialsRef.current,
          sshKeysRef.current,
          currentSettings,
          masterPassword
        );
        const newGistId = await pushToProvider(currentSettings.sync, payload);
        if (newGistId) {
          updateSyncRef.current({
            gist: { ...currentSettings.sync.gist!, gistId: newGistId },
          });
        }
        updateSyncRef.current({ lastSyncAt: new Date().toISOString() });
      } catch (e) {
        notify(APP_NAME, i18n.t("sync.autoSync.errorWithMessage", { error: String(e) }));
      }
    };

    // Só considera sync automático depois de um primeiro sync manual. Em uma
    // instalação nova, `lastSyncAt` vazio nunca deve gerar push automático.
    const elapsed = sync.lastSyncAt
      ? Date.now() - new Date(sync.lastSyncAt).getTime()
      : 0;

    let immediateTimer: ReturnType<typeof setTimeout> | null = null;
    if (elapsed >= intervalMs) {
      immediateTimer = setTimeout(runSync, 0);
    }

    const periodicId = setInterval(runSync, intervalMs);

    return () => {
      if (immediateTimer !== null) clearTimeout(immediateTimer);
      clearInterval(periodicId);
    };
  }, [
    sync.autoSync,
    sync.provider,
    sync.autoSyncIntervalMinutes,
    sync.lastSyncAt,
    security.masterPasswordSet,
    security.syncCredentials,
  ]);
}
