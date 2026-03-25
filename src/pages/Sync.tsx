import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudUpload, Check, AlertCircle, Loader2,
  GitBranch, Database, Globe, Plug, ShieldOff,
  Eye, EyeOff, KeyRound,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/store/settings";
import { AppSettings, SyncProvider } from "@/types";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";

export function Sync() {
  const { t } = useTranslation();
  const { settings, updateSync } = useSettingsStore();
  const sync = settings.sync;
  const security = settings.security;
  const [syncing, setSyncing] = useState(false);
  const [gistToken, setGistToken] = useState(sync.gist?.token ?? "");
  const [showToken, setShowToken] = useState(false);
  const [gistId, setGistId] = useState(sync.gist?.gistId ?? "");

  // Modal de senha mestra para operações de sync
  const [masterPasswordModal, setMasterPasswordModal] = useState<{
    open: boolean;
    action: "export" | "import";
    importPayload?: string;
  }>({ open: false, action: "export" });

  const providers: { id: SyncProvider; icon: React.ElementType; title: string; desc: string }[] = [
    { id: "githubGist", icon: GitBranch, title: t("sync.providers.githubGist"), desc: t("sync.providers.githubGistDescription") },
    { id: "s3", icon: Database, title: t("sync.providers.s3"), desc: t("sync.providers.s3Description") },
    { id: "webdav", icon: Globe, title: t("sync.providers.webdav"), desc: t("sync.providers.webdavDescription") },
    { id: "custom", icon: Plug, title: t("sync.providers.custom"), desc: t("sync.providers.customDescription") },
  ];

  const handleSyncNow = async () => {
    if (security?.syncCredentials && security.masterPasswordSet) {
      setMasterPasswordModal({ open: true, action: "export" });
    } else {
      await doSync(null);
    }
  };

  const doSync = async (_masterPassword: string | null) => {
    setSyncing(true);
    try {
      // Placeholder — na Fase 4 integra com o provider real
      await new Promise((r) => setTimeout(r, 1500));
      updateSync({ lastSyncAt: new Date().toISOString() });
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveGist = () => {
    updateSync({
      provider: "githubGist",
      gist: { token: gistToken, gistId: gistId || undefined },
    });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">{t("sync.title")}</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5">{t("sync.description")}</p>
        </div>
        {sync.provider && (
          <Button onClick={handleSyncNow} disabled={syncing}>
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
            {syncing ? t("sync.status.syncing") : t("sync.actions.syncNow")}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-6">
          {/* Status */}
          <StatusCard sync={sync} security={security} syncing={syncing} />

          {/* Aviso se sync de credenciais ativado */}
          {security?.syncCredentials && security.masterPasswordSet && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-subtle)] px-4 py-3">
              <KeyRound size={16} className="text-[var(--accent)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--accent)]">
                Credenciais serão cifradas com AES-256-GCM antes de sincronizar.
              </p>
            </div>
          )}

          {/* Aviso se sync de credenciais desabilitado */}
          {!security?.syncCredentials && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
              <ShieldOff size={16} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--text-muted)]">
                {!security?.masterPasswordSet
                  ? "Defina uma senha mestra em Configurações → Segurança para habilitar o sync de credenciais."
                  : "Sync de credenciais desabilitado. Ative em Configurações → Segurança."}
              </p>
            </div>
          )}

          {/* Provider selection */}
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">
              {t("sync.providers.title")}
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {providers.map(({ id, icon: Icon, title, desc }) => (
                <button
                  key={id}
                  onClick={() => updateSync({ provider: id })}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
                    sync.provider === id
                      ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                      : "border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--text-muted)]"
                  )}
                >
                  <Icon size={18} className={sync.provider === id ? "text-[var(--accent)]" : "text-[var(--text-muted)]"} />
                  <div>
                    <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* GitHub Gist config */}
          {sync.provider === "githubGist" && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 flex flex-col gap-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                {t("sync.providers.githubGist")}
              </h3>
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-[var(--text-primary)]">
                  {t("sync.githubGist.token")}
                </label>
                <div className="relative">
                  <input
                    type={showToken ? "text" : "password"}
                    placeholder={t("sync.githubGist.tokenPlaceholder")}
                    value={gistToken}
                    onChange={(e) => setGistToken(e.target.value)}
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowToken((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  >
                    {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                <p className="text-xs text-[var(--text-muted)]">{t("sync.githubGist.tokenHelp")}</p>
              </div>
              <Input
                id="gistId"
                label={t("sync.githubGist.gistId")}
                placeholder="abc123def456..."
                value={gistId}
                onChange={(e) => setGistId(e.target.value)}
                hint={t("sync.githubGist.gistIdDescription")}
              />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => updateSync({ provider: null })}>
                  {t("sync.actions.disconnect")}
                </Button>
                <Button size="sm" onClick={handleSaveGist} disabled={!gistToken}>
                  {t("common.save")}
                </Button>
              </div>
            </div>
          )}

          {(sync.provider === "s3" || sync.provider === "webdav" || sync.provider === "custom") && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5">
              <p className="text-sm text-[var(--text-muted)] text-center py-4">
                🚧 Configuração para este provedor em breve
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Modal de senha mestra para sync */}
      <MasterPasswordPrompt
        open={masterPasswordModal.open}
        action={masterPasswordModal.action}
        verificationPayload={settings.security?.verificationPayload}
        onConfirm={(password) => {
          setMasterPasswordModal((m) => ({ ...m, open: false }));
          doSync(password);
        }}
        onCancel={() => setMasterPasswordModal((m) => ({ ...m, open: false }))}
      />
    </div>
  );
}

