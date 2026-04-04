import { useEffect, useState } from "react";
import { FileCode2, Import, Loader2, Server, KeyRound, KeySquare, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { loadSshConfigPreview, SshConfigImportPreview } from "@/lib/sshConfigImport";

interface SshConfigImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (result: SshConfigImportPreview) => void;
}

export function SshConfigImportModal({
  open,
  onClose,
  onImported,
}: SshConfigImportModalProps) {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const replaceHosts = useHostsStore((s) => s.replaceHosts);
  const credentials = useCredentialsStore((s) => s.credentials);
  const replaceCredentials = useCredentialsStore((s) => s.replaceCredentials);
  const sshKeys = useSshKeysStore((s) => s.sshKeys);
  const replaceSshKeys = useSshKeysStore((s) => s.replaceSshKeys);

  const [preview, setPreview] = useState<SshConfigImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    loadSshConfigPreview(hosts, credentials, sshKeys)
      .then((result) => setPreview(result))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [open, hosts, credentials, sshKeys]);

  const handleImport = () => {
    if (!preview) return;

    replaceHosts([...hosts, ...preview.hosts]);
    replaceCredentials([...credentials, ...preview.credentials]);
    replaceSshKeys([...sshKeys, ...preview.sshKeys]);
    onImported?.(preview);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title={t("sshConfigImport.title")} size="md">
      <div className="flex flex-col gap-4">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
            <Loader2 size={14} className="animate-spin" />
            {t("sshConfigImport.loading")}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-3 text-sm text-[var(--danger)]">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {preview && (
          <>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-4">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <FileCode2 size={15} className="text-[var(--accent)]" />
                {preview.sourcePath ?? "~/.ssh/config"}
              </div>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                {t("sshConfigImport.description")}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SummaryCard icon={Server} label={t("sshConfigImport.summary.hostsNew")} value={preview.hosts.length} />
              <SummaryCard icon={KeyRound} label={t("sshConfigImport.summary.credentialsNew")} value={preview.credentials.length} />
              <SummaryCard icon={KeySquare} label={t("sshConfigImport.summary.keysNew")} value={preview.sshKeys.length} />
            </div>

            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-4">
              <p className="text-sm font-medium text-[var(--text-primary)]">{t("sshConfigImport.summary.title")}</p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-[var(--text-secondary)]">
                <li>{t("sshConfigImport.summary.importedAliases", { count: preview.importedCount })}</li>
                <li>{t("sshConfigImport.summary.skippedDuplicates", { count: preview.skippedCount })}</li>
                <li>{t("sshConfigImport.summary.supportedCompat")}</li>
              </ul>
            </div>

            <div className="max-h-56 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t("sshConfigImport.detectedHosts")}
              </p>
              <div className="flex flex-col gap-2">
                {preview.hosts.map((host) => (
                  <div
                    key={host.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-[var(--text-primary)]">{host.label}</p>
                      <p className="truncate text-xs text-[var(--text-muted)]">
                        {host.username ? `${host.username}@` : ""}{host.host}:{host.port}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--text-muted)]">
                      {host.jumpHostId
                        ? t("sshConfigImport.withJumpHost")
                        : t(`sshConfigImport.authMethods.${host.authMethod}`)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleImport}
                disabled={preview.importedCount === 0}
              >
                <Import size={14} />
                {t("sshConfigImport.importToVault")}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
      <div className="flex items-center gap-2 text-[var(--text-muted)]">
        <Icon size={14} />
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
