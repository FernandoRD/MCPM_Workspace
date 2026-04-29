import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudUpload, CloudDownload, Check, AlertCircle, Loader2,
  GitBranch, Database, Globe, Plug, ShieldOff,
  Eye, EyeOff, KeyRound, XCircle, Timer,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "@/lib/notifications";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { AppSettings, SyncProvider } from "@/types";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/utils";
import {
  buildSyncPayload,
  parseSyncFile,
  applySyncPayload,
  SyncResult,
} from "@/lib/sync";
import { pushToProvider, pullFromProvider } from "@/lib/syncProviders";
import { APP_NAME } from "@/lib/appInfo";
import { setSessionMasterPassword } from "@/lib/masterPasswordSession";

// ─── Página principal ─────────────────────────────────────────────────────────

export function Sync() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const replaceHosts = useHostsStore((s) => s.replaceHosts);
  const credentials = useCredentialsStore((s) => s.credentials);
  const replaceCredentials = useCredentialsStore((s) => s.replaceCredentials);
  const sshKeys = useSshKeysStore((s) => s.sshKeys);
  const replaceSshKeys = useSshKeysStore((s) => s.replaceSshKeys);
  const { settings, updateSync, replaceSettings } = useSettingsStore();
  const sync = settings.sync;
  const security = settings.security;

  const [syncStatus, setSyncStatus] = useState<"idle" | "pushing" | "pulling">("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const [masterPasswordModal, setMasterPasswordModal] = useState<{
    open: boolean;
    action: "push" | "pull";
  }>({ open: false, action: "push" });

  const isBusy = syncStatus !== "idle";

  const providers: { id: SyncProvider; icon: React.ElementType; title: string; desc: string }[] = [
    { id: "githubGist", icon: GitBranch, title: t("sync.providers.githubGist"), desc: t("sync.providers.githubGistDescription") },
    { id: "s3", icon: Database, title: t("sync.providers.s3"), desc: t("sync.providers.s3Description") },
    { id: "webdav", icon: Globe, title: t("sync.providers.webdav"), desc: t("sync.providers.webdavDescription") },
    { id: "custom", icon: Plug, title: t("sync.providers.custom"), desc: t("sync.providers.customDescription") },
  ];

  const handlePush = () => {
    if (security?.syncCredentials && security.masterPasswordSet) {
      setMasterPasswordModal({ open: true, action: "push" });
    } else if (security?.syncCredentials && !security.masterPasswordSet) {
      // syncCredentials ativo mas sem senha mestra definida: bloqueia o push
      // para evitar silenciosamente descartar segredos configurados pelo usuário.
      setError(t("sync.errors.syncCredentialsNoMasterPassword"));
    } else {
      doPush(null);
    }
  };

  const handlePull = () => {
    if (security?.syncCredentials && security.masterPasswordSet) {
      setMasterPasswordModal({ open: true, action: "pull" });
    } else if (security?.syncCredentials && !security.masterPasswordSet) {
      setError(t("sync.errors.syncCredentialsNoMasterPassword"));
    } else {
      doPull(null);
    }
  };

  const doPush = async (masterPassword: string | null) => {
    setSyncStatus("pushing");
    setError(null);
    setLastResult(null);
    try {
      const payload = await buildSyncPayload(hosts, credentials, sshKeys, settings, masterPassword);
      const newGistId = await pushToProvider(sync, payload);
      if (newGistId) updateSync({ gist: { ...sync.gist!, gistId: newGistId } });
      updateSync({ lastSyncAt: new Date().toISOString() });
      notify(APP_NAME, t("notifications.syncPushSuccess"));
    } catch (e) {
      setError(String(e));
      notify(APP_NAME, t("notifications.syncError"));
    } finally {
      setSyncStatus("idle");
    }
  };

  const doPull = async (masterPassword: string | null) => {
    setSyncStatus("pulling");
    setError(null);
    setLastResult(null);
    try {
      const remoteJson = await pullFromProvider(sync);
      const file = parseSyncFile(remoteJson);
      const result = await applySyncPayload(
        file,
        masterPassword,
        "merge",
        hosts,
        credentials,
        sshKeys,
        settings,
        replaceHosts,
        replaceCredentials,
        replaceSshKeys,
        replaceSettings
      );
      updateSync({ lastSyncAt: new Date().toISOString() });
      setLastResult(result);
      notify(APP_NAME, t("notifications.syncPullSuccess"));
    } catch (e) {
      setError(String(e));
      notify(APP_NAME, t("notifications.syncError"));
    } finally {
      setSyncStatus("idle");
    }
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
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handlePull} disabled={isBusy}>
              {syncStatus === "pulling"
                ? <Loader2 size={14} className="animate-spin" />
                : <CloudDownload size={14} />}
              {t("sync.actions.importFromRemote")}
            </Button>
            <Button onClick={handlePush} disabled={isBusy}>
              {syncStatus === "pushing"
                ? <Loader2 size={14} className="animate-spin" />
                : <CloudUpload size={14} />}
              {t("sync.actions.syncNow")}
            </Button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-6">
          {/* Status */}
          <StatusCard sync={sync} security={security} syncStatus={syncStatus} lastResult={lastResult} />

          {/* Erro */}
          {error && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3">
              <XCircle size={16} className="text-[var(--danger)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--danger)]">{error}</p>
            </div>
          )}

          {/* Aviso de credenciais cifradas */}
          {security?.syncCredentials && security.masterPasswordSet && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-subtle)] px-4 py-3">
              <KeyRound size={16} className="text-[var(--accent)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--accent)]">
                {t("sync.credentialsEncryptedNotice")}
              </p>
            </div>
          )}
          {security?.syncCredentials && !security.masterPasswordSet && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-4 py-3">
              <AlertCircle size={16} className="text-[var(--danger)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--danger)]">
                {t("sync.errors.syncCredentialsNoMasterPassword")}
              </p>
            </div>
          )}
          {!security?.syncCredentials && (
            <div className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3">
              <ShieldOff size={16} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
              <p className="text-sm text-[var(--text-muted)]">
                {!security?.masterPasswordSet
                  ? t("sync.noMasterPasswordNotice")
                  : t("sync.credentialsSyncDisabledNotice")}
              </p>
            </div>
          )}

          {/* Seleção de provider */}
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

          {/* Formulários por provider */}
          {sync.provider === "githubGist" && (
            <GistConfigForm sync={sync} updateSync={updateSync} />
          )}
          {sync.provider === "s3" && (
            <S3ConfigForm sync={sync} updateSync={updateSync} />
          )}
          {sync.provider === "webdav" && (
            <WebDavConfigForm sync={sync} updateSync={updateSync} />
          )}
          {sync.provider === "custom" && (
            <CustomConfigForm sync={sync} updateSync={updateSync} />
          )}

          {/* Sync automático */}
          {sync.provider && (
            <AutoSyncConfig sync={sync} updateSync={updateSync} security={security} />
          )}
        </div>
      </div>

      {/* Modal de senha mestra */}
      <MasterPasswordPrompt
        open={masterPasswordModal.open}
        action={masterPasswordModal.action}
        verificationPayload={settings.security?.verificationPayload}
        onConfirm={(password) => {
          const action = masterPasswordModal.action;
          setSessionMasterPassword(password);
          setMasterPasswordModal((m) => ({ ...m, open: false }));
          if (action === "push") doPush(password);
          else doPull(password);
        }}
        onCancel={() => setMasterPasswordModal((m) => ({ ...m, open: false }))}
      />
    </div>
  );
}