// ─── Modal de senha mestra ────────────────────────────────────────────────────

function MasterPasswordPrompt({
  open, action, verificationPayload, onConfirm, onCancel,
}: {
  open: boolean;
  action: "export" | "import";
  verificationPayload?: string;
  onConfirm: (password: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!password) { setError(t("settings.security.masterPasswordRequired")); return; }
    if (!verificationPayload) { onConfirm(password); return; }
    setLoading(true);
    try {
      const ok = await invoke<boolean>("verify_master_password", {
        encryptedPayloadJson: verificationPayload,
        masterPassword: password,
      });
      if (!ok) { setError(t("settings.security.masterPasswordWrong")); return; }
      onConfirm(password);
      setPassword("");
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={t("settings.security.masterPassword")}
      size="sm"
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-secondary)]">
          {action === "export"
            ? "Informe a senha mestra para cifrar as credenciais antes de sincronizar."
            : "Informe a senha mestra para decifrar as credenciais importadas."}
        </p>
        <div className="relative">
          <input
            type={show ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            autoFocus
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
          />
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t("common.cancel")}</Button>
          <Button size="sm" disabled={loading || !password} onClick={handleConfirm}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {t("common.confirm")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Status card ─────────────────────────────────────────────────────────────

function StatusCard({
  sync, security, syncing,
}: {
  sync: AppSettings["sync"];
  security: AppSettings["security"];
  syncing: boolean;
}) {
  const { t } = useTranslation();

  if (!sync.provider) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <AlertCircle size={18} className="text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-muted)]">{t("sync.status.notConfigured")}</p>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
      {syncing ? (
        <Loader2 size={18} className="text-[var(--accent)] animate-spin" />
      ) : (
        <Check size={18} className="text-[var(--success)]" />
      )}
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {syncing ? t("sync.status.syncing") : t("sync.status.synced")}
          {security?.syncCredentials && (
            <span className="ml-2 text-xs font-normal text-[var(--accent)]">
              + credenciais cifradas
            </span>
          )}
        </p>
        {sync.lastSyncAt && (
          <p className="text-xs text-[var(--text-muted)]">
            {t("sync.status.lastSync", { date: formatDate(sync.lastSyncAt) })}
          </p>
        )}
      </div>
    </div>
  );
}
