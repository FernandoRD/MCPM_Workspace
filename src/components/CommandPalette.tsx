import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Search, Server, Settings, ShieldEllipsis, Workflow } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSessionsStore } from "@/store/sessions";
import { Modal } from "@/components/ui/Modal";
import { matchesHostSearch, sortHosts } from "@/lib/hostSearch";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const hosts = useHostsStore((s) => s.hosts);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const openSession = useSessionsStore((s) => s.openSession);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const sortedHosts = useMemo(
    () => sortHosts(hosts, getCredential, "recent"),
    [hosts, getCredential]
  );

  const filteredHosts = useMemo(
    () =>
      sortedHosts.filter((host) =>
        matchesHostSearch(
          host,
          query,
          host.credentialId ? getCredential(host.credentialId) : undefined
        )
      ),
    [sortedHosts, query, getCredential]
  );

  const quickActions = [
    {
      id: "new-host",
      label: t("commandPalette.actions.newHost"),
      icon: Plus,
      action: () => navigate("/hosts/new"),
    },
    {
      id: "backup",
      label: t("commandPalette.actions.openBackup"),
      icon: ShieldEllipsis,
      action: () => navigate("/backup"),
    },
    {
      id: "settings",
      label: t("commandPalette.actions.openSettings"),
      icon: Settings,
      action: () => navigate("/settings"),
    },
    {
      id: "operations",
      label: t("commandPalette.actions.openOperations"),
      icon: Workflow,
      action: () => navigate("/operations"),
    },
  ].filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  const connectToHost = (hostId: string, mode: "terminal" | "sftp") => {
    const host = hosts.find((entry) => entry.id === hostId);
    if (!host) return;
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = credential?.username ?? host.username ?? "";
    const hostAddress = username ? `${username}@${host.host}` : host.host;
    const tabId =
      mode === "terminal"
        ? openSession(host.id, host.label, hostAddress)
        : openSftpTab(host.id, host.label, hostAddress);

    onClose();
    navigate(mode === "terminal" ? `/terminal/${tabId}` : `/sftp/${tabId}`);
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" className="max-w-3xl">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
          <Search size={16} className="text-[var(--text-muted)]" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("commandPalette.searchPlaceholder")}
            className="w-full bg-transparent text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none"
          />
          <span className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
            Ctrl/Cmd + K
          </span>
        </div>

        {quickActions.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("commandPalette.quickActions")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {quickActions.map(({ id, label, icon: Icon, action }) => (
                <button
                  key={id}
                  onClick={() => {
                    onClose();
                    action();
                  }}
                  className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] hover:border-[var(--border-focus)]"
                >
                  <Icon size={14} className="text-[var(--accent)]" />
                  {label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("commandPalette.quickConnect")}
            </p>
            <span className="text-xs text-[var(--text-muted)]">
              {t("commandPalette.results", { count: filteredHosts.length })}
            </span>
          </div>

          <div className="max-h-[420px] overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-primary)]">
            {filteredHosts.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-[var(--text-muted)]">
                {t("commandPalette.noHosts")}
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-[var(--border)]">
                {filteredHosts.map((host) => {
                  const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
                  const username = credential?.username ?? host.username ?? "";
                  return (
                    <div
                      key={host.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--bg-secondary)]">
                        <Server size={16} className="text-[var(--text-muted)]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                          {host.label}
                        </p>
                        <p className="truncate text-xs text-[var(--text-muted)]">
                          {username ? `${username}@` : ""}{host.host}:{host.port}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => connectToHost(host.id, "terminal")}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--border-focus)]"
                        >
                          {t("commandPalette.terminal")}
                        </button>
                        <button
                          onClick={() => connectToHost(host.id, "sftp")}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--border-focus)]"
                        >
                          <span className="inline-flex items-center gap-1">
                            <FolderOpen size={12} />
                            {t("commandPalette.sftp")}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
