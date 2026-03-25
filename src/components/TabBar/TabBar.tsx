import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { X, Plus, Wifi, WifiOff, Loader2 } from "lucide-react";
import { useSessionsStore } from "@/store/sessions";
import { cn } from "@/lib/utils";
import { SessionTab } from "@/types";

export function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tabs, activeTabId, closeSession, setActiveTab } = useSessionsStore();

  if (tabs.length === 0) return null;

  const handleTabClick = (tab: SessionTab) => {
    setActiveTab(tab.id);
    navigate(`/terminal/${tab.id}`);
  };

  const handleClose = (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();
    const remaining = tabs.filter((t) => t.id !== tabId);
    closeSession(tabId);
    if (remaining.length === 0) {
      navigate("/");
    } else if (tabId === activeTabId) {
      const idx = tabs.findIndex((t) => t.id === tabId);
      const next = remaining[idx] ?? remaining[idx - 1];
      if (next) navigate(`/terminal/${next.id}`);
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
          <span className="truncate">{tab.hostLabel}</span>
          <span
            onClick={(e) => handleClose(e, tab.id)}
            className="ml-1 flex h-4 w-4 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] transition-opacity"
            title={t("terminal.close")}
          >
            <X size={10} />
          </span>
        </button>
      ))}

      <button
        onClick={() => navigate("/")}
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
