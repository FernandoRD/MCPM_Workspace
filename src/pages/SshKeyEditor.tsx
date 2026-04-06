import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, FolderOpen, Server, CheckCircle2, AlertCircle, Loader2, Wand2, Copy, Check } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { useSshKeysStore } from "@/store/sshKeys";
import { useHostsStore } from "@/store/hosts";
import { useCredentialsStore } from "@/store/credentials";
import { SshKey } from "@/types";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Button } from "@/components/ui/Button";

type FormData = Omit<SshKey, "id" | "createdAt" | "updatedAt">;

const DEFAULT_FORM: FormData = {
  label: "",
  privateKeyContent: "",
};

interface ValidationErrors {
  label?: string;
  privateKeyContent?: string;
}

function Section({
  id,
  title,
  open: isOpen,
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
        {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {isOpen && (
        <div className="px-5 pb-5 pt-1 border-t border-[var(--border)]">{children}</div>
      )}
    </div>
  );
}

interface DeployForm {
  host: string;
  port: string;
  username: string;
  password: string;
}

type DeployStatus = "idle" | "deploying" | "success" | "error";
type GenerateStatus = "idle" | "generating" | "done" | "error";
type KeyType = "ed25519" | "ecdsa" | "rsa2048" | "rsa4096";

export function SshKeyEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new" || !id;

  const { addSshKey, updateSshKey, getSshKey } = useSshKeysStore();
  const hosts = useHostsStore((s) => s.hosts);
  const getCredential = useCredentialsStore((s) => s.getCredential);

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(isNew ? ["generate", "general"] : ["general", "privateKey", "publicKey"])
  );

  // Deploy (ssh-copy-id) state
  const [deployForm, setDeployForm] = useState<DeployForm>({ host: "", port: "22", username: "", password: "" });
  const [deployStatus, setDeployStatus] = useState<DeployStatus>("idle");
  const [deployError, setDeployError] = useState<string | null>(null);

  // Generate key state
  const [genKeyType, setGenKeyType] = useState<KeyType>("ed25519");
  const [genComment, setGenComment] = useState("");
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>("idle");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [fingerprintCopied, setFingerprintCopied] = useState(false);

  useEffect(() => {
    if (!isNew && id) {
      const key = getSshKey(id);
      if (key) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...data } = key;
        setForm(data);
      }
    }
  }, [id, isNew, getSshKey]);

  const toggleSection = (s: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const importFile = async (field: "privateKeyContent" | "publicKeyContent") => {
    const path = await open({ multiple: false, directory: false });
    if (!path) return;
    const content = await readTextFile(path as string);
    set(field, content.trim());
  };

  const setDeploy = <K extends keyof DeployForm>(key: K, value: DeployForm[K]) =>
    setDeployForm((prev) => ({ ...prev, [key]: value }));

  const fillFromHost = (hostId: string) => {
    const h = hosts.find((x) => x.id === hostId);
    if (!h) return;
    const cred = h.credentialId ? getCredential(h.credentialId) : undefined;
    setDeployForm({
      host: h.host,
      port: String(h.port),
      username: cred?.username ?? h.username ?? "",
      password: cred?.password ?? "",
    });
  };

  const handleDeploy = async () => {
    const sanitizedHost = deployForm.host.trim();
    const sanitizedUsername = deployForm.username.trim();
    if (!form.publicKeyContent?.trim() || !sanitizedHost || !sanitizedUsername) return;
    setDeployStatus("deploying");
    setDeployError(null);
    try {
      await invoke("ssh_copy_id", {
        host: sanitizedHost,
        port: parseInt(deployForm.port, 10) || 22,
        username: sanitizedUsername,
        password: deployForm.password,
        publicKeyContent: form.publicKeyContent.trim(),
      });
      setDeployStatus("success");
    } catch (err) {
      setDeployStatus("error");
      setDeployError(String(err));
    }
  };

  const handleGenerate = async () => {
    setGenerateStatus("generating");
    setGenerateError(null);
    try {
      const result = await invoke<{ private_key: string; public_key: string; fingerprint: string }>(
        "ssh_generate_key",
        { keyType: genKeyType, comment: genComment.trim() || null }
      );
      set("privateKeyContent", result.private_key);
      set("publicKeyContent", result.public_key);
      setLastFingerprint(result.fingerprint);
      setGenerateStatus("done");
      // Abre as seções de chave para o usuário ver o resultado
      setOpenSections((prev) => new Set([...prev, "privateKey", "publicKey"]));
    } catch (err) {
      setGenerateStatus("error");
      setGenerateError(String(err));
    }
  };

  const handleCopyFingerprint = (fingerprint: string) => {
    navigator.clipboard.writeText(fingerprint);
    setFingerprintCopied(true);
    setTimeout(() => setFingerprintCopied(false), 2000);
  };

  // Fingerprint retornado pela última geração de chave
  const [lastFingerprint, setLastFingerprint] = useState<string | null>(null);

  const validate = (): boolean => {
    const errs: ValidationErrors = {};
    if (!form.label.trim()) errs.label = t("sshKeys.validation.labelRequired");
    if (!form.privateKeyContent.trim())
      errs.privateKeyContent = t("sshKeys.validation.privateKeyRequired");
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (isNew) {
      addSshKey(form);
    } else if (id) {
      updateSshKey(id, form);
    }
    navigate("/ssh-keys");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {isNew ? t("sshKeys.newKey") : t("sshKeys.editKey")}
        </h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-4">
          {/* Generate Key — only when creating new */}
          {isNew && (
            <Section
              id="generate"
              title={t("sshKeys.sections.generate")}
              open={openSections.has("generate")}
              onToggle={toggleSection}
            >
              <div className="flex flex-col gap-4 mt-3">
                <p className="text-xs text-[var(--text-muted)]">
                  {t("sshKeys.generate.description")}
                </p>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("sshKeys.generate.keyType")}
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(["ed25519", "ecdsa", "rsa2048", "rsa4096"] as KeyType[]).map((kt) => (
                      <button
                        key={kt}
                        onClick={() => setGenKeyType(kt)}
                        className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                          genKeyType === kt
                            ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
                            : "border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--border-focus)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        {kt === "rsa2048" ? "RSA 2048" : kt === "rsa4096" ? "RSA 4096" : kt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-1">
                    {genKeyType === "ed25519" && t("sshKeys.generate.ed25519Hint")}
                    {genKeyType === "ecdsa" && t("sshKeys.generate.ecdsaHint")}
                    {(genKeyType === "rsa2048" || genKeyType === "rsa4096") && t("sshKeys.generate.rsaHint")}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("sshKeys.generate.comment")}
                    <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                      ({t("sshKeys.fields.optional")})
                    </span>
                  </label>
                  <input
                    type="text"
                    value={genComment}
                    onChange={(e) => setGenComment(e.target.value)}
                    placeholder={t("sshKeys.generate.commentPlaceholder")}
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)]"
                  />
                </div>

                {generateStatus === "error" && generateError && (
                  <div className="flex items-start gap-2 text-sm text-[var(--danger)]">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{generateError}</span>
                  </div>
                )}
                {generateStatus === "done" && (
                  <div className="flex items-center gap-2 text-sm text-[var(--success)]">
                    <CheckCircle2 size={15} />
                    {t("sshKeys.generate.success")}
                    {lastFingerprint && (
                      <span className="ml-2 font-mono text-xs text-[var(--text-muted)] truncate">
                        {lastFingerprint}
                      </span>
                    )}
                    {lastFingerprint && (
                      <button
                        onClick={() => handleCopyFingerprint(lastFingerprint)}
                        className="ml-auto shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                        title={t("sshKeys.generate.copyFingerprint")}
                      >
                        {fingerprintCopied ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                      </button>
                    )}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={handleGenerate}
                    disabled={generateStatus === "generating"}
                  >
                    {generateStatus === "generating" ? (
                      <><Loader2 size={14} className="animate-spin" />{t("sshKeys.generate.generating")}</>
                    ) : (
                      <><Wand2 size={14} />{t("sshKeys.generate.generate")}</>
                    )}
                  </Button>
                </div>
              </div>
            </Section>
          )}

          {/* General */}
          <Section
            id="general"
            title={t("sshKeys.sections.general")}
            open={openSections.has("general")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4 mt-3">
              <Input
                id="label"
                label={t("sshKeys.fields.label")}
                placeholder={t("sshKeys.fields.labelPlaceholder")}
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                error={errors.label}
              />
            </div>
          </Section>

          {/* Private Key */}
          <Section
            id="privateKey"
            title={t("sshKeys.sections.privateKey")}
            open={openSections.has("privateKey")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4 mt-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="privateKeyContent" className="text-sm font-medium text-[var(--text-primary)]">
                    {t("sshKeys.fields.privateKeyContent")}
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => importFile("privateKeyContent")}
                  >
                    <FolderOpen size={13} />
                    {t("sshKeys.fields.importFromFile")}
                  </Button>
                </div>
                <Textarea
                  id="privateKeyContent"
                  placeholder={t("sshKeys.fields.privateKeyPlaceholder")}
                  value={form.privateKeyContent}
                  onChange={(e) => set("privateKeyContent", e.target.value)}
                  error={errors.privateKeyContent}
                  rows={8}
                  className="font-mono text-xs"
                />
              </div>
              <Input
                id="passphrase"
                label={t("sshKeys.fields.passphrase")}
                type="password"
                placeholder="••••••••"
                value={form.passphrase ?? ""}
                onChange={(e) => set("passphrase", e.target.value || undefined)}
                hint={t("sshKeys.fields.passphraseHint")}
              />
            </div>
          </Section>

          {/* Public Key */}
          <Section
            id="publicKey"
            title={t("sshKeys.sections.publicKey")}
            open={openSections.has("publicKey")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4 mt-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <label htmlFor="publicKeyContent" className="text-sm font-medium text-[var(--text-primary)]">
                    {t("sshKeys.fields.publicKeyContent")}
                    <span className="ml-1 text-xs font-normal text-[var(--text-muted)]">
                      ({t("sshKeys.fields.optional")})
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => importFile("publicKeyContent")}
                  >
                    <FolderOpen size={13} />
                    {t("sshKeys.fields.importFromFile")}
                  </Button>
                </div>
                <Textarea
                  id="publicKeyContent"
                  placeholder={t("sshKeys.fields.publicKeyPlaceholder")}
                  value={form.publicKeyContent ?? ""}
                  onChange={(e) => set("publicKeyContent", e.target.value || undefined)}
                  rows={3}
                  className="font-mono text-xs"
                />
                <p className="text-xs text-[var(--text-muted)]">
                  {t("sshKeys.fields.publicKeyHint")}
                </p>
                {lastFingerprint && (
                  <div className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2">
                    <span className="text-xs text-[var(--text-muted)] shrink-0">Fingerprint:</span>
                    <span className="font-mono text-xs text-[var(--text-primary)] truncate flex-1">{lastFingerprint}</span>
                    <button
                      onClick={() => handleCopyFingerprint(lastFingerprint)}
                      className="shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
                      title={t("sshKeys.generate.copyFingerprint")}
                    >
                      {fingerprintCopied ? <Check size={13} className="text-[var(--success)]" /> : <Copy size={13} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </Section>

          {/* Deploy to Server (ssh-copy-id) — only when public key is set */}
          {!isNew && form.publicKeyContent?.trim() && (
            <Section
              id="deploy"
              title={t("sshKeys.sections.deploy")}
              open={openSections.has("deploy")}
              onToggle={toggleSection}
            >
              <div className="flex flex-col gap-4 mt-3">
                <p className="text-xs text-[var(--text-muted)]">
                  {t("sshKeys.deploy.description")}
                </p>

                {/* Quick-fill from host */}
                {hosts.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-[var(--text-primary)]">
                      {t("sshKeys.deploy.selectHost")}
                    </label>
                    <select
                      defaultValue=""
                      onChange={(e) => fillFromHost(e.target.value)}
                      className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
                    >
                      <option value="">{t("sshKeys.deploy.selectHostPlaceholder")}</option>
                      {hosts.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label} ({h.host}:{h.port})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <Input
                      id="deploy-host"
                      label={t("sshKeys.deploy.host")}
                      placeholder="192.168.1.10"
                      value={deployForm.host}
                      onChange={(e) => setDeploy("host", e.target.value)}
                    />
                  </div>
                  <Input
                    id="deploy-port"
                    label={t("sshKeys.deploy.port")}
                    placeholder="22"
                    value={deployForm.port}
                    onChange={(e) => setDeploy("port", e.target.value)}
                  />
                </div>

                <Input
                  id="deploy-username"
                  label={t("sshKeys.deploy.username")}
                  placeholder="ubuntu"
                  value={deployForm.username}
                  onChange={(e) => setDeploy("username", e.target.value)}
                />

                <Input
                  id="deploy-password"
                  label={t("sshKeys.deploy.password")}
                  type="password"
                  placeholder="••••••••"
                  value={deployForm.password}
                  onChange={(e) => setDeploy("password", e.target.value)}
                  hint={t("sshKeys.deploy.passwordHint")}
                />

                {/* Feedback */}
                {deployStatus === "success" && (
                  <div className="flex items-center gap-2 text-sm text-[var(--success)]">
                    <CheckCircle2 size={15} />
                    {t("sshKeys.deploy.success")}
                  </div>
                )}
                {deployStatus === "error" && deployError && (
                  <div className="flex items-start gap-2 text-sm text-[var(--danger)]">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{deployError}</span>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button
                    onClick={handleDeploy}
                    disabled={deployStatus === "deploying" || !deployForm.host || !deployForm.username || !deployForm.password}
                  >
                    {deployStatus === "deploying" ? (
                      <><Loader2 size={14} className="animate-spin" />{t("sshKeys.deploy.deploying")}</>
                    ) : (
                      <><Server size={14} />{t("sshKeys.deploy.deploy")}</>
                    )}
                  </Button>
                </div>
              </div>
            </Section>
          )}

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
