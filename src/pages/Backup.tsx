import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Download, Upload, FileArchive, CheckCircle2,
  AlertTriangle, Loader2, Eye, EyeOff, KeyRound,
  Server, ShieldCheck, ShieldOff, Info,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { useSettingsStore } from "@/store/settings";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import {
  exportBackup, importBackup, hydrateBackupData,
  BackupFile,
} from "@/lib/backup";
import { formatDate } from "@/lib/utils";
import { TransferSecretsPayload } from "@/lib/portableState";

interface ToastState { type: "success" | "error" | "info"; message: string }
type Toast = ToastState | null;

export function Backup() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const replaceHosts = useHostsStore((s) => s.replaceHosts);
  const credentials = useCredentialsStore((s) => s.credentials);
  const replaceCredentials = useCredentialsStore((s) => s.replaceCredentials);
  const sshKeys = useSshKeysStore((s) => s.sshKeys);
  const replaceSshKeys = useSshKeysStore((s) => s.replaceSshKeys);
  const { settings, replaceSettings } = useSettingsStore();
  const sshHostCount = hosts.filter((host) => host.protocol === "ssh").length;
  const telnetHostCount = hosts.filter((host) => host.protocol === "telnet").length;
  const rdpHostCount = hosts.filter((host) => host.protocol === "rdp").length;

  // ── Estado geral ────────────────────────────────────────────────────────────
  const [toast, setToast] = useState<Toast>(null);
  const [loading, setLoading] = useState<"export" | "import" | null>(null);

  const showToast = (type: ToastState["type"], message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 4000);
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  const [exportWithCreds, setExportWithCreds] = useState(false);
  const [exportPasswordModal, setExportPasswordModal] = useState(false);

  const hasMasterPassword = settings.security?.masterPasswordSet ?? false;

  const handleExport = async (masterPassword: string | null) => {
    setLoading("export");
    try {
      await exportBackup(hosts, credentials, sshKeys, settings, masterPassword);
      showToast("success", t("backup.export.success"));
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("cancel") && !msg.includes("Cancel")) {
        showToast("error", msg);
      }
    } finally {
      setLoading(null);
    }
  };

  const startExport = () => {
    if (exportWithCreds && hasMasterPassword) {
      setExportPasswordModal(true);
    } else {
      handleExport(null);
    }
  };

  // ── Import ──────────────────────────────────────────────────────────────────
  const [importPreview, setImportPreview] = useState<{
    backup: BackupFile;
    secrets: TransferSecretsPayload | null;
    hasEncryptedCredentials: boolean;
  } | null>(null);
  const [importMode, setImportMode] = useState<"add" | "replace">("add");
  const [importSettings, setImportSettings] = useState(true);
  const [importPasswordModal, setImportPasswordModal] = useState(false);
  const [pendingImport, setPendingImport] = useState<BackupFile | null>(null);

  const handleSelectFile = async () => {
    setLoading("import");
    try {
      const result = await importBackup(null);
      if (!result) return;

      if (result.hasEncryptedCredentials) {
        // Guarda e pede senha mestra
        setPendingImport(result.backup);
        setImportPreview(result);
        setImportPasswordModal(true);
      } else {
        setImportPreview(result);
      }
    } catch (e) {
      const msg = String(e);
      if (!msg.includes("cancel") && !msg.includes("Cancel")) {
        showToast("error", `${t("backup.import.invalidFile")}: ${msg}`);
      }
    } finally {
      setLoading(null);
    }
  };

  const handleDecryptImport = async (masterPassword: string) => {
    if (!pendingImport) return;
    try {
      const credJson = await invoke<string>("decrypt_credentials", {
        encryptedPayloadJson: JSON.stringify(pendingImport.encryptedCredentials),
        masterPassword,
      });
      const secrets = JSON.parse(credJson) as TransferSecretsPayload;
      setImportPreview({ backup: pendingImport, secrets, hasEncryptedCredentials: true });
      setImportPasswordModal(false);
    } catch {
      showToast("error", t("backup.import.wrongPassword"));
      // mantém preview mas sem credenciais
      setImportPasswordModal(false);
    }
  };

  const handleConfirmImport = () => {
    if (!importPreview) return;
    const { backup, secrets } = importPreview;
    const hydrated = hydrateBackupData(backup, secrets);

    const finalHosts =
      importMode === "replace"
        ? hydrated.hosts
        : [
            ...hosts,
            ...hydrated.hosts.filter((host) => !hosts.some((existing) => existing.id === host.id)),
          ];

    const finalCredentials =
      importMode === "replace"
        ? hydrated.credentials
        : [
            ...credentials,
            ...hydrated.credentials.filter(
              (credential) => !credentials.some((existing) => existing.id === credential.id)
            ),
          ];

    const finalSshKeys =
      importMode === "replace"
        ? hydrated.sshKeys
        : [
            ...sshKeys,
            ...hydrated.sshKeys.filter((sshKey) => !sshKeys.some((existing) => existing.id === sshKey.id)),
          ];

    replaceHosts(finalHosts);
    replaceCredentials(finalCredentials);
    replaceSshKeys(finalSshKeys);

    // Aplicar settings se solicitado
    if (importSettings && hydrated.settings) {
      replaceSettings(hydrated.settings);
    }

    const msg = secrets
      ? t("backup.import.successWithCreds")
      : secrets === null && importPreview.hasEncryptedCredentials
      ? `${t("backup.import.success")} (${t("backup.import.credentialsSkipped")})`
      : t("backup.import.success");

    showToast("success", msg);
    setImportPreview(null);
    setPendingImport(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">
            {t("backup.title")}
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">
            {t("backup.description")}
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mx-6 mt-4 flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm ${
            toast.type === "success"
              ? "bg-[var(--success)]/15 border border-[var(--success)]/30 text-[var(--success)]"
              : toast.type === "error"
              ? "bg-[var(--danger)]/15 border border-[var(--danger)]/30 text-[var(--danger)]"
              : "bg-[var(--accent-subtle)] border border-[var(--accent)]/30 text-[var(--accent)]"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 size={16} /> : toast.type === "error" ? <AlertTriangle size={16} /> : <Info size={16} />}
          {toast.message}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-6">

          {/* ── Export card ─────────────────────────────────────────────────── */}
          <Card
            icon={<Download size={20} className="text-[var(--accent)]" />}
            title={t("backup.export.title")}
            description={t("backup.export.description")}
          >
            {/* Resumo atual */}
            <div className="flex items-center gap-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2.5">
              <Server size={14} className="text-[var(--text-muted)]" />
              <span className="text-sm text-[var(--text-secondary)]">
                {t("backup.export.hostsCount", { count: hosts.length })}
              </span>
            </div>
            <div className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border)] px-3 py-2.5 text-sm text-[var(--text-secondary)]">
              <p>{t("backup.export.protocolBreakdown", { ssh: sshHostCount, telnet: telnetHostCount, rdp: rdpHostCount })}</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">{t("backup.export.protocolsPreserved")}</p>
            </div>

            {/* Opção de credenciais */}
            <div className="flex flex-col gap-2">
              <label className={`flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors cursor-pointer ${
                hasMasterPassword
                  ? "border-[var(--border)] hover:bg-[var(--bg-hover)]"
                  : "border-[var(--border)] opacity-50 cursor-not-allowed"
              }`}>
                <input
                  type="checkbox"
                  disabled={!hasMasterPassword}
                  checked={exportWithCreds && hasMasterPassword}
                  onChange={(e) => setExportWithCreds(e.target.checked)}
                  className="accent-[var(--accent)] w-4 h-4 mt-0.5 shrink-0"
                />
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)] flex items-center gap-1.5">
                    {hasMasterPassword
                      ? <ShieldCheck size={14} className="text-[var(--success)]" />
                      : <ShieldOff size={14} className="text-[var(--text-muted)]" />}
                    {t("backup.export.withCredentials")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {hasMasterPassword
                      ? t("backup.export.withCredentialsHint")
                      : t("backup.export.noMasterPassword")}
                  </p>
                </div>
              </label>
            </div>

            <Button onClick={startExport} disabled={loading === "export"} className="self-start">
              {loading === "export" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("backup.export.button")}
            </Button>
          </Card>

          {/* ── Import card ─────────────────────────────────────────────────── */}
          <Card
            icon={<Upload size={20} className="text-[var(--accent)]" />}
            title={t("backup.import.title")}
            description={t("backup.import.description")}
          >
            {!importPreview ? (
              <Button
                variant="secondary"
                onClick={handleSelectFile}
                disabled={loading === "import"}
                className="self-start"
              >
                {loading === "import"
                  ? <Loader2 size={14} className="animate-spin" />
                  : <FileArchive size={14} />}
                {t("backup.import.button")}
              </Button>
            ) : (
              <ImportPreviewPanel
                preview={importPreview}
                importMode={importMode}
                importSettings={importSettings}
                onModeChange={setImportMode}
                onSettingsChange={setImportSettings}
                onConfirm={handleConfirmImport}
                onCancel={() => { setImportPreview(null); setPendingImport(null); }}
              />
            )}
          </Card>

        </div>
      </div>

      {/* Modal senha export */}
      <PasswordModal
        open={exportPasswordModal}
        title={t("backup.masterPasswordPrompt")}
        verificationPayload={settings.security?.verificationPayload}
        description="Informe a senha mestra para cifrar as credenciais no backup."
        onConfirm={(pw) => { setExportPasswordModal(false); handleExport(pw); }}
        onCancel={() => setExportPasswordModal(false)}
      />

      {/* Modal senha import */}
      <PasswordModal
        open={importPasswordModal}
        title={t("backup.masterPasswordPrompt")}
        description={t("backup.import.enterPassword")}
        onConfirm={handleDecryptImport}
        onCancel={() => {
          setImportPasswordModal(false);
          // Mantém preview sem credenciais
        }}
        cancelLabel="Continuar sem credenciais"
      />
    </div>
  );
}