// ─── Formulários de configuração ──────────────────────────────────────────────

function GistConfigForm({
  sync,
  updateSync,
}: {
  sync: AppSettings["sync"];
  updateSync: (s: Partial<AppSettings["sync"]>) => void;
}) {
  const { t } = useTranslation();
  const [token, setToken] = useState(sync.gist?.token ?? "");
  const [gistId, setGistId] = useState(sync.gist?.gistId ?? "");
  const [showToken, setShowToken] = useState(false);

  const handleSave = () =>
    updateSync({ provider: "githubGist", gist: { token, gistId: gistId || undefined } });

  return (
    <ProviderForm
      title={t("sync.providers.githubGist")}
      onDisconnect={() => updateSync({ provider: null })}
      onSave={handleSave}
      saveDisabled={!token}
    >
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          {t("sync.githubGist.token")}
        </label>
        <div className="relative">
          <input
            type={showToken ? "text" : "password"}
            placeholder={t("sync.githubGist.tokenPlaceholder")}
            value={token}
            onChange={(e) => setToken(e.target.value)}
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
      {sync.gist?.gistId && (
        <p className="text-xs text-[var(--text-muted)]">
          {t("sync.githubGist.currentGistId")}: <span className="font-mono">{sync.gist.gistId}</span>
        </p>
      )}
    </ProviderForm>
  );
}

