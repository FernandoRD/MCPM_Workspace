import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Search,
  Server,
  Edit2,
  Trash2,
  Copy,
  Terminal,
  MoreVertical,
  ShieldCheck,
  Layers,
  FolderOpen,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useUIStore } from "@/store/uiStore";
import { useSessionsStore } from "@/store/sessions";
import { useCredentialsStore } from "@/store/credentials";
import { useSettingsStore } from "@/store/settings";
import { SshHost } from "@/types";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

export function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hosts = useHostsStore((s) => s.hosts);
  const { deleteHost, duplicateHost } = useHostsStore();
  const openSession = useSessionsStore((s) => s.openSession);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const locale = useSettingsStore((s) => s.settings.locale);
  const savedGroups = useSettingsStore((s) => s.settings.groups);

  const search = useUIStore((s) => s.dashboardSearch);
  const setSearch = useUIStore((s) => s.setDashboardSearch);
  const selectedGroup = useUIStore((s) => s.dashboardSelectedGroup);
  const setSelectedGroup = useUIStore((s) => s.setDashboardSelectedGroup);
  const [menuHostId, setMenuHostId] = useState<string | null>(null);

  // Todos os grupos (derivados dos hosts + salvos manualmente)
  const allGroups = [
    ...new Set([
      ...hosts.map((h) => h.group).filter((g): g is string => !!g),
      ...savedGroups,
    ]),
  ].sort((a, b) => a.localeCompare(b));

  // Contagem de hosts por grupo
  const groupCount = hosts.reduce<Record<string, number>>((acc, h) => {
    if (h.group) acc[h.group] = (acc[h.group] ?? 0) + 1;
    return acc;
  }, {});

  // Filtra por busca e grupo selecionado
  const filtered = hosts.filter((h) => {
    const matchSearch =
      h.label.toLowerCase().includes(search.toLowerCase()) ||
      h.host.toLowerCase().includes(search.toLowerCase()) ||
      h.tags.some((tag) => tag.toLowerCase().includes(search.toLowerCase()));
    const matchGroup = selectedGroup === null || h.group === selectedGroup;
    return matchSearch && matchGroup;
  });

  const handleConnect = (host: SshHost) => {
    const cred = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = cred?.username ?? host.username ?? "";
    const tabId = openSession(host.id, host.label, username ? `${username}@${host.host}` : host.host);
    navigate(`/terminal/${tabId}`);
  };

  const handleOpenSftp = (host: SshHost) => {
    const cred = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = cred?.username ?? host.username ?? "";
    const tabId = openSftpTab(host.id, host.label, username ? `${username}@${host.host}` : host.host);
    navigate(`/sftp/${tabId}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("dashboard.title")}
        </h1>
        <Button onClick={() => navigate("/hosts/new")} size="sm">
          <Plus size={14} />
          {t("nav.newConnection")}
        </Button>
      </div>

      {/* Search bar */}
      <div className="px-6 py-3 border-b border-[var(--border)]">
        <div className="relative max-w-md">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("dashboard.searchPlaceholder")}
            className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-4">
        {hosts.length === 0 ? (
          <EmptyState onAdd={() => navigate("/hosts/new")} />
        ) : (
          <>
            {/* Filtros de grupo */}
            {allGroups.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {/* Botão Todos */}
                <button
                  onClick={() => setSelectedGroup(null)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                    selectedGroup === null
                      ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                      : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                  )}
                >
                  <Server size={13} />
                  {t("dashboard.allHosts")}
                  <span className="text-xs opacity-70">({hosts.length})</span>
                </button>

                {/* Cards de grupo */}
                {allGroups.map((group) => (
                  <button
                    key={group}
                    onClick={() => setSelectedGroup(selectedGroup === group ? null : group)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
                      selectedGroup === group
                        ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                        : "border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                    )}
                  >
                    <Layers size={13} />
                    {group}
                    <span className="text-xs opacity-70">({groupCount[group] ?? 0})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Grid de hosts */}
            {filtered.length === 0 ? (
              <p className="text-center py-12 text-[var(--text-muted)]">
                {t("common.noResults")}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {filtered.map((host) => (
                  <HostCard
                    key={host.id}
                    host={host}
                    locale={locale}
                    menuOpen={menuHostId === host.id}
                    onMenuToggle={(id) =>
                      setMenuHostId((prev) => (prev === id ? null : id))
                    }
                    onConnect={handleConnect}
                    onOpenSftp={handleOpenSftp}
                    onEdit={(h) => navigate(`/hosts/${h.id}`)}
                    onDelete={(id) => deleteHost(id)}
                    onDuplicate={(id) => duplicateHost(id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function HostCard({
  host,
  locale,
  menuOpen,
  onMenuToggle,
  onConnect,
  onOpenSftp,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  host: SshHost;
  locale: string;
  menuOpen: boolean;
  onMenuToggle: (id: string) => void;
  onConnect: (h: SshHost) => void;
  onOpenSftp: (h: SshHost) => void;
  onEdit: (h: SshHost) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { t } = useTranslation();
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const cred = host.credentialId ? getCredential(host.credentialId) : undefined;
  const username = cred?.username ?? host.username ?? "";

  return (
    <div className="relative group flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 hover:border-[var(--border-focus)] transition-colors">
      {/* Top row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <div
            className="h-9 w-9 rounded-lg flex items-center justify-center text-white font-bold text-sm"
            style={{ backgroundColor: host.color ?? "var(--accent)" }}
          >
            {host.label.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-[var(--text-primary)] leading-tight truncate max-w-[130px]">
              {host.label}
            </p>
            <p className="text-xs text-[var(--text-muted)] truncate max-w-[130px]">
              {host.host}:{host.port}
            </p>
          </div>
        </div>
        {/* Context menu */}
        <div className="relative">
          <button
            onClick={() => onMenuToggle(host.id)}
            className="h-7 w-7 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] transition-colors opacity-0 group-hover:opacity-100"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] shadow-xl py-1">
              <ContextItem icon={Terminal} label={t("dashboard.host.connect")} onClick={() => onConnect(host)} />
              <ContextItem icon={FolderOpen} label={t("dashboard.host.openSftp")} onClick={() => onOpenSftp(host)} />
              <ContextItem icon={Edit2} label={t("dashboard.host.edit")} onClick={() => onEdit(host)} />
              <ContextItem icon={Copy} label={t("dashboard.host.duplicate")} onClick={() => onDuplicate(host.id)} />
              <div className="my-1 border-t border-[var(--border)]" />
              <ContextItem icon={Trash2} label={t("dashboard.host.delete")} onClick={() => onDelete(host.id)} danger />
            </div>
          )}
        </div>
      </div>

      {/* User */}
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
        <Server size={11} />
        <span className="font-mono truncate">{username ? `${username}@${host.host}` : host.host}</span>
      </div>

      {/* Tags + MFA badge */}
      {(host.tags.length > 0 || host.mfaEnabled) && (
        <div className="flex flex-wrap gap-1">
          {host.mfaEnabled && (
            <Badge variant="accent" className="flex items-center gap-1">
              <ShieldCheck size={10} />
              {t("dashboard.host.mfaBadge")}
            </Badge>
          )}
          {host.tags.slice(0, 3).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
          {host.tags.length > 3 && (
            <Badge>+{host.tags.length - 3}</Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-auto pt-2 border-t border-[var(--border)]">
        <p className="text-xs text-[var(--text-muted)]">
          {host.lastConnectedAt
            ? formatDate(host.lastConnectedAt, locale)
            : t("dashboard.host.neverConnected")}
        </p>
        <Button size="sm" onClick={() => onConnect(host)}>
          <Terminal size={12} />
          {t("dashboard.host.connect")}
        </Button>
      </div>
    </div>
  );
}

function ContextItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-xs transition-colors ${
        danger
          ? "text-[var(--danger)] hover:bg-[var(--danger)]/10"
          : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <div className="h-16 w-16 rounded-2xl bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center justify-center">
        <Server size={28} className="text-[var(--text-muted)]" />
      </div>
      <div className="text-center">
        <p className="font-medium text-[var(--text-primary)]">{t("dashboard.noHosts")}</p>
        <p className="text-sm text-[var(--text-muted)] mt-1">{t("dashboard.noHostsDescription")}</p>
      </div>
      <Button onClick={onAdd}>
        <Plus size={14} />
        {t("nav.newConnection")}
      </Button>
    </div>
  );
}
