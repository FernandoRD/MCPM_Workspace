import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { WifiOff, Columns2, Rows2, X, FolderOpen } from "lucide-react";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { SshPane } from "@/components/Terminal/SshPane";
import { Button } from "@/components/ui/Button";

export function TerminalPage() {
  const { t } = useTranslation();
  const { tabId } = useParams<{ tabId: string }>();
  const navigate = useNavigate();

  const tabs = useSessionsStore((s) => s.tabs);
  const updatePaneStatus = useSessionsStore((s) => s.updatePaneStatus);
  const addPane = useSessionsStore((s) => s.addPane);
  const closePane = useSessionsStore((s) => s.closePane);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);

  const getHost = useHostsStore((s) => s.getHost);
  const setLastConnected = useHostsStore((s) => s.setLastConnected);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const getSshKey = useSshKeysStore((s) => s.getSshKey);

  const tab = tabs.find((t) => t.id === tabId);
  const host = tab ? getHost(tab.hostId) : undefined;

  if (!tab || !host) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <WifiOff size={32} className="text-[var(--text-muted)]" />
        <p className="text-[var(--text-muted)]">Sessão não encontrada</p>
        <Button onClick={() => navigate("/")}>Voltar</Button>
      </div>
    );
  }

  const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
  const authMethod = credential?.authMethod ?? host.authMethod ?? "password";
  const username = credential?.username ?? host.username ?? "";
  const password = credential?.password ?? host.passwordRef ?? null;
  const sshKey = credential?.keyId ? getSshKey(credential.keyId) : undefined;
  const privateKeyContent = sshKey?.privateKeyContent ?? null;
  const passphrase = sshKey?.passphrase ?? null;

  const isVertical = tab.splitDirection === "vertical";

  const handleOpenSftp = () => {
    const sftpTabId = openSftpTab(host.id, host.label, tab.hostAddress);
    navigate(`/sftp/${sftpTabId}`);
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
              host={host.host}
              port={host.port}
              authMethod={authMethod}
              username={username}
              password={password}
              privateKeyContent={privateKeyContent}
              passphrase={passphrase}
              onStatusChange={(pid, status) => updatePaneStatus(pid, status)}
              onConnected={() => setLastConnected(host.id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
