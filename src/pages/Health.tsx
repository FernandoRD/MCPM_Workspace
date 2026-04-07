import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  WifiOff,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { listKnownHosts, runHealthCheck, formatHostKey, HealthCheckResult } from "@/lib/health";
import { HostEntry } from "@/types";
import { isSshHost } from "@/lib/productivity";
import { cn } from "@/lib/utils";

interface HostHealthRecord {
  result?: HealthCheckResult;
  loading: boolean;
  checkedAt?: string;
}

export function Health() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const [search, setSearch] = useState("");
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [records, setRecords] = useState<Record<string, HostHealthRecord>>({});
  const [orphanedEntries, setOrphanedEntries] = useState<string[]>([]);

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

  const inventoryCount = useMemo(() => {
    let count = 0;
    for (const record of Object.values(records)) {
      if (record.result?.stored_fingerprint) count += 1;
    }
    return count;
  }, [records]);

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

  const loadInventory = async () => {
    setInventoryLoading(true);
    try {
      const knownHosts = await listKnownHosts();
      setOrphanedEntries(
        knownHosts
          .map((entry) => entry.host_key)
          .filter((hostKey) => !inventoryHostKeys.has(hostKey))
      );
      setRecords((current) => {
        const next = { ...current };
        for (const host of hosts.filter((entry) => isSshHost(entry))) {
          const hostKey = formatHostKey(host.host, host.port);
          const inventoryEntry = knownHosts.find((entry) => entry.host_key === hostKey);
          if (!inventoryEntry) continue;
          next[host.id] = {
            ...next[host.id],
            result: {
              reachable: next[host.id]?.result?.reachable ?? false,
              latency_ms: next[host.id]?.result?.latency_ms ?? null,
              error: next[host.id]?.result?.error ?? null,
              host_key: hostKey,
              fingerprint: next[host.id]?.result?.fingerprint ?? null,
              stored_fingerprint: inventoryEntry.fingerprint,
              fingerprint_status: next[host.id]?.result?.fingerprint_status ?? "stored-only",
            },
            checkedAt: next[host.id]?.checkedAt,
            loading: false,
          };
        }
        return next;
      });
    } finally {
      setInventoryLoading(false);
    }
  };

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("health.title")}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{t("health.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={loadInventory} disabled={inventoryLoading}>
            {inventoryLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            {t("health.actions.loadInventory")}
          </Button>
          <Button onClick={runAllChecks} disabled={runningAll || visibleSshHosts.length === 0}>
            {runningAll ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            {t("health.actions.runAll")}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
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
                className="w-full h-9 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
              />
            </div>
          </div>

          {orphanedEntries.length > 0 && (
            <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/8 px-4 py-3">
              <p className="text-sm font-medium text-[var(--text-primary)]">{t("health.orphaned.title")}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                {t("health.orphaned.description", { count: orphanedEntries.length })}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="grid grid-cols-[minmax(0,1.8fr)_100px_100px_120px_140px_minmax(0,1.1fr)_minmax(0,1.1fr)_110px] gap-3 border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
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
                  onRun={() => runCheck(host)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ElementType;
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
  onRun,
}: {
  host: HostEntry;
  record?: HostHealthRecord;
  onRun: () => void;
}) {
  const { t } = useTranslation();
  const sshHost = isSshHost(host);
  const result = record?.result;
  const status = sshHost ? result?.fingerprint_status ?? "unknown" : "unsupported";

  const handleCopy = async (value?: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1.8fr)_100px_100px_120px_140px_minmax(0,1.1fr)_minmax(0,1.1fr)_110px] gap-3 border-b border-[var(--border)] px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">{host.label}</p>
        <p className="text-xs text-[var(--text-muted)] truncate">
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
        {result?.host_key ?? formatHostKey(host.host, host.port)}
      </div>

      <FingerprintCell
        value={result?.fingerprint}
        onCopy={handleCopy}
        emptyLabel={!sshHost ? t("health.fingerprint.unsupported") : result?.reachable ? t("health.fingerprint.notRead") : "—"}
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
