import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { WifiOff, Columns2, Rows2, X, FolderOpen } from "lucide-react";
import { notify } from "@/lib/notifications";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { useConnectionLogsStore } from "@/store/connectionLogs";
import { SshPane } from "@/components/Terminal/SshPane";
import { Button } from "@/components/ui/Button";
import { SessionConnection } from "@/types";
import { buildSessionRoute, readSessionBootstrap, withStandaloneQuery } from "@/lib/windowMode";

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

  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const getSshKey = useSshKeysStore((s) => s.getSshKey);
  const openLog = useConnectionLogsStore((s) => s.openLog);
  const closeLog = useConnectionLogsStore((s) => s.closeLog);
  const bootstrap = readSessionBootstrap(location.search);

  const tab = tabs.find((t) => t.id === tabId);
  const host = tab ? getHost(tab.hostId) : undefined;
  const sessionConnection = tab?.connection;

  useEffect(() => {
    if (!tabId || tab || !bootstrap.standalone || !bootstrap.hostId) return;

    const connection: SessionConnection | undefined = bootstrap.quickConnect && bootstrap.connectionHost
      ? {
          source: "quick-connect",
          host: bootstrap.connectionHost,
          port: bootstrap.connectionPort ?? 22,
          username: bootstrap.connectionUsername ?? "",
          authMethod: (bootstrap.connectionAuthMethod as SessionConnection["authMethod"]) ?? "agent",
        }
      : undefined;

    ensureSession({
      id: tabId,
      type: "terminal",
      hostId: bootstrap.hostId,
      hostLabel: bootstrap.hostLabel ?? "SSH",
      hostAddress: bootstrap.hostAddress ?? bootstrap.hostLabel ?? "",
      connection,
      status: "connecting",
      panes: [{ id: tabId, status: "connecting" }],
      splitDirection: "horizontal",
      createdAt: new Date().toISOString(),
    });
  }, [bootstrap.connectionAuthMethod, bootstrap.connectionHost, bootstrap.connectionPort, bootstrap.connectionUsername, bootstrap.hostAddress, bootstrap.hostId, bootstrap.hostLabel, bootstrap.quickConnect, bootstrap.standalone, ensureSession, tab, tabId]);

  // Navega de volta ao Dashboard quando a sessão (pane principal) desconecta
  const everConnectedRef = useRef(false);
  const logIdRef = useRef<string | null>(null);
  // Ref para o label do host — evita stale closure nos callbacks
  const hostLabelRef = useRef<string>(tab?.hostLabel ?? "");
  hostLabelRef.current = tab?.hostLabel ?? "";

  const handleDisconnected = useCallback((status: "disconnected" | "error" = "disconnected") => {
    if (logIdRef.current) closeLog(logIdRef.current, status);
    if (!everConnectedRef.current) {
      // Falha na conexão inicial — erro já aparece no terminal, notifica apenas se for erro
      if (status === "error") {
        notify("SSH Vault", t("notifications.sshError", { host: hostLabelRef.current }));
      }
      return;
    }
    if (status === "error") {
      notify("SSH Vault", t("notifications.sshDropped", { host: hostLabelRef.current }));
    }
    if (tabId) closeSession(tabId);
    if (bootstrap.standalone) {
      void getCurrentWindow().close().catch(() => {
        navigate(withStandaloneQuery("/", true));
      });
      return;
    }
    navigate("/");
  }, [bootstrap.standalone, tabId, closeSession, navigate, closeLog, t]);

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
      notify("SSH Vault", t("notifications.sshConnected", { host: tab.hostLabel }));
    }
  }, [tab, setLastConnected, openLog, t]);

  if (!tab && bootstrap.standalone && bootstrap.hostId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-[var(--text-muted)]">Carregando sessão...</p>
      </div>
    );
  }

  if (!tab || (!host && !sessionConnection)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">Sessão não encontrada</p>
        <Button onClick={() => navigate(withStandaloneQuery("/", bootstrap.standalone))}>Voltar</Button>
      </div>
    );
  }

  const credential = host?.credentialId ? getCredential(host.credentialId) : undefined;
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

  const handleOpenSftp = () => {
    if (!host) return;
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
          onClick={handleOpenSftp}
          title={t("terminal.openSftp")}
          className="gap-1.5 text-xs"
          disabled={!host}
        >
          <FolderOpen size={14} />
          {t("terminal.openSftp")}
        </Button>
      </div>

      {/* Panes container */}
      <div className={`flex flex-1 min-h-0 ${isVertical ? "flex-col" : "flex-row"}`}>
        {tab.panes.map((pane, idx) => (
          <div key={pane.id} className="relative flex-1 min-w-0 min-h-0 flex">
            {/* Divider between panes */}
            {idx > 0 && (
              <div
                className={
                  isVertical
                    ? "absolute top-0 left-0 right-0 h-px bg-[var(--border)] z-10"
                    : "absolute top-0 left-0 bottom-0 w-px bg-[var(--border)] z-10"
                }
              />
            )}

            {/* Close pane button (only when more than one pane) */}
            {tab.panes.length > 1 && (
              <button
                className="absolute top-1 right-1 z-20 p-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)] opacity-40 hover:opacity-100 transition-opacity"
                onClick={() => closePane(tab.id, pane.id)}
                title={t("common.close")}
              >
                <X size={12} />
              </button>
            )}

            <SshPane
              paneId={pane.id}
              host={targetHost}
              port={targetPort}
              authMethod={authMethod}
              username={username}
              password={password}
              privateKeyContent={privateKeyContent}
              passphrase={passphrase}
              sshCompatPreset={targetCompatPreset}
              onStatusChange={(pid, status) => updatePaneStatus(pid, status)}
              onConnected={pane.id === tab.id ? handleConnected : () => { if (host) setLastConnected(host.id); }}
              onDisconnected={pane.id === tab.id ? handleDisconnected : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
