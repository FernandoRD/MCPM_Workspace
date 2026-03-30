import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloudUpload, CloudDownload, Check, AlertCircle, Loader2,
  GitBranch, Database, Globe, Plug, ShieldOff,
  Eye, EyeOff, KeyRound, XCircle,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useHostsStore } from "@/store/hosts";
import { useSettingsStore } from "@/store/settings";
import { useCredentialsStore } from "@/store/credentials";
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

// ─── Página principal ─────────────────────────────────────────────────────────

export function Sync() {
  const { t } = useTranslation();
  const hosts = useHostsStore((s) => s.hosts);
  const replaceHosts = useHostsStore((s) => s.replaceHosts);
  const credentials = useCredentialsStore((s) => s.credentials);
  const replaceCredentials = useCredentialsStore((s) => s.replaceCredentials);
  const { settings, updateSync } = useSettingsStore();
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
    } else {
      doPush(null);
    }
  };

  const handlePull = () => {
    if (security?.syncCredentials && security.masterPasswordSet) {
      setMasterPasswordModal({ open: true, action: "pull" });
    } else {
      doPull(null);
    }
  };

  const doPush = async (masterPassword: string | null) => {
    setSyncStatus("pushing");
    setError(null);
    setLastResult(null);
    try {
      const payload = await buildSyncPayload(hosts, credentials, settings, masterPassword);
      await pushToProvider(sync, payload, updateSync);
      updateSync({ lastSyncAt: new Date().toISOString() });
    } catch (e) {
      setError(String(e));
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
        replaceHosts,
        replaceCredentials
      );
      updateSync({ lastSyncAt: new Date().toISOString() });
      setLastResult(result);
    } catch (e) {
      setError(String(e));
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
        </div>
      </div>

      {/* Modal de senha mestra */}
      <MasterPasswordPrompt
        open={masterPasswordModal.open}
        action={masterPasswordModal.action}
        verificationPayload={settings.security?.verificationPayload}
        onConfirm={(password) => {
          const action = masterPasswordModal.action;
          setMasterPasswordModal((m) => ({ ...m, open: false }));
          if (action === "push") doPush(password);
          else doPull(password);
        }}
        onCancel={() => setMasterPasswordModal((m) => ({ ...m, open: false }))}
      />
    </div>
  );
}

// ─── Helpers de provider ──────────────────────────────────────────────────────

async function pushToProvider(
  sync: AppSettings["sync"],
  payload: string,
  updateSync: (s: Partial<AppSettings["sync"]>) => void
): Promise<void> {
  switch (sync.provider) {
    case "githubGist": {
      if (!sync.gist?.token) throw new Error("Token do GitHub não configurado.");
      const newId = await invoke<string>("sync_gist_push", {
        token: sync.gist.token,
        gistId: sync.gist.gistId ?? null,
        payloadJson: payload,
      });
      // Salva o Gist ID retornado pelo GitHub
      if (!sync.gist.gistId) {
        updateSync({ gist: { ...sync.gist, gistId: newId } });
      }
      break;
    }
    case "s3": {
      const s3 = sync.s3;
      if (!s3) throw new Error("S3 não configurado.");
      await invoke("sync_s3_push", {
        endpoint: s3.endpoint ?? "",
        bucket: s3.bucket,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
        payloadJson: payload,
      });
      break;
    }
    case "webdav": {
      const wdav = sync.webdav;
      if (!wdav) throw new Error("WebDAV não configurado.");
      await invoke("sync_webdav_push", {
        url: wdav.url,
        username: wdav.username,
        password: wdav.password,
        path: wdav.path || "vault.json",
        payloadJson: payload,
      });
      break;
    }
    case "custom": {
      if (!sync.custom?.url) throw new Error("URL do endpoint customizado não configurada.");
      await invoke("sync_custom_push", {
        url: sync.custom.url,
        payloadJson: payload,
      });
      break;
    }
    default:
      throw new Error("Nenhum provider de sync configurado.");
  }
}

async function pullFromProvider(sync: AppSettings["sync"]): Promise<string> {
  switch (sync.provider) {
    case "githubGist": {
      if (!sync.gist?.token) throw new Error("Token do GitHub não configurado.");
      if (!sync.gist?.gistId) throw new Error("Gist ID não configurado. Sincronize de outro dispositivo primeiro.");
      return invoke<string>("sync_gist_pull", {
        token: sync.gist.token,
        gistId: sync.gist.gistId,
      });
    }
    case "s3": {
      const s3 = sync.s3;
      if (!s3) throw new Error("S3 não configurado.");
      return invoke<string>("sync_s3_pull", {
        endpoint: s3.endpoint ?? "",
        bucket: s3.bucket,
        region: s3.region,
        accessKey: s3.accessKey,
        secretKey: s3.secretKey,
      });
    }
    case "webdav": {
      const wdav = sync.webdav;
      if (!wdav) throw new Error("WebDAV não configurado.");
      return invoke<string>("sync_webdav_pull", {
        url: wdav.url,
        username: wdav.username,
        password: wdav.password,
        path: wdav.path || "vault.json",
      });
    }
    case "custom": {
      if (!sync.custom?.url) throw new Error("URL do endpoint customizado não configurada.");
      return invoke<string>("sync_custom_pull", { url: sync.custom.url });
    }
    default:
      throw new Error("Nenhum provider de sync configurado.");
  }
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
        placeholder="https://s3.amazonaws.com (vazio = AWS padrão)"
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
