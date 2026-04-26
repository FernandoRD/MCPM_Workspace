import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Info, KeyRound, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
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
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)]">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex w-full items-center justify-between px-5 py-3.5 text-sm font-semibold text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
      >
        {title}
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && <div className="border-t border-[var(--border)] px-5 pb-5 pt-1">{children}</div>}
    </div>
  );
}

export function CredentialForm({
  credentialId,
  onCancel,
  onSaved,
  initialAuthMethod = "password",
  allowKeyNavigation = true,
}: {
  credentialId?: string;
  onCancel: () => void;
  onSaved: (credentialId: string, credential: Credential) => void;
  initialAuthMethod?: Credential["authMethod"];
  allowKeyNavigation?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addCredential, updateCredential, getCredential } = useCredentialsStore();
  const { sshKeys } = useSshKeysStore();
  const isNew = !credentialId;

  const [form, setForm] = useState<FormData>({ ...DEFAULT_FORM, authMethod: initialAuthMethod });
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["general", "auth"]));

  useEffect(() => {
    if (!credentialId) {
      setForm({ ...DEFAULT_FORM, authMethod: initialAuthMethod });
      setErrors({});
      return;
    }

    const credential = getCredential(credentialId);
    if (credential) {
      const { id: _id, createdAt: _c, updatedAt: _u, ...data } = credential;
      setForm(data);
      setErrors({});
    }
  }, [credentialId, getCredential, initialAuthMethod]);

  const toggleSection = (section: string) =>
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(section) ? next.delete(section) : next.add(section);
      return next;
    });

  const set = <K extends keyof FormData>(key: K, value: FormData[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const validate = (): boolean => {
    const sanitizedForm = sanitizeCredentialInput(form);
    const nextErrors: ValidationErrors = {};
    if (!sanitizedForm.label) nextErrors.label = t("credentials.validation.labelRequired");
    if (!sanitizedForm.username) nextErrors.username = t("credentials.validation.usernameRequired");
    if (sanitizedForm.authMethod === "password" && !sanitizedForm.password?.trim()) {
      nextErrors.password = t("credentials.validation.passwordRequired");
    }
    if (sanitizedForm.authMethod === "privateKey" && !sanitizedForm.keyId) {
      nextErrors.keyId = t("credentials.validation.keyRequired");
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const sanitizedForm = sanitizeCredentialInput(form);

    if (isNew) {
      const newCredentialId = addCredential(sanitizedForm);
      const credential = getCredential(newCredentialId);
      if (credential) onSaved(newCredentialId, credential);
      return;
    }

    updateCredential(credentialId, sanitizedForm);
    const current = getCredential(credentialId);
    const credential = current
      ? sanitizeCredentialInput<Credential>({ ...current, ...sanitizedForm, updatedAt: new Date().toISOString() })
      : undefined;
    if (credential) onSaved(credentialId, credential);
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        id="general"
        title={t("credentials.fields.label")}
        open={openSections.has("general")}
        onToggle={toggleSection}
      >
        <div className="mt-3 flex flex-col gap-4">
          <Input
            id="credential-label"
            label={t("credentials.fields.label")}
            placeholder={t("credentials.fields.labelPlaceholder")}
            value={form.label}
            onChange={(event) => set("label", event.target.value)}
            error={errors.label}
          />
          <Input
            id="credential-username"
            label={t("credentials.fields.username")}
            placeholder={t("credentials.fields.usernamePlaceholder")}
            value={form.username}
            onChange={(event) => set("username", event.target.value)}
            error={errors.username}
          />
        </div>
      </Section>

      <Section
        id="auth"
        title={t("credentials.fields.authMethod")}
        open={openSections.has("auth")}
        onToggle={toggleSection}
      >
        <div className="mt-3 flex flex-col gap-4">
          <Select
            id="credential-auth-method"
            label={t("credentials.fields.authMethod")}
            value={form.authMethod}
            onChange={(event) => {
              set("authMethod", event.target.value as Credential["authMethod"]);
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
              id="credential-password"
              label={t("credentials.fields.password")}
              type="password"
              placeholder="••••••••"
              value={form.password ?? ""}
              onChange={(event) => set("password", event.target.value || undefined)}
              error={errors.password}
            />
          )}

          {form.authMethod === "privateKey" && (
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-[var(--text-primary)]">
                {t("credentials.fields.selectKey")}
              </label>
              {sshKeys.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-[var(--border)] py-6 text-center">
                  <p className="text-sm text-[var(--text-muted)]">{t("credentials.fields.noKeys")}</p>
                  {allowKeyNavigation && (
                    <Button variant="secondary" size="sm" onClick={() => navigate("/ssh-keys/new")}>
                      <Plus size={13} />
                      {t("credentials.fields.createKey")}
                    </Button>
                  )}
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
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--text-primary)]">{key.label}</p>
                        <p className="text-xs text-[var(--text-muted)]">
                          {key.publicKeyContent
                            ? t("credentials.fields.keyHasPublic")
                            : t("credentials.fields.keyNoPublic")}
                          {key.passphrase && ` · ${t("credentials.fields.keyHasPassphrase")}`}
                        </p>
                      </div>
                    </button>
                  ))}
                  {allowKeyNavigation && (
                    <button
                      type="button"
                      onClick={() => navigate("/ssh-keys")}
                      className="mt-1 self-start text-xs text-[var(--accent)] hover:underline"
                    >
                      {t("credentials.fields.manageKeys")}
                    </button>
                  )}
                </div>
              )}
              {errors.keyId && <p className="text-xs text-[var(--danger)]">{errors.keyId}</p>}
            </div>
          )}

          {form.authMethod === "agent" && (
            <div className="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
              <Info size={16} className="mt-0.5 flex-shrink-0 text-[var(--accent)]" />
              <p className="text-sm text-[var(--text-secondary)]">{t("credentials.fields.agentInfo")}</p>
            </div>
          )}
        </div>
      </Section>

      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("hostEditor.actions.cancel")}
        </Button>
        <Button onClick={handleSave}>
          {t("hostEditor.actions.save")}
        </Button>
      </div>
    </div>
  );
}
