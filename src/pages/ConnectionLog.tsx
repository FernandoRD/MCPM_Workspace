import { useTranslation } from "react-i18next";
import { History, Trash2, Monitor, FolderOpen } from "lucide-react";
import { useConnectionLogsStore } from "@/store/connectionLogs";
import { Button } from "@/components/ui/Button";

function formatDuration(secs?: number): string {
  if (secs == null) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export function ConnectionLog() {
  const { t } = useTranslation();
  const logs = useConnectionLogsStore((s) => s.logs);
  const clearLogs = useConnectionLogsStore((s) => s.clearLogs);

  return (
    <div className="flex flex-col h-full p-6 gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <History size={20} className="text-[var(--accent)]" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("connectionLog.title")}
          </h1>
        </div>
        {logs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearLogs} className="gap-1.5 text-xs text-[var(--text-muted)] hover:text-red-400">
            <Trash2 size={13} />
            {t("connectionLog.clear")}
          </Button>
        )}
      </div>

      {/* Table */}
      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-3 text-[var(--text-muted)]">
          <History size={32} className="opacity-40" />
          <p className="text-sm">{t("connectionLog.empty")}</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">{t("connectionLog.host")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">{t("connectionLog.type")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">{t("connectionLog.connectedAt")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">{t("connectionLog.duration")}</th>
                <th className="text-left px-4 py-2.5 font-medium text-[var(--text-muted)]">{t("connectionLog.status")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-hover)] transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-[var(--text-primary)]">{log.hostLabel}</div>
                    <div className="text-xs text-[var(--text-muted)]">{log.hostAddress}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5 text-[var(--text-secondary)]">
                      {log.sessionType === "sftp" ? <FolderOpen size={13} /> : <Monitor size={13} />}
                      {t(`connectionLog.sessionType.${log.sessionType}`)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {new Date(log.connectedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                    {formatDuration(log.durationSecs)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        log.status === "connected"
                          ? "text-green-400"
                          : log.status === "error"
                          ? "text-red-400"
                          : "text-[var(--text-muted)]"
                      }
                    >
                      {t(`connectionLog.statusLabel.${log.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
