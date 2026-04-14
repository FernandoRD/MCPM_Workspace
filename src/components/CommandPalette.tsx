import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FolderOpen, Plus, Search, Server, Settings, ShieldEllipsis, Workflow, Zap, Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSessionsStore } from "@/store/sessions";
import { useSettingsStore } from "@/store/settings";
import { Modal } from "@/components/ui/Modal";
import { matchesHostSearch, sortHosts } from "@/lib/hostSearch";
import { launchQuickConnectSession, launchRdpSession, launchTerminalSession, launchVncSession } from "@/lib/sessionLauncher";
import { buildAppRoute, buildSessionRoute, isStandaloneWindow } from "@/lib/windowMode";
import { ConnectionProtocol, SessionConnection } from "@/types";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface ParsedQuickConnect {
  protocol: ConnectionProtocol;
  username: string;
  host: string;
  port: number;
  hostAddress: string;
  label: string;
}

function parseTargetHost(target: string, defaultPort: number): Omit<ParsedQuickConnect, "protocol" | "username" | "hostAddress" | "label"> | null {
  let host = target;
  let port = defaultPort;

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
  return { host, port };
}

function parseSshQuickConnect(value: string): ParsedQuickConnect | null {
  const input = value.trim();
  if (!input || !input.includes("@") || /\s/.test(input)) return null;

  const atIndex = input.lastIndexOf("@");
  const username = input.slice(0, atIndex).trim();
  const target = input.slice(atIndex + 1).trim();
  if (!username || !target) return null;

  const parsedTarget = parseTargetHost(target, 22);
  if (!parsedTarget) return null;

  const displayHost = target.startsWith("[") ? `[${parsedTarget.host}]` : parsedTarget.host;
  return {
    protocol: "ssh",
    username,
    host: parsedTarget.host,
    port: parsedTarget.port,
    hostAddress: `${username}@${displayHost}`,
    label: `${username}@${displayHost}:${parsedTarget.port}`,
  };
}

function parseTelnetQuickConnect(value: string): ParsedQuickConnect | null {
  const input = value.trim();
  const lowerInput = input.toLowerCase();
  if (!lowerInput.startsWith("telnet://") && !lowerInput.startsWith("telnet ")) return null;

  const target = lowerInput.startsWith("telnet://")
    ? input.slice("telnet://".length).trim()
    : input.slice("telnet".length).trim();
  if (!target || /\s/.test(target)) return null;

  const parsedTarget = parseTargetHost(target, 23);
  if (!parsedTarget) return null;
  const displayHost = target.startsWith("[") ? `[${parsedTarget.host}]` : parsedTarget.host;

  return {
    protocol: "telnet",
    username: "",
    host: parsedTarget.host,
    port: parsedTarget.port,
    hostAddress: displayHost,
    label: `telnet ${displayHost}:${parsedTarget.port}`,
  };
}

function parseRdpQuickConnect(value: string): ParsedQuickConnect | null {
  const input = value.trim();
  const lowerInput = input.toLowerCase();
  if (!lowerInput.startsWith("rdp://") && !lowerInput.startsWith("rdp ")) return null;

  const target = lowerInput.startsWith("rdp://")
    ? input.slice("rdp://".length).trim()
    : input.slice("rdp".length).trim();
  if (!target || /\s/.test(target)) return null;

  const atIndex = target.lastIndexOf("@");
  const username = atIndex > -1 ? target.slice(0, atIndex).trim() : "";
  const hostTarget = atIndex > -1 ? target.slice(atIndex + 1).trim() : target;
  if (!hostTarget) return null;

  const parsedTarget = parseTargetHost(hostTarget, 3389);
  if (!parsedTarget) return null;
  const displayHost = hostTarget.startsWith("[") ? `[${parsedTarget.host}]` : parsedTarget.host;

  return {
    protocol: "rdp",
    username,
    host: parsedTarget.host,
    port: parsedTarget.port,
    hostAddress: username ? `${username}@${displayHost}` : displayHost,
    label: `rdp ${username ? `${username}@` : ""}${displayHost}:${parsedTarget.port}`,
  };
}

function parseVncQuickConnect(value: string): ParsedQuickConnect | null {
  const input = value.trim();
  const lowerInput = input.toLowerCase();
  if (!lowerInput.startsWith("vnc://") && !lowerInput.startsWith("vnc ")) return null;

  const target = lowerInput.startsWith("vnc://")
    ? input.slice("vnc://".length).trim()
    : input.slice("vnc".length).trim();
  if (!target || /\s/.test(target)) return null;

  const parsedTarget = parseTargetHost(target, 5900);
  if (!parsedTarget) return null;
  const displayHost = target.startsWith("[") ? `[${parsedTarget.host}]` : parsedTarget.host;

  return {
    protocol: "vnc",
    username: "",
    host: parsedTarget.host,
    port: parsedTarget.port,
    hostAddress: displayHost,
    label: `vnc ${displayHost}:${parsedTarget.port}`,
  };
}

