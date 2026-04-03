import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, ChevronRight, ArrowLeft, RefreshCw, Lock, KeyRound, Cpu, Plus, Upload, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import QRCode from "react-qr-code";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { useSettingsStore } from "@/store/settings";
import { SshHost, Credential, SshCompatPreset } from "@/types";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";
import { TotpDisplay } from "@/components/TotpDisplay/TotpDisplay";
import { cn } from "@/lib/utils";

type FormData = Omit<SshHost, "id" | "createdAt" | "updatedAt" | "authMethod" | "passwordRef" | "privateKeyContent" | "passphrase" | "username">;

const DEFAULT_FORM: FormData = {
  label: "",
  host: "",
  port: 22,
  tags: [],
  sshCompat: { preset: "modern" },
};

interface ValidationErrors {
  label?: string;
  host?: string;
  port?: string;
}

interface TotpSetup {
  secret: string;
  otpauth_url: string;
}

export function HostEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new" || !id;
  const { addHost, updateHost, getHost, hosts } = useHostsStore();
  const savedGroups = useSettingsStore((s) => s.settings.groups);
  const credentials = useCredentialsStore((s) => s.credentials);
  const getSshKey = useSshKeysStore((s) => s.getSshKey);

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["connection", "authentication"])
  );
  const [tagsInput, setTagsInput] = useState("");
  const [totpOtpauthUrl, setTotpOtpauthUrl] = useState<string | null>(null);
  const [generatingTotp, setGeneratingTotp] = useState(false);

  // ssh-copy-id
  const [copyIdPassword, setCopyIdPassword] = useState("");
  const [copyIdStatus, setCopyIdStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [copyIdError, setCopyIdError] = useState<string | null>(null);

  useEffect(() => {
    if (!isNew && id) {
      const host = getHost(id);
      if (host) {
        const { id: _id, createdAt: _c, updatedAt: _u, authMethod: _a, passwordRef: _p, username: _un, ...data } = host;
        setForm(data);
        setTagsInput(host.tags.join(", "));
      }
    }
  }, [id, isNew, getHost]);

  const generateTotpSecret = async () => {
    setGeneratingTotp(true);
    try {
      const setup = await invoke<TotpSetup>("generate_totp_secret", {
        issuer: "SSH Vault",
        accountName: form.label || form.host || "host",
      });
      set("totpSecret", setup.secret);
      setTotpOtpauthUrl(setup.otpauth_url);
    } finally {
      setGeneratingTotp(false);
    }
  };

  const handleCopyId = async (credential: Credential) => {
    if (!form.host || !credential.keyId) return;
    const key = getSshKey(credential.keyId);
    if (!key?.publicKeyContent) return;
    setCopyIdStatus("loading");
    setCopyIdError(null);
    try {
      await invoke("ssh_copy_id", {
        host: form.host,
        port: form.port,
        username: credential.username,
        password: copyIdPassword,
        publicKeyContent: key.publicKeyContent.trim(),
      });
      setCopyIdStatus("success");
      setCopyIdPassword("");
    } catch (e) {
      setCopyIdStatus("error");
      setCopyIdError(String(e));
    }
  };

  const toggleSection = (s: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const errs: ValidationErrors = {};
    if (!form.label.trim()) errs.label = t("hostEditor.validation.labelRequired");
    if (!form.host.trim()) errs.host = t("hostEditor.validation.hostRequired");
    if (form.port < 1 || form.port > 65535) errs.port = t("hostEditor.validation.portInvalid");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (isNew) {
      // Para hosts novos, deriva authMethod da credencial selecionada (se houver)
      const selectedCred = form.credentialId
        ? credentials.find((c) => c.id === form.credentialId)
        : undefined;
      const authMethod = selectedCred?.authMethod ?? "password";
      const newHostData = { ...form, tags, authMethod };
      addHost(newHostData);
    } else if (id) {
      // Ao editar, não sobrescreve authMethod — preserva o valor existente no host
      const editData = { ...form, tags };
      updateHost(id, editData);
    }
    navigate("/");
  };

  const otherHosts = hosts.filter((h) => h.id !== id);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {isNew ? t("hostEditor.titleNew") : t("hostEditor.titleEdit")}
        </h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-4">
          {/* Connection Section */}
          <Section
            id="connection"
            title={t("hostEditor.sections.connection")}
            open={openSections.has("connection")}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <Input
                  id="label"
                  label={t("hostEditor.fields.label")}
                  placeholder={t("hostEditor.fields.labelPlaceholder")}
                  value={form.label}
                  onChange={(e) => set("label", e.target.value)}
                  error={errors.label}
                />
              </div>
              <div className="sm:col-span-2">
                <Input
                  id="host"
                  label={t("hostEditor.fields.host")}
                  placeholder={t("hostEditor.fields.hostPlaceholder")}
                  value={form.host}
                  onChange={(e) => set("host", e.target.value)}
                  error={errors.host}
                />
              </div>
              <Input
                id="port"
                label={t("hostEditor.fields.port")}
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set("port", parseInt(e.target.value) || 22)}
                error={errors.port}
              />
            </div>
          </Section>

          {/* Authentication Section */}
          <Section
            id="authentication"
            title={t("hostEditor.sections.authentication")}
            open={openSections.has("authentication")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-3 mt-1">
              {credentials.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-6 text-center rounded-lg border border-dashed border-[var(--border)]">
                  <p className="text-sm text-[var(--text-muted)]">
                    {t("credentials.noCredentials")}
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate("/credentials/new")}
                  >
                    <Plus size={13} />
                    {t("credentials.createFirst")}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-[var(--text-muted)] mb-1">
                    {t("credentials.selectCredential")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {credentials.map((cred) => (
                      <CredentialCard
                        key={cred.id}
                        credential={cred}
                        selected={form.credentialId === cred.id}
                        onSelect={() => {
                          set("credentialId", form.credentialId === cred.id ? undefined : cred.id);
                          setCopyIdStatus("idle");
                          setCopyIdError(null);
                          setCopyIdPassword("");
                        }}
                      />
                    ))}
                  </div>
                  {/* Painel ssh-copy-id */}
                  {(() => {
                    const cred = credentials.find((c) => c.id === form.credentialId);
                    const key = cred?.keyId ? getSshKey(cred.keyId) : undefined;
                    if (!cred || cred.authMethod !== "privateKey" || !key?.publicKeyContent) return null;
                    return (
                      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-4 flex flex-col gap-3 mt-1">
                        <div className="flex items-center gap-2">
                          <Upload size={14} className="text-[var(--accent)] flex-shrink-0" />
                          <p className="text-sm font-medium text-[var(--text-primary)]">
                            {t("hostEditor.copyId.title")}
                          </p>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                          {t("hostEditor.copyId.description")}
                        </p>
                        {copyIdStatus === "success" ? (
                          <div className="flex items-center gap-2 rounded-md bg-[var(--success-subtle,#d1fae5)] px-3 py-2">
                            <CheckCircle2 size={14} className="text-[var(--success,#10b981)] flex-shrink-0" />
                            <p className="text-xs text-[var(--success,#10b981)] font-medium">
                              {t("hostEditor.copyId.success")}
                            </p>
                          </div>
                        ) : (
                          <>
                            <Input
                              id="copyIdPassword"
                              label={t("hostEditor.copyId.passwordLabel")}
                              type="password"
                              placeholder="••••••••"
                              value={copyIdPassword}
                              onChange={(e) => {
                                setCopyIdPassword(e.target.value);
                                if (copyIdStatus === "error") {
                                  setCopyIdStatus("idle");
                                  setCopyIdError(null);
                                }
                              }}
                            />
                            {copyIdStatus === "error" && copyIdError && (
                              <div className="flex items-start gap-2 rounded-md border border-[var(--danger)] bg-[var(--danger-subtle,#fee2e2)] px-3 py-2">
                                <XCircle size={14} className="text-[var(--danger)] flex-shrink-0 mt-0.5" />
                                <p className="text-xs text-[var(--danger)]">{copyIdError}</p>
                              </div>
                            )}
                            <Button
                              variant="secondary"
                              size="sm"
                              className="self-start gap-2"
                              disabled={!copyIdPassword.trim() || copyIdStatus === "loading" || !form.host.trim()}
                              onClick={() => handleCopyId(cred)}
                            >
                              {copyIdStatus === "loading"
                                ? <Loader2 size={13} className="animate-spin" />
                                : <Upload size={13} />}
                              {copyIdStatus === "loading"
                                ? t("hostEditor.copyId.copying")
                                : t("hostEditor.copyId.button")}
                            </Button>
                          </>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}
              <button
                type="button"
                onClick={() => navigate("/credentials")}
                className="self-start text-xs text-[var(--accent)] hover:underline mt-1"
              >
                {t("credentials.manageCredentials")}
              </button>
            </div>
          </Section>

          {/* Advanced Section */}
          <Section
            id="advanced"
            title={t("hostEditor.sections.advanced")}
            open={openSections.has("advanced")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <GroupCombobox
                  value={form.group ?? ""}
                  onChange={(v) => set("group", v || undefined)}
                  existingGroups={[
                    ...new Set([
                      ...hosts.map((h) => h.group).filter((g): g is string => !!g),
                      ...savedGroups,
                    ]),
                  ].sort()}
                />
                <Input
                  id="color"
                  label="Cor"
                  type="color"
                  value={form.color ?? "#388bfd"}
                  onChange={(e) => set("color", e.target.value)}
                  className="h-9 cursor-pointer"
                />
              </div>
              <Input
                id="tags"
                label={t("hostEditor.fields.tags")}
                placeholder={t("hostEditor.fields.tagsPlaceholder")}
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                hint="Separe as tags por vírgula"
              />
              {otherHosts.length > 0 && (
                <Select
                  id="jumpHost"
                  label={t("hostEditor.fields.jumpHost")}
                  value={form.jumpHostId ?? ""}
                  onChange={(e) => set("jumpHostId", e.target.value || undefined)}
                >
                  <option value="">{t("hostEditor.fields.jumpHostPlaceholder")}</option>
                  {otherHosts.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label} ({h.host}:{h.port})
                    </option>
                  ))}
                </Select>
              )}
              <Textarea
                id="notes"
                label={t("hostEditor.fields.notes")}
                placeholder={t("hostEditor.fields.notesPlaceholder")}
                rows={3}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value || undefined)}
              />
            </div>
          </Section>

          {/* SSH Compat Section */}
          <Section
            id="sshCompat"
            title={t("hostEditor.sshCompat.section")}
            open={openSections.has("sshCompat")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-3">
              <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                {t("hostEditor.sshCompat.description")}
              </p>
              <div className="flex flex-col gap-2">
                {(["modern", "legacy", "very-legacy"] as SshCompatPreset[]).map((preset) => {
                  const selected = (form.sshCompat?.preset ?? "modern") === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => set("sshCompat", { preset })}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border px-4 py-3 text-left transition-colors",
                        selected
                          ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                          : "border-[var(--border)] bg-[var(--bg-primary)] hover:border-[var(--border-focus)] hover:bg-[var(--bg-hover)]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-semibold",
                          selected ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
                        )}>
                          {t(`hostEditor.sshCompat.${preset === "very-legacy" ? "veryLegacy" : preset}`)}
                        </span>
                        {preset === "modern" && (
                          <span className="rounded-full bg-[var(--success-subtle,#d1fae5)] px-2 py-0.5 text-[10px] font-medium text-[var(--success,#10b981)]">
                            Recomendado
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)]">
                        {t(`hostEditor.sshCompat.${preset === "very-legacy" ? "veryLegacyDesc" : preset + "Desc"}`)}
                      </p>
                      <p className="text-[11px] font-mono text-[var(--text-muted)] opacity-70">
                        {t(`hostEditor.sshCompat.${preset === "very-legacy" ? "veryLegacyAlgos" : preset + "Algos"}`)}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </Section>

          {/* MFA Section */}
          <Section
            id="mfa"
            title={t("hostEditor.mfa.section")}
            open={openSections.has("mfa")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4">
              {/* Enable toggle */}
              <label className="flex items-start gap-3 cursor-pointer">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={form.mfaEnabled ?? false}
                    onChange={(e) => {
                      set("mfaEnabled", e.target.checked);
                      if (!e.target.checked) {
                        set("totpSecret", undefined);
                        setTotpOtpauthUrl(null);
                      }
                    }}
                  />
                  <div className="h-5 w-9 rounded-full bg-[var(--border)] peer-checked:bg-[var(--accent)] transition-colors" />
                  <div className="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {t("hostEditor.mfa.enable")}
                  </p>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">
                    {t("hostEditor.mfa.enableDescription")}
                  </p>
                </div>
              </label>

              {form.mfaEnabled && (
                <>
                  {/* Secret input + generate button */}
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <Input
                        id="totpSecret"
                        label={t("hostEditor.mfa.secret")}
                        placeholder={t("hostEditor.mfa.secretPlaceholder")}
                        value={form.totpSecret ?? ""}
                        onChange={(e) => {
                          set("totpSecret", e.target.value.toUpperCase() || undefined);
                          setTotpOtpauthUrl(null);
                        }}
                        className="font-mono"
                      />
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mb-0.5 flex-shrink-0"
                      onClick={generateTotpSecret}
                      disabled={generatingTotp}
                    >
                      <RefreshCw size={13} className={generatingTotp ? "animate-spin" : ""} />
                      {t("hostEditor.mfa.generateSecret")}
                    </Button>
                  </div>

                  {/* QR Code */}
                  {totpOtpauthUrl && (
                    <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--border)] bg-white p-4">
                      <QRCode value={totpOtpauthUrl} size={160} />
                      <p className="text-xs text-center text-[var(--text-muted)] leading-relaxed" style={{color: "#555"}}>
                        {t("hostEditor.mfa.scanQr")}
                      </p>
                    </div>
                  )}

                  {/* Live TOTP preview */}
                  {form.totpSecret && form.totpSecret.length >= 8 && (
                    <TotpDisplay secretBase32={form.totpSecret} />
                  )}
                </>
              )}
            </div>
          </Section>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => navigate(-1)}>
              {t("hostEditor.actions.cancel")}
            </Button>
            <Button onClick={handleSave}>
              {t("hostEditor.actions.save")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CredentialCard({
  credential,
  selected,
  onSelect,
}: {
  credential: Credential;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation();
  const icons: Record<string, React.ReactNode> = {
    password: <Lock size={14} />,
    privateKey: <KeyRound size={14} />,
    agent: <Cpu size={14} />,
  };
  const typeLabel = t(`credentials.types.${credential.authMethod}`);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
          : "border-[var(--border)] bg-[var(--bg-primary)] hover:border-[var(--border-focus)] hover:bg-[var(--bg-hover)]"
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md",
          selected ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-secondary)] text-[var(--accent)]"
        )}
      >
        {icons[credential.authMethod]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
          {credential.label}
        </p>
        <p className="text-xs text-[var(--text-muted)] truncate">
          {credential.username && <span className="font-mono">{credential.username} · </span>}
          {typeLabel}
        </p>
      </div>
    </button>
  );
}

function GroupCombobox({
  value,
  onChange,
  existingGroups,
}: {
  value: string;
  onChange: (v: string) => void;
  existingGroups: string[];
}) {
  const { t } = useTranslation();
  const listId = "group-datalist";
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="group" className="text-sm font-medium text-[var(--text-primary)]">
        {t("hostEditor.fields.group")}
      </label>
      <input
        id="group"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("hostEditor.fields.groupPlaceholder")}
        className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
      />
      <datalist id={listId}>
        {existingGroups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </div>
  );
}

function Section({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: (id: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
      >
        {title}
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && <div className="px-5 pb-5 pt-1 border-t border-[var(--border)]">{children}</div>}
    </div>
  );
}
