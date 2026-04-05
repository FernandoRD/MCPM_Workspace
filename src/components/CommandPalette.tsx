import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Search, Server, Settings, ShieldEllipsis, Workflow, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSessionsStore } from "@/store/sessions";
import { useSettingsStore } from "@/store/settings";
import { Modal } from "@/components/ui/Modal";
import { matchesHostSearch, sortHosts } from "@/lib/hostSearch";
import { launchQuickConnectSession, launchTerminalSession } from "@/lib/sessionLauncher";
import { buildAppRoute, buildSessionRoute, isStandaloneWindow } from "@/lib/windowMode";
import { SessionConnection } from "@/types";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedQuickConnect {
  username: string;
  host: string;
  port: number;
  hostAddress: string;
  label: string;
}

function parseQuickConnect(value: string): ParsedQuickConnect | null {
  const input = value.trim();
  if (!input || !input.includes("@") || /\s/.test(input)) return null;

  const atIndex = input.lastIndexOf("@");
  const username = input.slice(0, atIndex).trim();
  const target = input.slice(atIndex + 1).trim();
  if (!username || !target) return null;

  let host = target;
  let port = 22;

  if (target.startsWith("[")) {
    const closingBracket = target.indexOf("]");
    if (closingBracket === -1) return null;
    host = target.slice(1, closingBracket).trim();
    const rest = target.slice(closingBracket + 1);
    if (rest.startsWith(":")) {
      const parsedPort = Number(rest.slice(1));
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return null;
      port = parsedPort;
    } else if (rest.length > 0) {
      return null;
    }
  } else {
    const lastColon = target.lastIndexOf(":");
    if (lastColon > -1 && target.indexOf(":") === lastColon) {
      const maybePort = target.slice(lastColon + 1);
      if (/^\d+$/.test(maybePort)) {
        const parsedPort = Number(maybePort);
        if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return null;
        port = parsedPort;
        host = target.slice(0, lastColon).trim();
      }
    }
  }

  if (!host) return null;

  const displayHost = target.startsWith("[") ? `[${host}]` : host;
  return {
    username,
    host,
    port,
    hostAddress: `${username}@${displayHost}`,
    label: `${username}@${displayHost}:${port}`,
  };
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const [quickConnectAuthMethod, setQuickConnectAuthMethod] = useState<SessionConnection["authMethod"]>("agent");
  const [quickConnectPassword, setQuickConnectPassword] = useState("");
  const [quickConnectPrivateKey, setQuickConnectPrivateKey] = useState("");
  const [quickConnectPassphrase, setQuickConnectPassphrase] = useState("");
  const [quickConnectError, setQuickConnectError] = useState<string | null>(null);
  const hosts = useHostsStore((s) => s.hosts);
  const getCredential = useCredentialsStore((s) => s.getCredential);
  const openSession = useSessionsStore((s) => s.openSession);
  const openQuickConnectSession = useSessionsStore((s) => s.openQuickConnectSession);
  const openSftpTab = useSessionsStore((s) => s.openSftpTab);
  const sessionOpenMode = useSettingsStore((s) => s.settings.terminal.sessionOpenMode);
  const standaloneWindow = isStandaloneWindow(location.search);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setQuickConnectAuthMethod("agent");
      setQuickConnectPassword("");
      setQuickConnectPrivateKey("");
      setQuickConnectPassphrase("");
      setQuickConnectError(null);
    }
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

  const quickConnectCandidate = useMemo(
    () => parseQuickConnect(query),
    [query]
  );

  const quickActions = [
    {
      id: "new-host",
      label: t("commandPalette.actions.newHost"),
      icon: Plus,
      action: () => navigate(buildAppRoute("/hosts/new", standaloneWindow)),
    },
    {
      id: "backup",
      label: t("commandPalette.actions.openBackup"),
      icon: ShieldEllipsis,
      action: () => navigate(buildAppRoute("/backup", standaloneWindow)),
    },
    {
      id: "settings",
      label: t("commandPalette.actions.openSettings"),
      icon: Settings,
      action: () => navigate(buildAppRoute("/settings", standaloneWindow)),
    },
    {
      id: "operations",
      label: t("commandPalette.actions.openOperations"),
      icon: Workflow,
      action: () => navigate(buildAppRoute("/operations", standaloneWindow)),
    },
  ].filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));

  const connectToHost = async (hostId: string, mode: "terminal" | "sftp") => {
    const host = hosts.find((entry) => entry.id === hostId);
    if (!host) return;
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = credential?.username ?? host.username ?? "";
    const hostAddress = username ? `${username}@${host.host}` : host.host;

    onClose();

    if (mode === "terminal") {
      const route = await launchTerminalSession({
        hostId: host.id,
        hostLabel: host.label,
        hostAddress,
        openMode: sessionOpenMode,
        openSession,
        standaloneWindow,
      });
      if (route) navigate(route);
      return;
    }

    const tabId = openSftpTab(host.id, host.label, hostAddress);
    navigate(
      buildSessionRoute("sftp", tabId, {
        standalone: standaloneWindow,
        hostId: standaloneWindow ? host.id : undefined,
        hostLabel: standaloneWindow ? host.label : undefined,
        hostAddress: standaloneWindow ? hostAddress : undefined,
      })
    );
  };

  const connectDirectly = async () => {
    if (!quickConnectCandidate) return;

    if (quickConnectAuthMethod === "password" && !quickConnectPassword.trim()) {
      setQuickConnectError(t("commandPalette.directConnectPasswordRequired"));
      return;
    }

    if (quickConnectAuthMethod === "privateKey" && !quickConnectPrivateKey.trim()) {
      setQuickConnectError(t("commandPalette.directConnectKeyRequired"));
      return;
    }

    const connection: SessionConnection = {
      source: "quick-connect",
      host: quickConnectCandidate.host,
      port: quickConnectCandidate.port,
      username: quickConnectCandidate.username,
      authMethod: quickConnectAuthMethod,
      password: quickConnectAuthMethod === "password" ? quickConnectPassword : null,
      privateKeyContent: quickConnectAuthMethod === "privateKey" ? quickConnectPrivateKey : null,
      passphrase: quickConnectAuthMethod === "privateKey" ? quickConnectPassphrase || null : null,
    };

    setQuickConnectError(null);
    onClose();
    const route = await launchQuickConnectSession({
      connection,
      hostLabel: quickConnectCandidate.label,
      hostAddress: quickConnectCandidate.hostAddress,
      openMode: sessionOpenMode,
      openQuickConnectSession,
      standaloneWindow,
    });
    if (route) navigate(route);
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
            onKeyDown={(event) => {
              if (event.key === "Enter" && quickConnectCandidate) {
                event.preventDefault();
                void connectDirectly();
              }
            }}
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

        {quickConnectCandidate && (
          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              {t("commandPalette.directConnect")}
            </p>
            <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)]">
                  <Zap size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--text-primary)]">
                    {quickConnectCandidate.label}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("commandPalette.directConnectHint")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void connectDirectly()}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--border-focus)]"
                >
                  {t("commandPalette.directConnectAction")}
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  {t("hostEditor.fields.authMethod")}
                  <select
                    value={quickConnectAuthMethod}
                    onChange={(event) => {
                      setQuickConnectAuthMethod(event.target.value as SessionConnection["authMethod"]);
                      setQuickConnectError(null);
                    }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                  >
                    <option value="agent">{t("credentials.authMethods.agent")}</option>
                    <option value="password">{t("credentials.authMethods.password")}</option>
                    <option value="privateKey">{t("credentials.authMethods.privateKey")}</option>
                  </select>
                </label>
              </div>

              {quickConnectAuthMethod === "password" && (
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  {t("credentials.fields.password")}
                  <input
                    type="password"
                    value={quickConnectPassword}
                    onChange={(event) => {
                      setQuickConnectPassword(event.target.value);
                      setQuickConnectError(null);
                    }}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                  />
                </label>
              )}

              {quickConnectAuthMethod === "privateKey" && (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    {t("hostEditor.fields.privateKey")}
                    <textarea
                      value={quickConnectPrivateKey}
                      onChange={(event) => {
                        setQuickConnectPrivateKey(event.target.value);
                        setQuickConnectError(null);
                      }}
                      rows={5}
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                    {t("hostEditor.fields.passphrase")}
                    <input
                      type="password"
                      value={quickConnectPassphrase}
                      onChange={(event) => {
                        setQuickConnectPassphrase(event.target.value);
                        setQuickConnectError(null);
                      }}
                      className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                    />
                  </label>
                </div>
              )}

              {quickConnectError && (
                <p className="text-xs text-red-400">{quickConnectError}</p>
              )}
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