function S3ConfigForm({
  sync,
  updateSync,
}: {
  sync: AppSettings["sync"];
  updateSync: (s: Partial<AppSettings["sync"]>) => void;
}) {
  const { t } = useTranslation();
  const s3 = sync.s3;
  const [endpoint, setEndpoint] = useState(s3?.endpoint ?? "");
  const [bucket, setBucket] = useState(s3?.bucket ?? "");
  const [region, setRegion] = useState(s3?.region ?? "us-east-1");
  const [accessKey, setAccessKey] = useState(s3?.accessKey ?? "");
  const [secretKey, setSecretKey] = useState(s3?.secretKey ?? "");
  const [showSecret, setShowSecret] = useState(false);

  const handleSave = () =>
    updateSync({ provider: "s3", s3: { endpoint, bucket, region, accessKey, secretKey } });

  return (
    <ProviderForm
      title={t("sync.providers.s3")}
      onDisconnect={() => updateSync({ provider: null })}
      onSave={handleSave}
      saveDisabled={!bucket || !region || !accessKey || !secretKey}
    >
      <Input
        id="s3-endpoint"
        label={t("sync.s3.endpoint")}
        placeholder={t("sync.s3.endpointPlaceholder")}
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        hint={t("sync.s3.endpointHint")}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          id="s3-bucket"
          label={t("sync.s3.bucket")}
          placeholder="meu-bucket"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
        />
        <Input
          id="s3-region"
          label={t("sync.s3.region")}
          placeholder="us-east-1"
          value={region}
          onChange={(e) => setRegion(e.target.value)}
        />
      </div>
      <Input
        id="s3-access-key"
        label={t("sync.s3.accessKey")}
        placeholder="AKIAIOSFODNN7EXAMPLE"
        value={accessKey}
        onChange={(e) => setAccessKey(e.target.value)}
      />
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-[var(--text-primary)]">
          {t("sync.s3.secretKey")}
        </label>
        <div className="relative">
          <input
            type={showSecret ? "text" : "password"}
            placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
          />
          <button
            type="button"
            onClick={() => setShowSecret((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
      </div>
    </ProviderForm>
  );
}

function WebDavConfigForm({
  sync,
  updateSync,
}: {
  sync: AppSettings["sync"];
  updateSync: (s: Partial<AppSettings["sync"]>) => void;
}) {
  const { t } = useTranslation();
  const wdav = sync.webdav;
  const [url, setUrl] = useState(wdav?.url ?? "");
  const [username, setUsername] = useState(wdav?.username ?? "");
  const [password, setPassword] = useState(wdav?.password ?? "");
  const [path, setPath] = useState(wdav?.path ?? "vault.json");
  const [showPassword, setShowPassword] = useState(false);

  const handleSave = () =>
    updateSync({ provider: "webdav", webdav: { url, username, password, path } });

  return (
    <ProviderForm
      title={t("sync.providers.webdav")}
      onDisconnect={() => updateSync({ provider: null })}
      onSave={handleSave}
      saveDisabled={!url || !username}
    >
      <Input
        id="webdav-url"
        label={t("sync.webdav.url")}
        placeholder="https://nextcloud.example.com/remote.php/dav/files/user"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        hint={t("sync.webdav.urlHint")}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          id="webdav-username"
          label={t("sync.webdav.username")}
          placeholder="usuario"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-[var(--text-primary)]">
            {t("sync.webdav.password")}
          </label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
      </div>
      <Input
        id="webdav-path"
        label={t("sync.webdav.path")}
        placeholder="vault.json"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        hint={t("sync.webdav.pathHint")}
      />
    </ProviderForm>
  );
}

function CustomConfigForm({
  sync,
  updateSync,
}: {
  sync: AppSettings["sync"];
  updateSync: (s: Partial<AppSettings["sync"]>) => void;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(sync.custom?.url ?? "");

  const handleSave = () => updateSync({ provider: "custom", custom: { url } });

  return (
    <ProviderForm
      title={t("sync.providers.custom")}
      onDisconnect={() => updateSync({ provider: null })}
      onSave={handleSave}
      saveDisabled={!url}
    >
      <Input
        id="custom-url"
        label={t("sync.custom.url")}
        placeholder="https://api.example.com/vault"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        hint={t("sync.custom.urlHint")}
      />
    </ProviderForm>
  );
}

// ─── Auto-sync ────────────────────────────────────────────────────────────────

const INTERVAL_OPTIONS = [
  { minutes: 15,  labelKey: "sync.autoSync.interval15" },
  { minutes: 30,  labelKey: "sync.autoSync.interval30" },
  { minutes: 60,  labelKey: "sync.autoSync.interval60" },
  { minutes: 120, labelKey: "sync.autoSync.interval120" },
];

function AutoSyncConfig({
  sync,
  updateSync,
  security,
}: {
  sync: AppSettings["sync"];
  updateSync: (s: Partial<AppSettings["sync"]>) => void;
  security: AppSettings["security"];
}) {
  const { t } = useTranslation();
  const interval = sync.autoSyncIntervalMinutes ?? 30;
  const [remainingMin, setRemainingMin] = useState<number | null>(null);
  const masterPasswordMissing = !security?.masterPasswordSet;
  const firstManualSyncMissing = !sync.lastSyncAt;
  const blocked = sync.autoSync && (masterPasswordMissing || firstManualSyncMissing);

  const handleToggle = () => {
    if (sync.autoSync) {
      updateSync({ autoSync: false });
      return;
    }

    if (masterPasswordMissing) return;
    updateSync({ autoSync: true });
  };

  // Atualiza o countdown a cada 30 s com base em lastSyncAt + intervalo
  useEffect(() => {
    if (!sync.autoSync) {
      setRemainingMin(null);
      return;
    }

    const update = () => {
      const intervalMs = (sync.autoSyncIntervalMinutes ?? 30) * 60_000;
      if (sync.lastSyncAt) {
        const nextAt = new Date(sync.lastSyncAt).getTime() + intervalMs;
        const diffMs = nextAt - Date.now();
        setRemainingMin(diffMs > 0 ? Math.ceil(diffMs / 60_000) : 0);
      } else {
        // Nunca sincronizou — mostra o intervalo completo como estimativa
        setRemainingMin(sync.autoSyncIntervalMinutes ?? 30);
      }
    };

    update();
    const id = setInterval(update, 30_000);
    return () => clearInterval(id);
  }, [sync.autoSync, sync.lastSyncAt, sync.autoSyncIntervalMinutes]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 flex flex-col gap-4">
      {/* Header com toggle */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {t("sync.autoSync.title")}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t("sync.autoSync.description")}
          </p>
        </div>
        {/* Toggle switch */}
        <button
          role="switch"
          aria-checked={sync.autoSync}
          aria-disabled={!sync.autoSync && masterPasswordMissing}
          title={masterPasswordMissing ? t("sync.autoSync.blockedNoMasterPassword") : undefined}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            sync.autoSync ? "bg-[var(--accent)]" : "bg-[var(--border)]",
            !sync.autoSync && masterPasswordMissing && "cursor-not-allowed opacity-60"
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
              sync.autoSync ? "translate-x-5" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {masterPasswordMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--danger)]" />
          <p className="text-xs leading-relaxed text-[var(--danger)]">
            {t("sync.autoSync.blockedNoMasterPassword")}
          </p>
        </div>
      )}

      {sync.autoSync && !masterPasswordMissing && firstManualSyncMissing && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--accent)]/30 bg-[var(--accent-subtle)] px-3 py-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <p className="text-xs leading-relaxed text-[var(--accent)]">
            {t("sync.autoSync.waitingFirstManualSync")}
          </p>
        </div>
      )}

      {/* Intervalo + countdown — só mostra quando ativado */}
      {sync.autoSync && (
        <>
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-[var(--text-secondary)]">
              {t("sync.autoSync.intervalLabel")}
            </p>
            <div className="flex gap-2">
              {INTERVAL_OPTIONS.map(({ minutes, labelKey }) => (
                <button
                  key={minutes}
                  onClick={() => updateSync({ autoSyncIntervalMinutes: minutes })}
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-xs transition-colors",
                    interval === minutes
                      ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                      : "border-[var(--border)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
                  )}
                >
                  {t(labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Próximo sync */}
          {remainingMin !== null && !blocked && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
              <Timer size={13} className="text-[var(--accent)] shrink-0" />
              <p className="text-xs text-[var(--text-secondary)]">
                {remainingMin === 0
                  ? t("sync.autoSync.nextSyncNow")
                  : t("sync.autoSync.nextSyncIn", { minutes: remainingMin })}
              </p>
            </div>
          )}

          {/* Aviso sobre credenciais */}
          {security?.syncCredentials && security.masterPasswordSet && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
              <KeyRound size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {t("sync.autoSync.masterPasswordSessionHint")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Provider form wrapper ────────────────────────────────────────────────────

function ProviderForm({
  title, onDisconnect, onSave, saveDisabled, children,
}: {
  title: string;
  onDisconnect: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 flex flex-col gap-4">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      {children}
      <div className="flex justify-end gap-2 pt-1">
        <Button variant="secondary" size="sm" onClick={onDisconnect}>
          {t("sync.actions.disconnect")}
        </Button>
        <Button size="sm" onClick={onSave} disabled={saveDisabled}>
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// ─── Status card ──────────────────────────────────────────────────────────────

function StatusCard({
  sync, security, syncStatus, lastResult,
}: {
  sync: AppSettings["sync"];
  security: AppSettings["security"];
  syncStatus: "idle" | "pushing" | "pulling";
  lastResult: SyncResult | null;
}) {
  const { t } = useTranslation();
  const isBusy = syncStatus !== "idle";

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
      {isBusy ? (
        <Loader2 size={18} className="text-[var(--accent)] animate-spin" />
      ) : (
        <Check size={18} className="text-[var(--success)]" />
      )}
      <div className="flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {syncStatus === "pushing"
            ? t("sync.status.pushing")
            : syncStatus === "pulling"
            ? t("sync.status.pulling")
            : t("sync.status.synced")}
          {!isBusy && security?.syncCredentials && (
            <span className="ml-2 text-xs font-normal text-[var(--accent)]">
              + {t("sync.credentialsEncrypted")}
            </span>
          )}
        </p>
        {sync.lastSyncAt && !isBusy && (
          <p className="text-xs text-[var(--text-muted)]">
            {t("sync.status.lastSync", { date: formatDate(sync.lastSyncAt) })}
          </p>
        )}
        {lastResult && !isBusy && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t("sync.status.importResult", {
              hostsAdded: lastResult.hostsAdded,
              hostsUpdated: lastResult.hostsUpdated,
              credentialsAdded: lastResult.credentialsAdded,
              credentialsUpdated: lastResult.credentialsUpdated,
              sshKeysAdded: lastResult.sshKeysAdded,
              sshKeysUpdated: lastResult.sshKeysUpdated,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Modal de senha mestra ────────────────────────────────────────────────────

function MasterPasswordPrompt({
  open, action, verificationPayload, onConfirm, onCancel,
}: {
  open: boolean;
  action: "push" | "pull";
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
    <Modal open={open} onClose={onCancel} title={t("settings.security.masterPassword")} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--text-secondary)]">
          {action === "push"
            ? t("sync.masterPasswordPushPrompt")
            : t("sync.masterPasswordPullPrompt")}
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