// ─── ImportPreviewPanel ───────────────────────────────────────────────────────

function ImportPreviewPanel({
  preview, importMode, importSettings,
  onModeChange, onSettingsChange, onConfirm, onCancel,
}: {
  preview: { backup: BackupFile; secrets: TransferSecretsPayload | null; hasEncryptedCredentials: boolean };
  importMode: "add" | "replace";
  importSettings: boolean;
  onModeChange: (m: "add" | "replace") => void;
  onSettingsChange: (v: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const { backup, secrets, hasEncryptedCredentials } = preview;
  const [confirmReplace, setConfirmReplace] = useState(false);
  const sshHostCount = backup.hosts.filter((host) => host.protocol === "ssh").length;
  const telnetHostCount = backup.hosts.filter((host) => host.protocol === "telnet").length;
  const rdpHostCount = backup.hosts.filter((host) => host.protocol === "rdp").length;

  const handleConfirm = () => {
    if (importMode === "replace" && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    onConfirm();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Info do arquivo */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4 flex flex-col gap-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
          {t("backup.import.preview")}
        </p>
        <div className="flex flex-col gap-1.5">
          <InfoRow icon={<FileArchive size={13} />} label={t("backup.import.exportedAt", { date: formatDate(backup.exportedAt) })} />
          <InfoRow icon={<Server size={13} />} label={t("backup.import.hostsFound", { count: backup.hosts.length })} />
          <InfoRow icon={<Server size={13} />} label={t("backup.import.protocolBreakdown", { ssh: sshHostCount, telnet: telnetHostCount, rdp: rdpHostCount })} />
          <InfoRow
            icon={hasEncryptedCredentials
              ? <ShieldCheck size={13} className="text-[var(--success)]" />
              : <ShieldOff size={13} className="text-[var(--text-muted)]" />}
            label={hasEncryptedCredentials
              ? secrets
                ? `${t("backup.import.hasCredentials")} ✓ decifradas`
                : `${t("backup.import.hasCredentials")} — não decifradas`
              : t("backup.import.noCredentials")}
            accent={hasEncryptedCredentials && !!secrets}
          />
        </div>
      </div>

      {/* Modo de importação */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-[var(--text-primary)]">{t("backup.import.mergeTitle")}</p>
        {(["add", "replace"] as const).map((mode) => (
          <label key={mode} className={`flex items-start gap-3 rounded-lg border-2 px-4 py-3 cursor-pointer transition-all ${
            importMode === mode ? "border-[var(--accent)] bg-[var(--accent-subtle)]" : "border-[var(--border)] hover:bg-[var(--bg-hover)]"
          }`}>
            <input
              type="radio"
              name="importMode"
              value={mode}
              checked={importMode === mode}
              onChange={() => { onModeChange(mode); setConfirmReplace(false); }}
              className="accent-[var(--accent)] mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t(`backup.import.merge${mode === "add" ? "Add" : "Replace"}`)}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t(`backup.import.merge${mode === "add" ? "Add" : "Replace"}Desc`)}
              </p>
            </div>
          </label>
        ))}
      </div>

      {/* Restaurar settings */}
      {backup.settings && (
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={importSettings}
            onChange={(e) => onSettingsChange(e.target.checked)}
            className="accent-[var(--accent)] w-4 h-4 mt-0.5 shrink-0"
          />
          <div>
            <p className="text-sm text-[var(--text-primary)]">{t("backup.includeSettings")}</p>
            <p className="text-xs text-[var(--text-muted)]">{t("backup.includeSettingsHint")}</p>
          </div>
        </label>
      )}

      {/* Confirmação de replace */}
      {confirmReplace && (
        <div className="flex items-start gap-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 px-3 py-2.5">
          <AlertTriangle size={14} className="text-[var(--danger)] shrink-0 mt-0.5" />
          <p className="text-sm text-[var(--danger)]">{t("backup.import.confirmReplace")}</p>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button
          size="sm"
          variant={confirmReplace ? "danger" : "primary"}
          onClick={handleConfirm}
        >
          {t("backup.import.confirm")}
        </Button>
      </div>
    </div>
  );
}

// ─── Componentes auxiliares ───────────────────────────────────────────────────

function Card({ icon, title, description, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-muted)]">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function InfoRow({ icon, label, accent }: { icon: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${accent ? "text-[var(--success)]" : "text-[var(--text-secondary)]"}`}>
      <span className="text-[var(--text-muted)]">{icon}</span>
      {label}
    </div>
  );
}

function PasswordModal({ open, title, description, verificationPayload, onConfirm, onCancel, cancelLabel }: {
  open: boolean;
  title: string;
  description: string;
  verificationPayload?: string;
  onConfirm: (pw: string) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const { t } = useTranslation();
  const [pw, setPw] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!pw) return;
    if (verificationPayload) {
      setLoading(true);
      try {
        const ok = await invoke<boolean>("verify_master_password", {
          encryptedPayloadJson: verificationPayload,
          masterPassword: pw,
        });
        if (!ok) { setError(t("settings.security.masterPasswordWrong")); setLoading(false); return; }
      } catch (e) {
        setError(String(e)); setLoading(false); return;
      } finally {
        setLoading(false);
      }
    }
    onConfirm(pw);
    setPw(""); setError("");
  };

  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-secondary)]">{description}</p>
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            placeholder="••••••••"
            value={pw}
            autoFocus
            onChange={(e) => { setPw(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
          />
          <button type="button" onClick={() => setShow((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button size="sm" disabled={loading || !pw} onClick={handleConfirm}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
