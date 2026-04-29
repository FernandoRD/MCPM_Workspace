import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { WifiOff, Columns2, Rows2, X, FolderOpen, RotateCcw } from "lucide-react";
import { notify } from "@/lib/notifications";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { useConnectionLogsStore } from "@/store/connectionLogs";
import { useSettingsStore } from "@/store/settings";
import { TerminalPane } from "@/components/Terminal/TerminalPane";
import { Button } from "@/components/ui/Button";
import { SftpPage } from "@/pages/SftpPage";
import { ConnectionProtocol, SessionConnection } from "@/types";
import { buildSessionRoute, readSessionBootstrap, withStandaloneQuery } from "@/lib/windowMode";
import { APP_NAME } from "@/lib/appInfo";

export function TerminalPage() {
  const { t } = useTranslation();
  const { tabId } = useParams<{ tabId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = useSessionsStore((s) => s.tabs);
  const ensureSession = useSessionsStore((s) => s.ensureSession);
  const updatePaneStatus = useSessionsStore((s) => s.updatePaneStatus);
  const addPane = useSessionsStore((s) => s.addPane);
  const closePane = useSessionsStore((s) => s.closePane);
  const closeSession = useSessionsStore((s) => s.closeSession);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);
  const clearTerminalSnapshot = useSessionsStore((s) => s.clearTerminalSnapshot);
  const sftpOpenMode = useSettingsStore((s) => s.settings.ssh.sftpOpenMode);

  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const getSshKey = useSshKeysStore((s) => s.getSshKey);
  const openLog = useConnectionLogsStore((s) => s.openLog);
  const closeLog = useConnectionLogsStore((s) => s.closeLog);
  const bootstrap = readSessionBootstrap(location.search);
  const [reconnectNonces, setReconnectNonces] = useState<Record<string, number>>({});
  const [sftpPanelOpen, setSftpPanelOpen] = useState(false);
  const [paneWeights, setPaneWeights] = useState<Record<string, number>>({});
  const [sftpPanelPercent, setSftpPanelPercent] = useState(44);
  const panesContainerRef = useRef<HTMLDivElement>(null);
  const pageSplitRef = useRef<HTMLDivElement>(null);

  const tab = tabs.find((t) => t.id === tabId);
  const host = tab ? getHost(tab.hostId) : undefined;
  const sessionConnection = tab?.connection;
  const paneIdsKey = tab?.panes.map((pane) => pane.id).join("|") ?? "";

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
          type: "terminal",
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
          panes: [{ id: tabId, status: "connecting" }],
          splitDirection: "horizontal",
          createdAt: new Date().toISOString(),
        });
        return;
      }

      if (!bootstrap.hostId) return;

      ensureSession({
        id: tabId,
        type: "terminal",
        hostId: bootstrap.hostId,
        hostLabel: bootstrap.hostLabel ?? "SSH",
        hostAddress: bootstrap.hostAddress ?? bootstrap.hostLabel ?? "",
        status: "connecting",
        panes: [{ id: tabId, status: "connecting" }],
        splitDirection: "horizontal",
        createdAt: new Date().toISOString(),
      });
    };

    void ensureStandaloneSession();
    return () => {
      cancelled = true;
    };
  }, [bootstrap.hostAddress, bootstrap.hostId, bootstrap.hostLabel, bootstrap.quickConnect, bootstrap.quickConnectBootstrapId, bootstrap.standalone, ensureSession, tab, tabId]);

  useEffect(() => {
    if (!tab) return;
    setPaneWeights((current) => {
      const next: Record<string, number> = {};
      let changed = false;

      for (const pane of tab.panes) {
        next[pane.id] = current[pane.id] ?? 1;
        if (!(pane.id in current)) changed = true;
      }

      for (const paneId of Object.keys(current)) {
        if (!next[paneId]) changed = true;
      }

      return changed ? next : current;
    });
  }, [paneIdsKey, tab]);

  // Fecha em encerramento limpo e mantém aberta em erro para permitir reconexão.
  const everConnectedRef = useRef(false);
  const logIdRef = useRef<string | null>(null);
  // Ref para o label do host — evita stale closure nos callbacks
  const hostLabelRef = useRef<string>(tab?.hostLabel ?? "");
  hostLabelRef.current = tab?.hostLabel ?? "";

  useEffect(() => {
    if (tab?.status === "connected") {
      everConnectedRef.current = true;
    }
  }, [tab?.status]);

  const handleDisconnected = useCallback((paneId: string, status: "disconnected" | "error" = "disconnected") => {
    if (logIdRef.current) {
      closeLog(logIdRef.current, status);
      logIdRef.current = null;
    }
    if (!everConnectedRef.current) {
      // Falha na conexão inicial — erro já aparece no terminal, notifica apenas se for erro
      if (status === "error") {
        notify(APP_NAME, t("notifications.terminalError", { host: hostLabelRef.current }));
      }
      return;
    }
    if (status === "disconnected") {
      if (tab && paneId !== tab.id && tab.panes.length > 1) {
        closePane(tab.id, paneId);
        return;
      }
      if (bootstrap.standalone) {
        void getCurrentWindow().close();
        return;
      }
      if (tabId) closeSession(tabId);
      navigate("/");
      return;
    }
    if (status === "error") {
      notify(APP_NAME, t("notifications.terminalDropped", { host: hostLabelRef.current }));
    }
  }, [bootstrap.standalone, closeLog, closePane, closeSession, navigate, tab, tabId, t]);

  const handleConnected = useCallback(() => {
    everConnectedRef.current = true;
    if (tab) {
      if (!tab.connection) {
        setLastConnected(tab.hostId);
      }
      logIdRef.current = openLog({
        hostId: tab.hostId,
        hostLabel: tab.hostLabel,
        hostAddress: tab.hostAddress,
        sessionType: "terminal",
        connectedAt: new Date().toISOString(),
        status: "connected",
      });
      notify(APP_NAME, t("notifications.terminalConnected", { host: tab.hostLabel }));
    }
  }, [tab, setLastConnected, openLog, t]);

  if (
    !tab &&
    bootstrap.standalone &&
    (bootstrap.hostId || (bootstrap.quickConnect && bootstrap.quickConnectBootstrapId))
  ) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-[var(--text-muted)]">{t("terminal.loadingSession")}</p>
      </div>
    );
  }

  if (!tab || (!host && !sessionConnection)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">{t("terminal.sessionNotFound")}</p>
        <Button onClick={() => navigate(withStandaloneQuery("/", bootstrap.standalone))}>{t("common.back")}</Button>
      </div>
    );
  }

  const credential = host?.credentialId ? getCredential(host.credentialId) : undefined;
  const protocol = (sessionConnection?.protocol ?? host?.protocol ?? "ssh") === "telnet" ? "telnet" : "ssh";
  const authMethod = sessionConnection?.authMethod ?? credential?.authMethod ?? host?.authMethod ?? "password";
  const username = sessionConnection?.username ?? credential?.username ?? host?.username ?? "";
  const password = sessionConnection?.password ?? credential?.password ?? host?.passwordRef ?? null;
  const sshKey = host && credential?.keyId ? getSshKey(credential.keyId) : undefined;
  const privateKeyContent = sessionConnection?.privateKeyContent ?? sshKey?.privateKeyContent ?? null;
  const passphrase = sessionConnection?.passphrase ?? sshKey?.passphrase ?? null;
  const targetHost = sessionConnection?.host ?? host!.host;
  const targetPort = sessionConnection?.port ?? host!.port;
  const targetCompatPreset = sessionConnection?.sshCompatPreset ?? host?.sshCompat?.preset;

  const isVertical = tab.splitDirection === "vertical";
  const canReconnect = tab.panes.length > 0;
  const totalPaneWeight = tab.panes.reduce((sum, pane) => sum + (paneWeights[pane.id] ?? 1), 0) || 1;

  const reconnectPane = async (paneId: string) => {
    const disconnectCommand = protocol === "telnet" ? "telnet_disconnect" : "ssh_disconnect";
    await invoke(disconnectCommand, { tabId: paneId }).catch(() => {});
    clearTerminalSnapshot(paneId);
    updatePaneStatus(paneId, "connecting");
    setReconnectNonces((current) => ({
      ...current,
      [paneId]: (current[paneId] ?? 0) + 1,
    }));
  };

  const handleReconnect = () => {
    const reconnectablePanes = tab.panes.filter((pane) => pane.status === "disconnected" || pane.status === "error");
    const targets = reconnectablePanes.length > 0 ? reconnectablePanes : [tab.panes[0]].filter(Boolean);
    targets.forEach((pane) => void reconnectPane(pane.id));
  };

  const handleOpenSftp = async () => {
    if (!host || protocol !== "ssh") return;
    if (sftpOpenMode === "sameTab") {
      setSftpPanelOpen(true);
      return;
    }
    const sftpTabId = openSftpTab(host.id, host.label, tab.hostAddress);
    navigate(
      buildSessionRoute("sftp", sftpTabId, {
        standalone: bootstrap.standalone,
        hostId: bootstrap.standalone ? host.id : undefined,
        hostLabel: bootstrap.standalone ? host.label : undefined,
        hostAddress: bootstrap.standalone ? tab.hostAddress : undefined,
      })
    );
  };

  const handleClosePane = async (targetPaneId: string) => {
    const disconnectCommand = protocol === "telnet" ? "telnet_disconnect" : "ssh_disconnect";
    await invoke(disconnectCommand, { tabId: targetPaneId }).catch(() => {});
    closePane(tab.id, targetPaneId);
  };

  const startPaneResize = (dividerIndex: number, event: React.PointerEvent<HTMLDivElement>) => {
    const container = panesContainerRef.current;
    const beforePane = tab.panes[dividerIndex];
    const afterPane = tab.panes[dividerIndex + 1];
    if (!container || !beforePane || !afterPane) return;

    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const axisSize = isVertical ? rect.height : rect.width;
    if (axisSize <= 0) return;

    const startPointer = isVertical ? event.clientY : event.clientX;
    const startBefore = paneWeights[beforePane.id] ?? 1;
    const startAfter = paneWeights[afterPane.id] ?? 1;
    const startTotal = totalPaneWeight;
    const minWeight = Math.min(startTotal * 0.12, Math.max(0.1, (startBefore + startAfter) / 2 - 0.05));
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const pointer = isVertical ? moveEvent.clientY : moveEvent.clientX;
      const deltaWeight = ((pointer - startPointer) / axisSize) * startTotal;
      const clampedDelta = Math.min(
        startAfter - minWeight,
        Math.max(minWeight - startBefore, deltaWeight)
      );

      setPaneWeights((current) => ({
        ...current,
        [beforePane.id]: startBefore + clampedDelta,
        [afterPane.id]: startAfter - clampedDelta,
      }));
    };

    const handlePointerUp = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };

  const startSftpResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const container = pageSplitRef.current;
    if (!container) return;

    event.preventDefault();
    const rect = container.getBoundingClientRect();
    if (rect.width <= 0) return;

    const startPointer = event.clientX;
    const startPercent = sftpPanelPercent;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaPercent = ((moveEvent.clientX - startPointer) / rect.width) * 100;
      const nextPercent = Math.min(70, Math.max(25, startPercent - deltaPercent));
      setSftpPanelPercent(nextPercent);
    };

    const handlePointerUp = () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Split toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 border-b border-[var(--border)] bg-[var(--bg-secondary)] shrink-0">
        <span className="text-xs text-[var(--text-muted)] mr-1">{t("terminal.split")}:</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => addPane(tab.id, "horizontal")}
          title={t("terminal.splitHorizontal")}
        >
          <Columns2 size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => addPane(tab.id, "vertical")}
          title={t("terminal.splitVertical")}
        >
          <Rows2 size={14} />
        </Button>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleOpenSftp()}
          title={t("terminal.openSftp")}
          className="gap-1.5 text-xs"
          disabled={!host || protocol !== "ssh"}
        >
          <FolderOpen size={14} />
          {t("terminal.openSftp")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReconnect}
          title={t("terminal.reconnect")}
          className="gap-1.5 text-xs"
          disabled={!canReconnect}
        >
          <RotateCcw size={14} />
          {t("terminal.reconnect")}
        </Button>
      </div>

      <div ref={pageSplitRef} className="flex flex-1 min-h-0">
        {/* Panes container */}
        <div
          ref={panesContainerRef}
          className={`flex min-w-0 min-h-0 ${isVertical ? "flex-col" : "flex-row"}`}
          style={{ flex: sftpPanelOpen ? `0 0 ${100 - sftpPanelPercent}%` : "1 1 0%" }}
        >
          {tab.panes.map((pane, idx) => (
            <div
              key={pane.id}
              className="relative min-w-0 min-h-0 flex"
              style={{
                flex: `0 0 ${((paneWeights[pane.id] ?? 1) / totalPaneWeight) * 100}%`,
              }}
            >
              {idx > 0 && (
                <div
                  role="separator"
                  aria-orientation={isVertical ? "horizontal" : "vertical"}
                  className={
                    isVertical
                      ? "absolute -top-1 left-0 right-0 h-2 cursor-row-resize z-20 border-t border-[var(--border)] bg-[var(--bg-secondary)]/70 hover:bg-[var(--accent)]/20"
                      : "absolute top-0 -left-1 bottom-0 w-2 cursor-col-resize z-20 border-l border-[var(--border)] bg-[var(--bg-secondary)]/70 hover:bg-[var(--accent)]/20"
                  }
                  onPointerDown={(event) => startPaneResize(idx - 1, event)}
                />
              )}

              {/* Close pane button (only when more than one pane) */}
              {tab.panes.length > 1 && (
                <button
                  className="absolute top-1 right-1 z-20 p-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] opacity-40 hover:opacity-100 transition-opacity"
                  onClick={() => void handleClosePane(pane.id)}
                  title={t("common.close")}
                >
                  <X size={12} />
                </button>
              )}

              <TerminalPane
                paneId={pane.id}
                protocol={protocol}
                host={targetHost}
                port={targetPort}
                authMethod={authMethod}
                username={username}
                password={password}
                privateKeyContent={privateKeyContent}
                passphrase={passphrase}
                sshCompatPreset={targetCompatPreset}
                reconnectNonce={reconnectNonces[pane.id] ?? 0}
                onStatusChange={(pid, status) => updatePaneStatus(pid, status)}
                onConnected={pane.id === tab.id ? handleConnected : () => { if (host) setLastConnected(host.id); }}
                onDisconnected={(status) => handleDisconnected(pane.id, status)}
              />
            </div>
          ))}
        </div>

        {sftpPanelOpen && host && protocol === "ssh" && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              className="w-2 shrink-0 cursor-col-resize border-l border-r border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--accent)]/20"
              onPointerDown={startSftpResize}
            />
            <div
              className="min-w-[320px] min-h-0 bg-[var(--bg-primary)]"
              style={{ flex: `0 0 ${sftpPanelPercent}%` }}
            >
              <SftpPage
                embedded
                embeddedSessionId={`${tab.id}:sftp`}
                embeddedHostId={host.id}
                embeddedHostAddress={tab.hostAddress}
                onClose={() => setSftpPanelOpen(false)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
