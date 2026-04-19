import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, FolderOpen, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { logFrontendError } from "@/lib/logger";

interface LogSettingsInfo {
  currentDirectory: string;
  defaultDirectory: string;
  usingCustomDirectory: boolean;
  logFilePath: string;
  rotatedLogFilePath: string;
  viewerLogFilePath: string;
}

interface LogFileSummary {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt?: string | null;
}

interface LogFileContent {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt?: string | null;
  content: string;
  truncated: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value?: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function LogsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<LogSettingsInfo | null>(null);
  const [files, setFiles] = useState<LogFileSummary[]>([]);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<LogFileContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFileContent = useCallback(async (fileName: string) => {
    setReading(true);
    try {
      const content = await invoke<LogFileContent>("app_read_log_file", { fileName });
      setSelectedContent(content);
      setSelectedFileName(fileName);
    } catch (err) {
      const message = String(err);
      setError(message);
      logFrontendError("logs.readFile", "Falha ao ler arquivo de log", err, { fileName });
    } finally {
      setReading(false);
    }
  }, []);

  const loadLogs = useCallback(async (preferredFileName?: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const [nextSettings, nextFiles] = await Promise.all([
        invoke<LogSettingsInfo>("app_get_log_settings"),
        invoke<LogFileSummary[]>("app_list_log_files"),
      ]);

      setSettings(nextSettings);
      setFiles(nextFiles);

      if (nextFiles.length === 0) {
        setSelectedFileName(null);
        setSelectedContent(null);
        return;
      }

      const candidate =
        nextFiles.find((file) => file.name === preferredFileName)?.name ??
        nextFiles[0].name;

      await loadFileContent(candidate);
    } catch (err) {
      const message = String(err);
      setError(message);
      logFrontendError("logs.load", "Falha ao carregar dados da tela de logs", err);
    } finally {
      setLoading(false);
    }
  }, [loadFileContent]);

  useEffect(() => {
    void loadLogs(null);
  }, [loadLogs]);

  const handleChooseDirectory = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });

    const directory = Array.isArray(selected) ? selected[0] : selected;
    if (!directory) return;

    try {
      const updated = await invoke<LogSettingsInfo>("app_set_log_directory", {
        directory,
      });
      setSettings(updated);
      await loadLogs();
    } catch (err) {
      const message = String(err);
      setError(message);
      logFrontendError("logs.setDirectory", "Falha ao atualizar diretório de logs", err, {
        directory,
      });
    }
  }, [loadLogs, t]);

  const handleResetDirectory = useCallback(async () => {
    try {
      const updated = await invoke<LogSettingsInfo>("app_set_log_directory", {
        directory: null,
      });
      setSettings(updated);
      await loadLogs();
    } catch (err) {
      const message = String(err);
      setError(message);
      logFrontendError("logs.resetDirectory", "Falha ao restaurar diretório padrão de logs", err);
    }
  }, [loadLogs]);

  return (
    <div className="flex min-h-full flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("logs.title")}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {t("logs.description")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleChooseDirectory}>
            <FolderOpen size={14} />
            {t("logs.chooseDirectory")}
          </Button>
          <Button variant="secondary" size="sm" onClick={handleResetDirectory} disabled={!settings?.usingCustomDirectory}>
            <RotateCcw size={14} />
            {t("logs.resetDirectory")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void loadLogs(selectedFileName)}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {t("logs.refresh")}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <InfoCard label={t("logs.currentDirectory")} value={settings?.currentDirectory ?? "—"} />
        <InfoCard label={t("logs.defaultDirectory")} value={settings?.defaultDirectory ?? "—"} />
        <InfoCard
          label={t("logs.directoryMode")}
          value={settings?.usingCustomDirectory ? t("logs.directoryModeCustom") : t("logs.directoryModeDefault")}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="flex h-56 min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] xl:h-64">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <p className="text-sm font-medium text-[var(--text-primary)]">{t("logs.files")}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="px-3 py-4 text-sm text-[var(--text-muted)]">{t("common.loading")}</div>
            ) : files.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--text-muted)]">{t("logs.noFiles")}</div>
            ) : (
              <div className="flex flex-col gap-1">
                {files.map((file) => {
                  const selected = file.name === selectedFileName;
                  return (
                    <button
                      key={file.name}
                      onClick={() => void loadFileContent(file.name)}
                      className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                          : "border-[var(--border)] bg-[var(--bg-primary)] hover:bg-[var(--bg-hover)]"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <FileText size={14} className={selected ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                        <span className="text-sm font-medium text-[var(--text-primary)]">{file.name}</span>
                      </div>
                      <p className="mt-2 break-all text-xs text-[var(--text-muted)]">{file.path}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span>{formatBytes(file.sizeBytes)}</span>
                        <span>{formatDate(file.modifiedAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="flex h-[32rem] min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] xl:h-[36rem]">
          <div className="border-b border-[var(--border)] px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-[var(--text-primary)]">
                  {selectedContent?.name ?? t("logs.viewerTitle")}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)] break-all">
                  {selectedContent?.path ?? settings?.logFilePath ?? "—"}
                </p>
              </div>
              {selectedContent && (
                <div className="text-right text-xs text-[var(--text-muted)]">
                  <div>{formatBytes(selectedContent.sizeBytes)}</div>
                  <div>{formatDate(selectedContent.modifiedAt)}</div>
                </div>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden p-4">
            {reading ? (
              <p className="text-sm text-[var(--text-muted)]">{t("logs.loadingFile")}</p>
            ) : !selectedContent ? (
              <p className="text-sm text-[var(--text-muted)]">{t("logs.noFileSelected")}</p>
            ) : (
              <div className="flex h-full flex-col gap-3">
                {selectedContent.truncated && (
                  <div className="rounded-lg border border-[var(--warning)] bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]">
                    {t("logs.truncated")}
                  </div>
                )}
                <pre className="min-h-0 flex-1 overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 text-xs leading-5 text-[var(--text-primary)] whitespace-pre-wrap break-words">
                  {selectedContent.content || t("logs.emptyFile")}
                </pre>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-2 break-all text-sm text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
