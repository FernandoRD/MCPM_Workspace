import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ExternalLink, Loader2, Monitor, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { APP_NAME } from "@/lib/appInfo";
import { notify } from "@/lib/notifications";
import { readSessionBootstrap, withStandaloneQuery } from "@/lib/windowMode";
import { useConnectionLogsStore } from "@/store/connectionLogs";
import { useCredentialsStore } from "@/store/credentials";
import { useHostsStore } from "@/store/hosts";
import { useSessionsStore } from "@/store/sessions";
import { useSettingsStore } from "@/store/settings";
import { ConnectionProtocol, SessionConnection } from "@/types";

interface RdpLaunchResult {
  launcherName: string;
  executable: string;
  argumentsPreview: string;
  passwordHandled: boolean;
  credentialMode: string;
  message: string;
}

export function RdpPage() {
  const { t } = useTranslation();
  const { tabId } = useParams<{ tabId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = useSessionsStore((s) => s.tabs);
  const ensureSession = useSessionsStore((s) => s.ensureSession);
  const updateTabStatus = useSessionsStore((s) => s.updateTabStatus);
  const closeSession = useSessionsStore((s) => s.closeSession);

  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const rdpSettings = useSettingsStore((s) => s.settings.rdp);
  const openLog = useConnectionLogsStore((s) => s.openLog);
  const closeLog = useConnectionLogsStore((s) => s.closeLog);

  const [launchInfo, setLaunchInfo] = useState<RdpLaunchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launching, setLaunching] = useState(false);
  const bootstrap = readSessionBootstrap(location.search);
  const autoConnectRef = useRef(false);

  const tab = tabs.find((entry) => entry.id === tabId);
  const sessionConnection = tab?.connection;
  const host = tab && !sessionConnection ? getHost(tab.hostId) : undefined;
  const credential = host?.credentialId ? getCredential(host.credentialId) : undefined;
  const username = sessionConnection?.username ?? credential?.username ?? host?.username ?? "";
  const password = sessionConnection?.password ?? credential?.password ?? null;
  const targetHost = sessionConnection?.host ?? host?.host ?? "";
  const targetPort = sessionConnection?.port ?? host?.port ?? 3389;
  const logIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!tabId || tab || !bootstrap.standalone) return;

    let cancelled = false;

    const ensureStandaloneSession = async () => {
      if (bootstrap.quickConnect) {
        if (!bootstrap.quickConnectBootstrapId) return;
        const payload = await invoke<{
          host_id: string;
          host_label: string;
          host_address: string;
          connection_protocol: ConnectionProtocol;
          connection_host: string;
          connection_port: number;
          connection_username: string;
          connection_auth_method: SessionConnection["authMethod"];
          connection_password?: string | null;
          connection_private_key_content?: string | null;
          connection_passphrase?: string | null;
        } | null>("get_quick_connect_bootstrap", {
          bootstrapId: bootstrap.quickConnectBootstrapId,
        });

        if (cancelled || !payload) return;

        ensureSession({
          id: tabId,
          type: "rdp",
          hostId: payload.host_id,
          hostLabel: payload.host_label,
          hostAddress: payload.host_address,
          connection: {
            source: "quick-connect",
            bootstrapId: bootstrap.quickConnectBootstrapId,
            protocol: payload.connection_protocol,
            host: payload.connection_host,
            port: payload.connection_port,
            username: payload.connection_username,
            authMethod: payload.connection_auth_method,
            password: payload.connection_password ?? null,
            privateKeyContent: payload.connection_private_key_content ?? null,
            passphrase: payload.connection_passphrase ?? null,
          },
          status: "connecting",
          panes: [],
          splitDirection: "horizontal",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (!bootstrap.hostId) return;

      ensureSession({
        id: tabId,
        type: "rdp",
        hostId: bootstrap.hostId,
        hostLabel: bootstrap.hostLabel ?? "RDP",
        hostAddress: bootstrap.hostAddress ?? bootstrap.hostLabel ?? "",
        status: "connecting",
        panes: [],
        splitDirection: "horizontal",
        createdAt: new Date().toISOString(),
      });
    };

    void ensureStandaloneSession();
    return () => {
      cancelled = true;
    };
  }, [bootstrap.hostAddress, bootstrap.hostId, bootstrap.hostLabel, bootstrap.quickConnect, bootstrap.quickConnectBootstrapId, bootstrap.standalone, ensureSession, tab, tabId]);

  const connect = useCallback(async () => {
    if (!tabId || (!host && !sessionConnection) || !tab) return;
    setLaunching(true);
    setError(null);
    updateTabStatus(tabId, "connecting");

    try {
      const result = await invoke<RdpLaunchResult>("rdp_connect", {
        sessionId: tabId,
        host: targetHost,
        port: targetPort,
        username: username || null,
        password,
        options: {
          preferredLinuxClient: rdpSettings.linuxClient,
          fullscreen: rdpSettings.fullscreen,
          dynamicResolution: rdpSettings.dynamicResolution,
          width: rdpSettings.width,
          height: rdpSettings.height,
          multimon: rdpSettings.multimon,
          clipboard: rdpSettings.clipboard,
          audioMode: rdpSettings.audioMode,
          certificateMode: rdpSettings.certificateMode,
        },
        title: tab.hostLabel,
      });

      if (logIdRef.current) {
        closeLog(logIdRef.current, "disconnected");
      }

      logIdRef.current = openLog({
        hostId: tab.hostId,
        hostLabel: tab.hostLabel,
        hostAddress: username ? `${username}@${targetHost}` : targetHost,
        sessionType: "rdp",
        connectedAt: new Date().toISOString(),
        status: "connected",
      });

      setLaunchInfo(result);
      updateTabStatus(tabId, "connected");
      if (host && !sessionConnection) {
        setLastConnected(host.id);
      }
      notify(APP_NAME, t("notifications.rdpConnected", { host: tab.hostLabel }));
    } catch (err) {
      const message = String(err);
      setError(message);
      setLaunchInfo(null);
      updateTabStatus(tabId, "error");
      notify(APP_NAME, t("notifications.rdpError", { host: tab?.hostLabel ?? "RDP" }));
    } finally {
      setLaunching(false);
    }
  }, [closeLog, host, openLog, password, rdpSettings, sessionConnection, setLastConnected, t, tab, tabId, targetHost, targetPort, updateTabStatus, username]);

  const disconnect = useCallback(async (status: "disconnected" | "error" = "disconnected") => {
    if (!tabId) return;

    await invoke("rdp_disconnect", { sessionId: tabId }).catch(() => {});
    updateTabStatus(tabId, status);

    if (logIdRef.current) {
      closeLog(logIdRef.current, status);
      logIdRef.current = null;
    }
  }, [closeLog, tabId, updateTabStatus]);

  useEffect(() => {
    if (!tabId || (!host && !sessionConnection) || tab?.status === "connected" || launching) return;
    if (autoConnectRef.current) return;
    autoConnectRef.current = true;
    void connect();
  }, [connect, host, launching, sessionConnection, tab?.status, tabId]);

  useEffect(() => {
    if (!tabId || tab?.status !== "connected") return;

    const timer = window.setInterval(() => {
      void invoke<boolean>("rdp_session_exists", { sessionId: tabId })
        .then((exists) => {
          if (!exists) {
            void disconnect("disconnected");
          }
        })
        .catch(() => {});
    }, 2000);

    return () => window.clearInterval(timer);
  }, [disconnect, tab?.status, tabId]);

  useEffect(() => () => {
    if (logIdRef.current) {
      closeLog(logIdRef.current, "disconnected");
      logIdRef.current = null;
    }
  }, [closeLog]);

  const securityHint = useMemo(() => {
    if (!launchInfo) return null;
    return launchInfo.passwordHandled ? t("rdp.passwordHandled") : t("rdp.passwordPromptExpected");
  }, [launchInfo, t]);

  const displayHint = useMemo(() => {
    if (rdpSettings.fullscreen) return t("rdp.displayModes.fullscreen");
    return `${rdpSettings.width}x${rdpSettings.height}`;
  }, [rdpSettings.fullscreen, rdpSettings.height, rdpSettings.width, t]);

  if (
    !tab &&
    bootstrap.standalone &&
    (bootstrap.hostId || (bootstrap.quickConnect && bootstrap.quickConnectBootstrapId))
  ) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-[var(--text-muted)]">{t("rdp.loadingSession")}</p>
      </div>
    );
  }

  if (!tab || (!host && !sessionConnection)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">{t("rdp.sessionNotFound")}</p>
        <Button onClick={() => navigate(withStandaloneQuery("/", bootstrap.standalone))}>
          {t("common.back")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] bg-[var(--bg-secondary)] px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Monitor size={18} className="text-[var(--accent)]" />
              <h1 className="text-lg font-semibold text-[var(--text-primary)]">{tab.hostLabel}</h1>
            </div>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {username ? `${username}@${targetHost}:${targetPort}` : `${targetHost}:${targetPort}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => void connect()} disabled={launching}>
              {launching ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {t("rdp.reconnect")}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void disconnect()}>
              <WifiOff size={14} />
              {t("rdp.disconnect")}
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-6">
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
          <div className="flex items-center gap-3">
            {tab.status === "connected" ? (
              <Wifi size={18} className="text-[var(--success)]" />
            ) : tab.status === "connecting" ? (
              <Loader2 size={18} className="animate-spin text-[var(--warning)]" />
            ) : (
              <WifiOff size={18} className="text-[var(--text-muted)]" />
            )}
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">{t(`rdp.status.${tab.status}`)}</p>
              <p className="text-xs text-[var(--text-muted)]">{t("rdp.externalClientHint")}</p>
            </div>
          </div>
        </section>

        {launchInfo && (
          <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <ExternalLink size={15} className="text-[var(--accent)]" />
              {t("rdp.launchDetails")}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <InfoCard label={t("rdp.launcher")} value={launchInfo.launcherName} />
              <InfoCard label={t("rdp.executable")} value={launchInfo.executable} />
              <InfoCard label={t("rdp.authentication")} value={securityHint ?? "—"} />
              <InfoCard label={t("rdp.credentialMode")} value={launchInfo.credentialMode} />
              <InfoCard label={t("rdp.display")} value={displayHint} />
              <InfoCard label={t("rdp.certificate")} value={t(`settings.rdp.certificateModes.${rdpSettings.certificateMode}`)} />
            </div>
            <p className="mt-4 break-all rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs text-[var(--text-muted)]">
              {launchInfo.argumentsPreview}
            </p>
            <p className="mt-4 text-sm text-[var(--text-secondary)]">{launchInfo.message}</p>
          </section>
        )}

        {error && (
          <section className="rounded-2xl border border-[var(--danger)] bg-[var(--danger)]/10 p-6">
            <p className="text-sm font-medium text-[var(--danger)]">{t("rdp.errorTitle")}</p>
            <p className="mt-2 text-sm text-[var(--text-primary)]">{error}</p>
          </section>
        )}

        <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("rdp.milestoneTitle")}</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <InfoCard label={t("rdp.milestones.host")} value={t("rdp.milestones.ready")} />
            <InfoCard label={t("rdp.milestones.launch")} value={t("rdp.milestones.ready")} />
          </div>
        </section>

        {bootstrap.standalone && (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void disconnect();
                closeSession(tab.id);
                void getCurrentWindow().close().catch(() => navigate(withStandaloneQuery("/", true)));
              }}
            >
              {t("common.close")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">{label}</p>
      <p className="mt-2 text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