function parseQuickConnect(value: string): ParsedQuickConnect | null {
  return parseTelnetQuickConnect(value) ?? parseRdpQuickConnect(value) ?? parseVncQuickConnect(value) ?? parseSshQuickConnect(value);
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
  const openRdpTab = useSessionsStore((s) => s.openRdpTab);
  const openVncTab = useSessionsStore((s) => s.openVncTab);
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

  const connectToHost = async (hostId: string, mode: "terminal" | "sftp" | "rdp" | "vnc") => {
    const host = hosts.find((entry) => entry.id === hostId);
    if (!host) return;
    if (mode === "sftp" && host.protocol !== "ssh") return;
    if (mode === "rdp" && host.protocol !== "rdp") return;
    if (mode === "vnc" && host.protocol !== "vnc") return;
    const credential = host.credentialId ? getCredential(host.credentialId) : undefined;
    const username = credential?.username ?? host.username ?? "";
    const hostAddress = host.protocol === "telnet" || host.protocol === "vnc"
      ? host.host
      : username ? `${username}@${host.host}` : host.host;

    onClose();

    if (mode === "rdp") {
      const route = await launchRdpSession({
        hostId: host.id,
        hostLabel: host.label,
        hostAddress,
        openMode: sessionOpenMode,
        openRdpTab,
        standaloneWindow,
      });
      if (route) navigate(route);
      return;
    }
    if (mode === "vnc") {
      const route = await launchVncSession({
        hostId: host.id,
        hostLabel: host.label,
        hostAddress,
        openMode: sessionOpenMode,
        openVncTab,
        standaloneWindow,
      });
      if (route) navigate(route);
      return;
    }

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

    if (quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "password" && !quickConnectPassword.trim()) {
      setQuickConnectError(t("commandPalette.directConnectPasswordRequired"));
      return;
    }

    if (quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "privateKey" && !quickConnectPrivateKey.trim()) {
      setQuickConnectError(t("commandPalette.directConnectKeyRequired"));
      return;
    }

    const connection: SessionConnection = {
      source: "quick-connect",
      protocol: quickConnectCandidate.protocol,
      host: quickConnectCandidate.host,
      port: quickConnectCandidate.port,
      username: quickConnectCandidate.username,
      authMethod:
        quickConnectCandidate.protocol === "telnet"
          ? "password"
          : quickConnectCandidate.protocol === "rdp"
            ? "password"
            : quickConnectCandidate.protocol === "vnc"
            ? "password"
            : quickConnectAuthMethod,
      password:
        quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "password"
          ? quickConnectPassword
          : quickConnectCandidate.protocol === "rdp"
            ? quickConnectPassword || null
            : quickConnectCandidate.protocol === "vnc"
            ? quickConnectPassword || null
            : null,
      privateKeyContent: quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "privateKey" ? quickConnectPrivateKey : null,
      passphrase: quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "privateKey" ? quickConnectPassphrase || null : null,
    };

    setQuickConnectError(null);
    onClose();
    const route = await launchQuickConnectSession({
      connection,
      hostLabel: quickConnectCandidate.label,
      hostAddress: quickConnectCandidate.hostAddress,
      openMode: sessionOpenMode,
      openQuickConnectSession,
      sessionType:
        quickConnectCandidate.protocol === "rdp"
          ? "rdp"
          : quickConnectCandidate.protocol === "vnc"
            ? "vnc"
            : "terminal",
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
                    {t(
                      quickConnectCandidate.protocol === "telnet"
                        ? "commandPalette.directConnectTelnetHint"
                        : quickConnectCandidate.protocol === "rdp"
                          ? "commandPalette.directConnectRdpHint"
                          : quickConnectCandidate.protocol === "vnc"
                            ? "commandPalette.directConnectVncHint"
                        : "commandPalette.directConnectHint"
                    )}
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

              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="rounded-full border border-[var(--border)] px-2 py-1">
                  {t(`protocols.${quickConnectCandidate.protocol}`)}
                </span>
              </div>

              {quickConnectCandidate.protocol === "ssh" && (
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
              )}

              {quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "password" && (
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

              {quickConnectCandidate.protocol === "rdp" && (
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  {t("credentials.fields.password")}
                  <input
                    type="password"
                    value={quickConnectPassword}
                    onChange={(event) => {
                      setQuickConnectPassword(event.target.value);
                      setQuickConnectError(null);
                    }}
                    placeholder={t("commandPalette.directConnectRdpPasswordPlaceholder")}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                  />
                </label>
              )}

              {quickConnectCandidate.protocol === "vnc" && (
                <label className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                  {t("credentials.fields.password")}
                  <input
                    type="password"
                    value={quickConnectPassword}
                    onChange={(event) => {
                      setQuickConnectPassword(event.target.value);
                      setQuickConnectError(null);
                    }}
                    placeholder={t("commandPalette.directConnectVncPasswordPlaceholder")}
                    className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--border-focus)]"
                  />
                </label>
              )}

              {quickConnectCandidate.protocol === "ssh" && quickConnectAuthMethod === "privateKey" && (
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
                        <div className="flex items-center gap-2">
                          <p className="truncate text-xs text-[var(--text-muted)]">
                            {host.protocol === "ssh" && username ? `${username}@` : ""}{host.host}:{host.port}
                          </p>
                          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">
                            {t(`protocols.${host.protocol}`)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => connectToHost(host.id, host.protocol === "rdp" ? "rdp" : host.protocol === "vnc" ? "vnc" : "terminal")}
                          className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--border-focus)]"
                        >
                          <span className="inline-flex items-center gap-1">
                            {host.protocol === "rdp" || host.protocol === "vnc" ? <Monitor size={12} /> : null}
                            {t(host.protocol === "rdp" || host.protocol === "vnc" ? "commandPalette.desktop" : "commandPalette.terminal")}
                          </span>
                        </button>
                        {host.protocol === "ssh" && (
                          <button
                            onClick={() => connectToHost(host.id, "sftp")}
                            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--border-focus)]"
                          >
                            <span className="inline-flex items-center gap-1">
                              <FolderOpen size={12} />
                              {t("commandPalette.sftp")}
                            </span>
                          </button>
                        )}
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
