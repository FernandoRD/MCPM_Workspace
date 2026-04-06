import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, Info, KeyRound, Plus } from "lucide-react";
import { useCredentialsStore } from "@/store/credentials";
import { useSshKeysStore } from "@/store/sshKeys";
import { Credential } from "@/types";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { sanitizeCredentialInput } from "@/lib/inputSanitizers";
import { cn } from "@/lib/utils";

type FormData = Omit<Credential, "id" | "createdAt" | "updatedAt">;

const DEFAULT_FORM: FormData = {
  label: "",
  username: "",
  authMethod: "password",
};

interface ValidationErrors {
  label?: string;
  username?: string;
  password?: string;
  keyId?: string;
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

export function CredentialEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new" || !id;

  const { addCredential, updateCredential, getCredential } = useCredentialsStore();
  const { sshKeys } = useSshKeysStore();

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["general", "auth"])
  );

  useEffect(() => {
    if (!isNew && id) {
      const cred = getCredential(id);
      if (cred) {
        const { id: _id, createdAt: _c, updatedAt: _u, ...data } = cred;
        setForm(data);
      }
    }
  }, [id, isNew, getCredential]);

  const toggleSection = (s: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const sanitizedForm = sanitizeCredentialInput(form);
    const errs: ValidationErrors = {};
    if (!sanitizedForm.label) errs.label = t("credentials.validation.labelRequired");
    if (!sanitizedForm.username) errs.username = t("credentials.validation.usernameRequired");
    if (sanitizedForm.authMethod === "password" && !sanitizedForm.password?.trim()) {
      errs.password = t("credentials.validation.passwordRequired");
    }
    if (sanitizedForm.authMethod === "privateKey" && !sanitizedForm.keyId) {
      errs.keyId = t("credentials.validation.keyRequired");
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const sanitizedForm = sanitizeCredentialInput(form);
    if (isNew) {
      addCredential(sanitizedForm);
    } else if (id) {
      updateCredential(id, sanitizedForm);
    }
    navigate("/credentials");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-4">
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {isNew ? t("credentials.newCredential") : t("credentials.editCredential")}
        </h1>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-4">
          {/* General Section */}
          <Section
            id="general"
            title={t("credentials.fields.label")}
            open={openSections.has("general")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4 mt-3">
              <Input
                id="label"
                label={t("credentials.fields.label")}
                placeholder={t("credentials.fields.labelPlaceholder")}
                value={form.label}
                onChange={(e) => set("label", e.target.value)}
                error={errors.label}
              />
              <Input
                id="username"
                label={t("credentials.fields.username")}
                placeholder={t("credentials.fields.usernamePlaceholder")}
                value={form.username}
                onChange={(e) => set("username", e.target.value)}
                error={errors.username}
              />
            </div>
          </Section>

          {/* Auth Section */}
          <Section
            id="auth"
            title={t("credentials.fields.authMethod")}
            open={openSections.has("auth")}
            onToggle={toggleSection}
          >
            <div className="flex flex-col gap-4 mt-3">
              <Select
                id="authMethod"
                label={t("credentials.fields.authMethod")}
                value={form.authMethod}
                onChange={(e) => {
                  set("authMethod", e.target.value as Credential["authMethod"]);
                  set("keyId", undefined);
                  set("password", undefined);
                }}
              >
                <option value="password">{t("credentials.authMethods.password")}</option>
                <option value="privateKey">{t("credentials.authMethods.privateKey")}</option>
                <option value="agent">{t("credentials.authMethods.agent")}</option>
              </Select>

              {form.authMethod === "password" && (
                <Input
                  id="password"
                  label={t("credentials.fields.password")}
                  type="password"
                  placeholder="••••••••"
                  value={form.password ?? ""}
                  onChange={(e) => set("password", e.target.value || undefined)}
                  error={errors.password}
                />
              )}

              {form.authMethod === "privateKey" && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("credentials.fields.selectKey")}
                  </label>
                  {sshKeys.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 py-6 text-center rounded-lg border border-dashed border-[var(--border)]">
                      <p className="text-sm text-[var(--text-muted)]">
                        {t("credentials.fields.noKeys")}
                      </p>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate("/ssh-keys/new")}
                      >
                        <Plus size={13} />
                        {t("credentials.fields.createKey")}
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {sshKeys.map((key) => (
                        <button
                          key={key.id}
                          type="button"
                          onClick={() => set("keyId", form.keyId === key.id ? undefined : key.id)}
                          className={cn(
                            "flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                            form.keyId === key.id
                              ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                              : "border-[var(--border)] bg-[var(--bg-primary)] hover:border-[var(--border-focus)] hover:bg-[var(--bg-hover)]"
                          )}
                        >
                          <div
                            className={cn(
                              "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md",
                              form.keyId === key.id
                                ? "bg-[var(--accent)] text-white"
                                : "bg-[var(--bg-secondary)] text-[var(--accent)]"
                            )}
                          >
                            <KeyRound size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                              {key.label}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              {key.publicKeyContent
                                ? t("credentials.fields.keyHasPublic")
                                : t("credentials.fields.keyNoPublic")}
                              {key.passphrase && ` · ${t("credentials.fields.keyHasPassphrase")}`}
                            </p>
                          </div>
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() => navigate("/ssh-keys")}
                        className="self-start text-xs text-[var(--accent)] hover:underline mt-1"
                      >
                        {t("credentials.fields.manageKeys")}
                      </button>
                    </div>
                  )}
                  {errors.keyId && (
                    <p className="text-xs text-[var(--danger)]">{errors.keyId}</p>
                  )}
                </div>
              )}

              {form.authMethod === "agent" && (
                <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
                  <Info size={16} className="text-[var(--accent)] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-[var(--text-secondary)]">
                    {t("credentials.fields.agentInfo")}
                  </p>
                </div>
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
