import { useEffect, useMemo, useState, type ElementType } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import {
  deleteKnownHost,
  formatHostKey,
  HealthCheckResult,
  KnownHostEntry,
  listKnownHosts,
  runHealthCheck,
  setKnownHost,
} from "@/lib/health";
import { HostEntry } from "@/types";
import { isSshHost } from "@/lib/productivity";
import { cn } from "@/lib/utils";

interface HostHealthRecord {
  result?: HealthCheckResult;
  loading: boolean;
  checkedAt?: string;
}

interface KnownHostDraft {
  previousHostKey: string | null;
  hostKey: string;
  fingerprint: string;
}

type InventoryFeedback =
  | {
      tone: "success" | "error";
      message: string;
    }
  | null;

const HEALTH_GRID_CLASSES =
  "grid grid-cols-[minmax(0,1.8fr)_100px_100px_120px_140px_minmax(0,1.1fr)_minmax(0,1.1fr)_220px] gap-3";

export function Health() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const [search, setSearch] = useState("");
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventorySaving, setInventorySaving] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [records, setRecords] = useState<Record<string, HostHealthRecord>>({});
  const [inventoryEntries, setInventoryEntries] = useState<KnownHostEntry[]>([]);
  const [feedback, setFeedback] = useState<InventoryFeedback>(null);
  const [editorDraft, setEditorDraft] = useState<KnownHostDraft | null>(null);
  const [editorError, setEditorError] = useState<string | null>(null);

  const visibleHosts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return hosts;
    return hosts.filter((host) =>
      [host.label, host.host, host.protocol, host.group ?? "", ...(host.tags ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(query)
    );
  }, [hosts, search]);

  const visibleSshHosts = useMemo(
    () => visibleHosts.filter((host) => isSshHost(host)),
    [visibleHosts]
  );

  const inventoryHostKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const host of hosts.filter((entry) => isSshHost(entry))) {
      keys.add(formatHostKey(host.host, host.port));
    }
    return keys;
  }, [hosts]);

  const inventoryMap = useMemo(
    () => new Map(inventoryEntries.map((entry) => [entry.host_key, entry.fingerprint])),
    [inventoryEntries]
  );

  const orphanedEntries = useMemo(
    () => inventoryEntries.filter((entry) => !inventoryHostKeys.has(entry.host_key)),
    [inventoryEntries, inventoryHostKeys]
  );

  const inventoryCount = useMemo(
    () =>
      visibleSshHosts.filter((host) => inventoryMap.has(formatHostKey(host.host, host.port))).length,
    [inventoryMap, visibleSshHosts]
  );

  const onlineCount = useMemo(
    () => Object.values(records).filter((record) => record.result?.reachable).length,
    [records]
  );

  const issueCount = useMemo(
    () =>
      Object.values(records).filter((record) => {
        const status = record.result?.fingerprint_status;
        return status === "mismatch" || status === "unreachable" || !!record.result?.error;
      }).length,
    [records]
  );

  const syncInventoryIntoRecords = (knownHosts: KnownHostEntry[]) => {
    setInventoryEntries(knownHosts);
    setRecords((current) => {
      const next = { ...current };
      const nextInventoryMap = new Map(knownHosts.map((entry) => [entry.host_key, entry.fingerprint]));

      for (const host of hosts.filter((entry) => isSshHost(entry))) {
        const hostKey = formatHostKey(host.host, host.port);
        const previousRecord = next[host.id];
        const previousResult = previousRecord?.result;
        const storedFingerprint = nextInventoryMap.get(hostKey) ?? null;

        let fingerprintStatus: HealthCheckResult["fingerprint_status"] | "unknown" =
          previousResult?.fingerprint_status ?? "unknown";

        if (previousResult?.fingerprint) {
          fingerprintStatus = storedFingerprint
            ? previousResult.fingerprint === storedFingerprint
              ? "match"
              : "mismatch"
            : "new";
        } else if (previousResult?.fingerprint_status !== "unreachable") {
          fingerprintStatus = storedFingerprint ? "stored-only" : "unknown";
        }

        next[host.id] = {
          ...previousRecord,
          loading: previousRecord?.loading ?? false,
          checkedAt: previousRecord?.checkedAt,
          result: {
            reachable: previousResult?.reachable ?? false,
            latency_ms: previousResult?.latency_ms ?? null,
            error: previousResult?.error ?? null,
            host_key: hostKey,
            fingerprint: previousResult?.fingerprint ?? null,
            stored_fingerprint: storedFingerprint,
            fingerprint_status: fingerprintStatus,
          },
        };
      }

      return next;
    });
  };

  const loadInventory = async (silent = false) => {
    setInventoryLoading(true);
    if (!silent) setFeedback(null);
    try {
      const knownHosts = await listKnownHosts();
      syncInventoryIntoRecords(knownHosts);
    } catch (error) {
      setFeedback({
        tone: "error",
        message: t("health.editor.loadError", { error: String(error) }),
      });
    } finally {
      setInventoryLoading(false);
    }
  };

  useEffect(() => {
    void loadInventory(true);
    // Recarrega ao mudar a lista de hosts para manter órfãos e linhas alinhados.
  }, [hosts]);

  const runCheck = async (host: HostEntry) => {
    if (!isSshHost(host)) return;
    setRecords((current) => ({
      ...current,
      [host.id]: { ...current[host.id], loading: true },
    }));
    try {
      const result = await runHealthCheck(host.host, host.port, host.sshCompat?.preset);
      setRecords((current) => ({
        ...current,
        [host.id]: {
          loading: false,
          result,
          checkedAt: new Date().toISOString(),
        },
      }));
    } catch (error) {
      setRecords((current) => ({
        ...current,
        [host.id]: {
          loading: false,
          checkedAt: new Date().toISOString(),
          result: {
            reachable: false,
            latency_ms: null,
            error: String(error),
            host_key: formatHostKey(host.host, host.port),
            fingerprint: null,
            stored_fingerprint: current[host.id]?.result?.stored_fingerprint ?? null,
            fingerprint_status: "unknown",
          },
        },
      }));
    }
  };

  const runAllChecks = async () => {
    setRunningAll(true);
    try {
      for (const host of visibleSshHosts) {
        // Mantemos sequencial para não saturar a rede local nem o provider DNS.
        // A lista costuma ser pequena o bastante para uma rodada manual.
        // eslint-disable-next-line no-await-in-loop
        await runCheck(host);
      }
    } finally {
      setRunningAll(false);
    }
  };

  const openNewEntryEditor = () => {
    setEditorError(null);
    setEditorDraft({
      previousHostKey: null,
      hostKey: "",
      fingerprint: "",
    });
  };

  const openEntryEditor = (entry: { host_key: string; fingerprint?: string | null }) => {
    setEditorError(null);
    setEditorDraft({
      previousHostKey: entry.host_key,
      hostKey: entry.host_key,
      fingerprint: entry.fingerprint ?? "",
    });
  };

  const saveInventoryEntry = async () => {
    if (!editorDraft) return;

    const hostKey = editorDraft.hostKey.trim();
    const fingerprint = editorDraft.fingerprint.trim();

    if (!hostKey || !fingerprint) {
      setEditorError(t("health.editor.validation"));
      return;
    }

    setInventorySaving(true);
    setEditorError(null);
    try {
      await setKnownHost(hostKey, fingerprint, editorDraft.previousHostKey);
      await loadInventory(true);
      setEditorDraft(null);
      setFeedback({
        tone: "success",
        message: t("health.editor.saveSuccess", { hostKey }),
      });
    } catch (error) {
      setEditorError(t("health.editor.saveError", { error: String(error) }));
    } finally {
      setInventorySaving(false);
    }
  };

  const deleteInventoryEntry = async (hostKey: string) => {
    if (!window.confirm(t("health.editor.deleteConfirm", { hostKey }))) return;

    setInventorySaving(true);
    setFeedback(null);
    try {
      await deleteKnownHost(hostKey);
      await loadInventory(true);
      setFeedback({
        tone: "success",
        message: t("health.editor.deleteSuccess", { hostKey }),
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        message: t("health.editor.deleteError", { error: String(error) }),
      });
    } finally {
      setInventorySaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("health.title")}</h1>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{t("health.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void loadInventory()} disabled={inventoryLoading || inventorySaving}>
            {inventoryLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {t("health.actions.loadInventory")}
          </Button>
          <Button variant="secondary" onClick={openNewEntryEditor} disabled={inventorySaving}>
            <Plus size={14} />
            {t("health.actions.addInventory")}
          </Button>
          <Button onClick={runAllChecks} disabled={runningAll || visibleSshHosts.length === 0}>
            {runningAll ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            {t("health.actions.runAll")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard
              icon={CheckCircle2}
              label={t("health.summary.online")}
              value={`${onlineCount}/${visibleSshHosts.length}`}
              tone="success"
            />
            <SummaryCard
              icon={ShieldCheck}
              label={t("health.summary.inventory")}
              value={`${inventoryCount}/${visibleSshHosts.length}`}
              tone="accent"
            />
            <SummaryCard
              icon={AlertTriangle}
              label={t("health.summary.issues")}
              value={String(issueCount)}
              tone={issueCount > 0 ? "danger" : "muted"}
            />
            <SummaryCard
              icon={ShieldQuestion}
              label={t("health.summary.unsupported")}
              value={String(visibleHosts.length - visibleSshHosts.length)}
              tone={visibleHosts.length - visibleSshHosts.length > 0 ? "muted" : "accent"}
            />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-muted)]">
            {t("health.sshOnlyHint")}
          </div>

          {feedback && (
            <div
              className={cn(
                "rounded-xl border px-4 py-3 text-sm",
                feedback.tone === "success"
                  ? "border-[var(--success)]/20 bg-[var(--success)]/10 text-[var(--success)]"
                  : "border-[var(--danger)]/20 bg-[var(--danger)]/8 text-[var(--danger)]"
              )}
            >
              {feedback.message}
            </div>
          )}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
            <div className="relative max-w-md">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("health.searchPlaceholder")}
                className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-focus)] focus:outline-none"
              />
            </div>
          </div>

          {orphanedEntries.length > 0 && (
            <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-4 py-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">{t("health.orphaned.title")}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("health.orphaned.description", { count: orphanedEntries.length })}
              </p>
              <div className="mt-3 flex flex-col gap-2">
                {orphanedEntries.map((entry) => (
                  <div
                    key={entry.host_key}
                    className="flex flex-col gap-3 rounded-lg border border-[var(--danger)]/15 bg-[var(--bg-secondary)]/70 px-3 py-3 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{entry.host_key}</p>
                      <p className="truncate text-xs text-[var(--text-muted)]">{entry.fingerprint}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEntryEditor(entry)}
                        disabled={inventorySaving}
                      >
                        <Pencil size={14} />
                        {t("health.actions.editInventory")}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => void deleteInventoryEntry(entry.host_key)}
                        disabled={inventorySaving}
                      >
                        <Trash2 size={14} />
                        {t("health.actions.deleteInventory")}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
            <div className={cn(HEALTH_GRID_CLASSES, "border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]")}>
              <span>{t("health.table.host")}</span>
              <span>{t("health.table.protocol")}</span>
              <span>{t("health.table.status")}</span>
              <span>{t("health.table.latency")}</span>
              <span>{t("health.table.fingerprint")}</span>
              <span>{t("health.table.liveFingerprint")}</span>
              <span>{t("health.table.storedFingerprint")}</span>
              <span>{t("health.table.actions")}</span>
            </div>

            {visibleHosts.length === 0 ? (
              <div className="px-4 py-8 text-sm text-[var(--text-muted)]">{t("health.empty")}</div>
            ) : (
              visibleHosts.map((host) => (
                <HealthRow
                  key={host.id}
                  host={host}
                  record={records[host.id]}
                  inventorySaving={inventorySaving}
                  onRun={() => void runCheck(host)}
                  onEditInventory={(entry) => openEntryEditor(entry)}
                  onDeleteInventory={(hostKey) => void deleteInventoryEntry(hostKey)}
                />
              ))
            )}
          </div>
        </div>
      </div>

      <Modal
        open={!!editorDraft}
        onClose={() => {
          if (inventorySaving) return;
          setEditorDraft(null);
          setEditorError(null);
        }}
        title={t(editorDraft?.previousHostKey ? "health.editor.editTitle" : "health.editor.createTitle")}
        size="md"
      >
        {editorDraft && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--text-muted)]">{t("health.editor.description")}</p>

            <Input
              id="known-host-key"
              label={t("health.editor.hostKeyLabel")}
              value={editorDraft.hostKey}
              onChange={(event) => {
                const hostKey = event.target.value;
                setEditorDraft((current) => (current ? { ...current, hostKey } : current));
              }}
              placeholder={t("health.editor.hostKeyPlaceholder")}
              disabled={inventorySaving}
            />

            <Input
              id="known-host-fingerprint"
              label={t("health.editor.fingerprintLabel")}
              value={editorDraft.fingerprint}
              onChange={(event) => {
                const fingerprint = event.target.value;
                setEditorDraft((current) => (current ? { ...current, fingerprint } : current));
              }}
              placeholder={t("health.editor.fingerprintPlaceholder")}
              disabled={inventorySaving}
            />

            {editorError && (
              <div className="rounded-lg border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-3 py-2 text-sm text-[var(--danger)]">
                {editorError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setEditorDraft(null);
                  setEditorError(null);
                }}
                disabled={inventorySaving}
              >
                {t("health.editor.cancel")}
              </Button>
              <Button onClick={() => void saveInventoryEntry()} disabled={inventorySaving}>
                {inventorySaving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                {t("health.editor.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: ElementType;
  label: string;
  value: string;
  tone: "success" | "danger" | "accent" | "muted";
}) {
  const toneClasses = {
    success: "text-[var(--success)] bg-[var(--success)]/10 border-[var(--success)]/20",
    danger: "text-[var(--danger)] bg-[var(--danger)]/10 border-[var(--danger)]/20",
    accent: "text-[var(--accent)] bg-[var(--accent-subtle)] border-[var(--accent)]/20",
    muted: "text-[var(--text-muted)] bg-[var(--bg-secondary)] border-[var(--border)]",
  };

  return (
    <div className={cn("rounded-xl border px-4 py-3", toneClasses[tone])}>
      <div className="flex items-center gap-2 text-xs font-medium">
        <Icon size={14} />
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function HealthRow({
  host,
  record,
  inventorySaving,
  onRun,
  onEditInventory,
  onDeleteInventory,
}: {
  host: HostEntry;
  record?: HostHealthRecord;
  inventorySaving: boolean;
  onRun: () => void;
  onEditInventory: (entry: { host_key: string; fingerprint?: string | null }) => void;
  onDeleteInventory: (hostKey: string) => void;
}) {
  const { t } = useTranslation();
  const sshHost = isSshHost(host);
  const result = record?.result;
  const status = sshHost ? result?.fingerprint_status ?? "unknown" : "unsupported";
  const hostKey = result?.host_key ?? formatHostKey(host.host, host.port);
  const canDeleteInventory = !!result?.stored_fingerprint;

  const handleCopy = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  };

  return (
    <div className={cn(HEALTH_GRID_CLASSES, "border-b border-[var(--border)] px-4 py-3 last:border-b-0")}>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{host.label}</p>
        <p className="truncate text-xs text-[var(--text-muted)]">
          {host.host}:{host.port}
        </p>
      </div>

      <div className="flex items-center">
        <Badge variant={host.protocol === "ssh" ? "accent" : "warning"}>
          {host.protocol.toUpperCase()}
        </Badge>
      </div>

      <div className="flex items-center">
        <StatusBadge status={status} />
      </div>

      <div className="flex items-center text-sm text-[var(--text-secondary)]">
        {record?.loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : !sshHost ? (
          "—"
        ) : result?.latency_ms ? (
          `${result.latency_ms} ms`
        ) : (
          "—"
        )}
      </div>

      <div className="flex items-center text-xs text-[var(--text-muted)]">
        {hostKey}
      </div>

      <FingerprintCell
        value={result?.fingerprint}
        onCopy={handleCopy}
        emptyLabel={
          !sshHost ? t("health.fingerprint.unsupported") : result?.reachable ? t("health.fingerprint.notRead") : "—"
        }
      />

      <FingerprintCell
        value={result?.stored_fingerprint}
        onCopy={handleCopy}
        emptyLabel={!sshHost ? t("health.fingerprint.unsupported") : t("health.fingerprint.notStored")}
      />

      <div className="flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onRun} disabled={record?.loading || !sshHost}>
          {record?.loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {sshHost ? t("health.actions.check") : t("health.actions.unsupported")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onEditInventory({ host_key: hostKey, fingerprint: result?.stored_fingerprint ?? result?.fingerprint })}
          disabled={!sshHost || inventorySaving}
        >
          <Pencil size={14} />
          {t("health.actions.editInventory")}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => onDeleteInventory(hostKey)}
          disabled={!sshHost || !canDeleteInventory || inventorySaving}
        >
          <Trash2 size={14} />
          {t("health.actions.deleteInventory")}
        </Button>
      </div>

      {result?.error && (
        <div className="col-span-8 rounded-lg bg-[var(--danger)]/8 px-3 py-2 text-xs text-[var(--danger)]">
          {result.error}
        </div>
      )}
    </div>
  );
}

function FingerprintCell({
  value,
  onCopy,
  emptyLabel,
}: {
  value?: string | null;
  onCopy: (value?: string | null) => void | Promise<void>;
  emptyLabel: string;
}) {
  if (!value) {
    return <div className="flex items-center text-xs text-[var(--text-muted)]">{emptyLabel}</div>;
  }

  return (
    <button
      onClick={() => onCopy(value)}
      className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-[var(--bg-hover)]"
      title={value}
    >
      <span className="truncate text-xs text-[var(--text-secondary)]">{value}</span>
      <Copy size={12} className="shrink-0 text-[var(--text-muted)]" />
    </button>
  );
}

function StatusBadge({ status }: { status: HealthCheckResult["fingerprint_status"] | "unknown" | "unsupported" }) {
  const { t } = useTranslation();

  const config = {
    match: {
      label: t("health.status.match"),
      className: "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20",
      icon: ShieldCheck,
    },
    mismatch: {
      label: t("health.status.mismatch"),
      className: "bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/20",
      icon: ShieldAlert,
    },
    new: {
      label: t("health.status.new"),
      className: "bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent)]/20",
      icon: Activity,
    },
    "stored-only": {
      label: t("health.status.storedOnly"),
      className: "bg-[var(--bg-primary)] text-[var(--text-secondary)] border-[var(--border)]",
      icon: ShieldQuestion,
    },
    unknown: {
      label: t("health.status.unknown"),
      className: "bg-[var(--bg-primary)] text-[var(--text-muted)] border-[var(--border)]",
      icon: ShieldQuestion,
    },
    unreachable: {
      label: t("health.status.unreachable"),
      className: "bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/20",
      icon: WifiOff,
    },
    unsupported: {
      label: t("health.status.unsupported"),
      className: "bg-[var(--warning)]/10 text-[var(--warning)] border-[var(--warning)]/20",
      icon: ShieldQuestion,
    },
  }[status];

  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium", config.className)}>
      <Icon size={12} />
      {config.label}
    </span>
  );
}
