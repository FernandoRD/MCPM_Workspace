import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useLocation, useNavigate } from "react-router-dom";
import { X, Plus, Wifi, WifiOff, Loader2, FolderOpen, Monitor } from "lucide-react";
import { useSessionsStore } from "@/store/sessions";
import { useHostsStore } from "@/store/hosts";
import { cn } from "@/lib/utils";
import { SessionTab } from "@/types";
import { buildSessionRoute, isStandaloneWindow, withStandaloneQuery } from "@/lib/windowMode";

export function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, activeTabId, closeSession, setActiveTab } = useSessionsStore();
  const getHost = useHostsStore((s) => s.getHost);
  const standalone = isStandaloneWindow(location.search);

  if (tabs.length === 0) return null;

  const tabRoute = (tab: SessionTab) =>
    buildSessionRoute(tab.type, tab.id, {
      standalone,
      hostId: standalone && tab.connection?.source !== "quick-connect" ? tab.hostId : undefined,
      hostLabel: standalone && tab.connection?.source !== "quick-connect" ? tab.hostLabel : undefined,
      hostAddress: standalone && tab.connection?.source !== "quick-connect" ? tab.hostAddress : undefined,
      quickConnect: standalone && tab.connection?.source === "quick-connect",
      quickConnectBootstrapId: standalone && tab.connection?.source === "quick-connect"
        ? tab.connection.bootstrapId
        : undefined,
    });

  const handleTabClick = (tab: SessionTab) => {
    setActiveTab(tab.id);
    navigate(tabRoute(tab));
  };

  const handleClose = async (e: React.MouseEvent, tab: SessionTab) => {
    e.stopPropagation();
    const remaining = tabs.filter((t) => t.id !== tab.id);
    const protocol = tab.connection?.protocol ?? getHost(tab.hostId)?.protocol ?? "ssh";

    if (tab.type === "terminal") {
      await Promise.all(
        tab.panes.map((pane) =>
          invoke(protocol === "telnet" ? "telnet_disconnect" : "ssh_disconnect", { tabId: pane.id }).catch(() => {})
        )
      );
    } else if (tab.type === "sftp") {
      await invoke("sftp_disconnect", { sessionId: tab.id }).catch(() => {});
    } else {
      await invoke("rdp_disconnect", { sessionId: tab.id }).catch(() => {});
    }

    closeSession(tab.id);
    if (remaining.length === 0) {
      if (standalone) {
        await getCurrentWindow().close().catch(() => {
          navigate(withStandaloneQuery("/", true));
        });
        return;
      }
      navigate("/");
    } else if (tab.id === activeTabId) {
      const idx = tabs.findIndex((t) => t.id === tab.id);
      const next = remaining[idx] ?? remaining[idx - 1];
      if (next) navigate(tabRoute(next));
    }
  };

  return (
    <div className="flex h-9 items-center border-b border-[var(--border)] bg-[var(--bg-secondary)] overflow-x-auto">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => handleTabClick(tab)}
          className={cn(
            "group flex h-full min-w-0 max-w-[200px] items-center gap-1.5 border-r border-[var(--border)] px-3 text-xs transition-colors shrink-0",
            tab.id === activeTabId
              ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
              : "bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
          )}
        >
          <StatusIcon status={tab.status} />
          {tab.type === "sftp" && <FolderOpen size={10} className="text-[var(--accent)] shrink-0" />}
          {tab.type === "rdp" && <Monitor size={10} className="text-[var(--accent)] shrink-0" />}
          <span className="truncate">{tab.hostLabel}</span>
          <span
            onClick={(e) => void handleClose(e, tab)}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] transition-opacity"
            title={t("terminal.close")}
          >
            <X size={10} />
          </span>
        </button>
      ))}

      <button
        onClick={() => navigate(withStandaloneQuery("/", standalone))}
        className="flex h-full items-center justify-center px-3 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
        title={t("terminal.newTab")}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

function StatusIcon({ status }: { status: SessionTab["status"] }) {
  if (status === "connecting")
    return <Loader2 size={10} className="animate-spin text-[var(--warning)]" />;
  if (status === "connected")
    return <Wifi size={10} className="text-[var(--success)]" />;
  return <WifiOff size={10} className="text-[var(--text-muted)]" />;
}
