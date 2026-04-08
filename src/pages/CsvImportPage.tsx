import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Upload,
} from "lucide-react";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  buildCsvHostImportPlan,
  buildCsvHostTemplate,
  CsvHostImportFatalError,
  CsvHostImportMode,
  CsvHostImportPreview,
  CsvHostImportPreviewRow,
  parseCsvHostImport,
} from "@/lib/csvHostImport";
import { cn } from "@/lib/utils";

interface ToastState {
  type: "success" | "error" | "info";
  message: string;
}

type Toast = ToastState | null;

interface ImportResultState {
  sourceName: string;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  invalidCount: number;
}

export function CsvImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const hosts = useHostsStore((state) => state.hosts);
  const replaceHosts = useHostsStore((state) => state.replaceHosts);
  const savedGroups = useSettingsStore((state) => state.settings.groups);
  const updateGroups = useSettingsStore((state) => state.updateGroups);

  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState<"template" | "example" | "import" | "apply" | null>(null);
  const [importMode, setImportMode] = useState<CsvHostImportMode>("add");
  const [preview, setPreview] = useState<CsvHostImportPreview | null>(null);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResultState | null>(null);

  const plan = useMemo(
    () => (preview ? buildCsvHostImportPlan(preview, hosts, importMode) : null),
    [preview, hosts, importMode]
  );

  const showToast = (type: ToastState["type"], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4000);
  };

  const handleDownload = async (kind: "template" | "example") => {
    setLoading(kind);
    try {
      const filePath = await save({
        title: t(kind === "template" ? "csvImport.actions.saveTemplate" : "csvImport.actions.saveExample"),
        defaultPath:
          kind === "template" ? "ssh-vault-hosts-template.csv" : "ssh-vault-hosts-example.csv",
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!filePath) return;

      await writeTextFile(filePath, buildCsvHostTemplate(kind === "example"));
      showToast("success", t("csvImport.messages.templateSaved"));
    } catch (error) {
      showToast("error", String(error));
    } finally {
      setLoading(null);
    }
  };

  const handleOpenCsv = async () => {
    setLoading("import");
    try {
      const filePath = await open({
        title: t("csvImport.actions.importCsv"),
        multiple: false,
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });

      if (!filePath || Array.isArray(filePath)) return;

      const raw = await readTextFile(filePath);
      const nextPreview = parseCsvHostImport(raw, hosts);
      setPreview(nextPreview);
      setSourceName(getFileName(filePath));
      setImportResult(null);

      if (nextPreview.counts.totalRows === 0) {
        showToast("info", t("csvImport.messages.emptyFile"));
      }
    } catch (error) {
      if (error instanceof CsvHostImportFatalError) {
        showToast("error", getFatalErrorMessage(error, t));
      } else {
        showToast("error", String(error));
      }
    } finally {
      setLoading(null);
    }
  };

  const handleApplyImport = () => {
    if (!preview || !plan) return;

    setLoading("apply");
    try {
      replaceHosts(plan.nextHosts);

      const mergedGroups = Array.from(
        new Set([
          ...savedGroups,
          ...plan.nextHosts
            .map((host) => host.group)
            .filter((group): group is string => !!group),
        ])
      ).sort((left, right) => left.localeCompare(right));

      updateGroups(mergedGroups);

      setImportResult({
        sourceName: sourceName ?? t("csvImport.preview.unknownSource"),
        createdCount: plan.createdCount,
        updatedCount: plan.updatedCount,
        skippedCount: plan.skippedCount,
        invalidCount: plan.invalidCount,
      });
      setPreview(null);
      setSourceName(null);
      showToast("success", t("csvImport.messages.importApplied"));
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </Button>
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("csvImport.title")}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">
            {t("csvImport.description")}
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={cn(
            "mx-6 mt-4 flex items-center gap-2.5 rounded-lg border px-4 py-3 text-sm",
            toast.type === "success" &&
              "border-[var(--success)]/30 bg-[var(--success)]/15 text-[var(--success)]",
            toast.type === "error" &&
              "border-[var(--danger)]/30 bg-[var(--danger)]/15 text-[var(--danger)]",
            toast.type === "info" &&
              "border-[var(--accent)]/30 bg-[var(--accent-subtle)] text-[var(--accent)]"
          )}
        >
          {toast.type === "success" ? (
            <CheckCircle2 size={16} />
          ) : toast.type === "error" ? (
            <AlertTriangle size={16} />
          ) : (
            <Info size={16} />
          )}
          {toast.message}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-6">
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <FileSpreadsheet size={16} className="text-[var(--accent)]" />
                {t("csvImport.instructions.title")}
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {t("csvImport.instructions.description")}
              </p>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <InstructionCard
                  title={t("csvImport.instructions.requiredTitle")}
                  items={[
                    t("csvImport.instructions.required.label"),
                    t("csvImport.instructions.required.protocol"),
                    t("csvImport.instructions.required.host"),
                  ]}
                />
                <InstructionCard
                  title={t("csvImport.instructions.allowedTitle")}
                  items={[
                    t("csvImport.instructions.allowed.protocols"),
                    t("csvImport.instructions.allowed.authMethods"),
                    t("csvImport.instructions.allowed.tags"),
                  ]}
                />
                <InstructionCard
                  title={t("csvImport.instructions.defaultsTitle")}
                  items={[
                    t("csvImport.instructions.defaults.ssh"),
                    t("csvImport.instructions.defaults.telnet"),
                    t("csvImport.instructions.defaults.rdp"),
                  ]}
                />
                <InstructionCard
                  title={t("csvImport.instructions.matchingTitle")}
                  items={[
                    t("csvImport.instructions.matching.id"),
                    t("csvImport.instructions.matching.identity"),
                    t("csvImport.instructions.matching.blanks"),
                  ]}
                />
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
                <Download size={16} className="text-[var(--accent)]" />
                {t("csvImport.actions.title")}
              </div>
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {t("csvImport.actions.description")}
              </p>

              <div className="mt-4 flex flex-col gap-3">
                <Button
                  variant="secondary"
                  onClick={() => handleDownload("template")}
                  disabled={loading !== null}
                >
                  <Download size={14} />
                  {t("csvImport.actions.saveTemplate")}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => handleDownload("example")}
                  disabled={loading !== null}
                >
                  <Download size={14} />
                  {t("csvImport.actions.saveExample")}
                </Button>
                <Button onClick={handleOpenCsv} disabled={loading === "apply"}>
                  <Upload size={14} />
                  {loading === "import"
                    ? t("csvImport.actions.importing")
                    : t("csvImport.actions.importCsv")}
                </Button>
              </div>

              <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-xs text-[var(--text-muted)]">
                {sourceName
                  ? t("csvImport.actions.currentFile", { name: sourceName })
                  : t("csvImport.actions.noFileSelected")}
              </div>
            </div>
          </section>

          {importResult && (
            <section className="rounded-2xl border border-[var(--success)]/30 bg-[var(--success)]/10 p-5">
              <div className="flex items-center gap-2 text-sm font-medium text-[var(--success)]">
                <CheckCircle2 size={16} />
                {t("csvImport.result.title")}
              </div>
              <p className="mt-2 text-sm text-[var(--text-primary)]">
                {t("csvImport.result.description", { name: importResult.sourceName })}
              </p>
              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <SummaryCard
                  label={t("csvImport.result.created")}
                  value={importResult.createdCount}
                  tone="success"
                />
                <SummaryCard
                  label={t("csvImport.result.updated")}
                  value={importResult.updatedCount}
                  tone="accent"
                />
                <SummaryCard
                  label={t("csvImport.result.skipped")}
                  value={importResult.skippedCount}
                  tone="warning"
                />
                <SummaryCard
                  label={t("csvImport.result.invalid")}
                  value={importResult.invalidCount}
                  tone="danger"
                />
              </div>
            </section>
          )}

          {preview && (
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-5">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-[var(--text-primary)]">
                      {t("csvImport.preview.title")}
                    </h2>
                    {sourceName && <Badge variant="accent">{sourceName}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">
                    {t("csvImport.preview.description")}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ModeButton
                    active={importMode === "add"}
                    onClick={() => setImportMode("add")}
                    title={t("csvImport.preview.modes.add")}
                    description={t("csvImport.preview.modes.addDescription")}
                  />
                  <ModeButton
                    active={importMode === "merge"}
                    onClick={() => setImportMode("merge")}
                    title={t("csvImport.preview.modes.merge")}
                    description={t("csvImport.preview.modes.mergeDescription")}
                  />
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <SummaryCard
                  label={t("csvImport.preview.totalRows")}
                  value={preview.counts.totalRows}
                />
                <SummaryCard
                  label={t("csvImport.preview.validRows")}
                  value={preview.counts.validRows}
                  tone="success"
                />
                <SummaryCard
                  label={t("csvImport.preview.invalidRows")}
                  value={preview.counts.invalidRows}
                  tone="danger"
                />
                <SummaryCard
                  label={t("csvImport.preview.newRows")}
                  value={preview.counts.newRows}
                  tone="accent"
                />
                <SummaryCard
                  label={t("csvImport.preview.matchedRows")}
                  value={preview.counts.matchedRows}
                  tone="warning"
                />
              </div>

              {plan && (
                <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {t("csvImport.preview.applyTitle")}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-secondary)]">
                    {t("csvImport.preview.applyDescription", {
                      created: plan.createdCount,
                      updated: plan.updatedCount,
                      skipped: plan.skippedCount,
                    })}
                  </p>
                </div>
              )}

              <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="max-h-[28rem] overflow-auto">
                  <table className="min-w-full divide-y divide-[var(--border)] text-sm">
                    <thead className="sticky top-0 bg-[var(--bg-secondary)]">
                      <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)]">
                        <th className="px-4 py-3">{t("csvImport.table.line")}</th>
                        <th className="px-4 py-3">{t("csvImport.table.host")}</th>
                        <th className="px-4 py-3">{t("csvImport.table.protocol")}</th>
                        <th className="px-4 py-3">{t("csvImport.table.status")}</th>
                        <th className="px-4 py-3">{t("csvImport.table.details")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] bg-[var(--bg-primary)]">
                      {preview.rows.map((row) => (
                        <PreviewRow key={`${row.lineNumber}-${row.raw.label}-${row.raw.host}`} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button variant="ghost" onClick={() => setPreview(null)}>
                  {t("csvImport.preview.clearPreview")}
                </Button>
                <Button
                  onClick={handleApplyImport}
                  disabled={!plan || (plan.createdCount === 0 && plan.updatedCount === 0) || loading !== null}
                >
                  <Upload size={14} />
                  {loading === "apply"
                    ? t("csvImport.preview.applying")
                    : t("csvImport.preview.applyImport")}
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function InstructionCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm text-[var(--text-secondary)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "success" | "warning" | "danger" | "accent";
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
      <p className="text-xs text-[var(--text-muted)]">{label}</p>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold",
          tone === "default" && "text-[var(--text-primary)]",
          tone === "success" && "text-[var(--success)]",
          tone === "warning" && "text-[var(--warning)]",
          tone === "danger" && "text-[var(--danger)]",
          tone === "accent" && "text-[var(--accent)]"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function ModeButton({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border px-4 py-3 text-left transition-colors",
        active
          ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
          : "border-[var(--border)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-hover)]"
      )}
    >
      <p className={cn("text-sm font-medium", active ? "text-[var(--accent)]" : "text-[var(--text-primary)]")}>
        {title}
      </p>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
    </button>
  );
}

function PreviewRow({ row }: { row: CsvHostImportPreviewRow }) {
  const { t } = useTranslation();

  return (
    <tr className="align-top">
      <td className="px-4 py-3 text-[var(--text-muted)]">{row.lineNumber}</td>
      <td className="px-4 py-3">
        <p className="font-medium text-[var(--text-primary)]">{row.raw.label || "—"}</p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {row.raw.host || "—"}{row.raw.port ? `:${row.raw.port}` : ""}
        </p>
      </td>
      <td className="px-4 py-3 text-[var(--text-secondary)]">{row.raw.protocol || "—"}</td>
      <td className="px-4 py-3">
        <Badge variant={row.status === "invalid" ? "danger" : row.status === "matched" ? "warning" : "success"}>
          {row.status === "invalid"
            ? t("csvImport.table.statuses.invalid")
            : row.status === "matched"
            ? t("csvImport.table.statuses.matched")
            : t("csvImport.table.statuses.new")}
        </Badge>
      </td>
      <td className="px-4 py-3">
        {row.errors.length > 0 ? (
          <div className="flex flex-col gap-1 text-xs text-[var(--danger)]">
            {row.errors.map((error, index) => (
              <p key={`${row.lineNumber}-${error.code}-${index}`}>{formatRowError(error.code, error.value, t)}</p>
            ))}
          </div>
        ) : row.status === "matched" ? (
          <p className="text-xs text-[var(--text-muted)]">{t("csvImport.table.matchHint")}</p>
        ) : (
          <p className="text-xs text-[var(--text-muted)]">{t("csvImport.table.readyHint")}</p>
        )}
      </td>
    </tr>
  );
}

function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() || filePath;
}

function getFatalErrorMessage(
  error: CsvHostImportFatalError,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (error.code === "missingRequiredHeaders") {
    return t("csvImport.errors.missingRequiredHeaders", {
      headers: error.details.join(", "),
    });
  }

  return t("csvImport.errors.missingHeaderRow");
}

function formatRowError(
  code: CsvHostImportPreviewRow["errors"][number]["code"],
  value: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  if (code === "invalidProtocol") {
    return t("csvImport.errors.invalidProtocol", { value: value || "—" });
  }
  if (code === "invalidPort") {
    return t("csvImport.errors.invalidPort", { value: value || "—" });
  }
  if (code === "invalidAuthMethod") {
    return t("csvImport.errors.invalidAuthMethod", { value: value || "—" });
  }
  if (code === "invalidKeepAliveInterval") {
    return t("csvImport.errors.invalidKeepAliveInterval", { value: value || "—" });
  }
  if (code === "invalidConnectionTimeout") {
    return t("csvImport.errors.invalidConnectionTimeout", { value: value || "—" });
  }
  if (code === "invalidSshCompatPreset") {
    return t("csvImport.errors.invalidSshCompatPreset", { value: value || "—" });
  }
  if (code === "duplicateIdInFile") {
    return t("csvImport.errors.duplicateIdInFile", { value: value || "—" });
  }
  if (code === "duplicateIdentityInFile") {
    return t("csvImport.errors.duplicateIdentityInFile", { value: value || "—" });
  }
  if (code === "missingLabel") {
    return t("csvImport.errors.missingLabel");
  }
  return t("csvImport.errors.missingHost");
}
