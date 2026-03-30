import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Server,
  Settings,
  CloudUpload,
  HardDriveDownload,
  KeyRound,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Circle,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useSessionsStore } from "@/store/sessions";
import { SshHost } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const hosts = useHostsStore((s) => s.hosts);
  const openSession = useSessionsStore((s) => s.openSession);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const filtered = hosts.filter(
    (h) =>
      h.label.toLowerCase().includes(search.toLowerCase()) ||
      h.host.toLowerCase().includes(search.toLowerCase()) ||
      (h.username ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const grouped = filtered.reduce<Record<string, SshHost[]>>((acc, host) => {
    const key = host.group ?? "__ungrouped__";
    if (!acc[key]) acc[key] = [];
    acc[key].push(host);
    return acc;
  }, {});

  const toggleGroup = (group: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  };

  const handleConnect = (host: SshHost) => {
    const tabId = openSession(host.id, host.label, `${host.username}@${host.host}:${host.port}`);
    navigate(`/terminal/${tabId}`);
  };

  const navItems = [
    { to: "/", icon: Server, label: t("nav.dashboard") },
    { to: "/credentials", icon: KeyRound, label: t("nav.credentials") },
    { to: "/sync", icon: CloudUpload, label: t("nav.sync") },
    { to: "/backup", icon: HardDriveDownload, label: t("nav.backup") },
    { to: "/settings", icon: Settings, label: t("nav.settings") },
  ];

  return (
    <aside className="flex flex-col w-60 min-w-[240px] h-full bg-[var(--bg-secondary)] border-r border-[var(--border)]">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[var(--border)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
          <Server size={16} />
        </div>
        <span className="font-semibold text-[var(--text-primary)]">{t("app.name")}</span>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-0.5 px-2 py-3 border-b border-[var(--border)]">
        {navItems.map(({ to, icon: Icon, label }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors text-left",
              (to === "/" ? location.pathname === to : location.pathname.startsWith(to))
                ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      {/* Hosts section */}
      <div className="flex items-center justify-between px-4 py-2 mt-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {t("nav.dashboard")}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => navigate("/hosts/new")}
          title={t("nav.newConnection")}
        >
          <Plus size={14} />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="w-full h-7 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-7 pr-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
          />
        </div>
      </div>

      {/* Host list */}
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {Object.keys(grouped).length === 0 && (
          <p className="px-3 py-4 text-xs text-[var(--text-muted)] text-center">
            {t("dashboard.noHosts")}
          </p>
        )}

        {Object.entries(grouped).map(([groupKey, groupHosts]) => {
          const isCollapsed = collapsedGroups.has(groupKey);
          const groupLabel =
            groupKey === "__ungrouped__" ? t("dashboard.groups.ungrouped") : groupKey;

          return (
            <div key={groupKey} className="mb-1">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(groupKey)}
                className="flex w-full items-center gap-1 rounded px-2 py-1 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="uppercase tracking-wide">{groupLabel}</span>
                <span className="ml-auto opacity-60">{groupHosts.length}</span>
              </button>

              {/* Hosts */}
              {!isCollapsed &&
                groupHosts.map((host) => (
                  <HostItem key={host.id} host={host} onConnect={handleConnect} />
                ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}

function HostItem({
  host,
  onConnect,
}: {
  host: SshHost;
  onConnect: (h: SshHost) => void;
}) {
  const navigate = useNavigate();
  const tabs = useSessionsStore((s) => s.tabs);
  const isConnected = tabs.some(
    (t) => t.hostId === host.id && t.status === "connected"
  );

  return (
    <div className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)] transition-colors">
      <div className="relative flex-shrink-0">
        <div
          className="h-7 w-7 rounded-md flex items-center justify-center text-white text-xs font-bold"
          style={{ backgroundColor: host.color ?? "var(--accent)" }}
        >
          {host.label.charAt(0).toUpperCase()}
        </div>
        {isConnected && (
          <Circle
            size={8}
            className="absolute -bottom-0.5 -right-0.5 fill-[var(--success)] text-[var(--success)]"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
          {host.label}
        </p>
        <p className="text-xs text-[var(--text-muted)] truncate leading-tight">
          {host.username}@{host.host}:{host.port}
        </p>
      </div>
      <div className="hidden group-hover:flex items-center gap-1">
        <button
          onClick={() => onConnect(host)}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--accent)] hover:bg-[var(--accent-subtle)] transition-colors"
          title="Conectar"
        >
          <Server size={12} />
        </button>
        <button
          onClick={() => navigate(`/hosts/${host.id}`)}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Editar"
        >
          <Settings size={12} />
        </button>
      </div>
    </div>
  );
}
