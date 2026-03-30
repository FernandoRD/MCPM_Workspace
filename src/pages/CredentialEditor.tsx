import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, Info } from "lucide-react";
import { useCredentialsStore } from "@/store/credentials";
import { Credential } from "@/types";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

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
  privateKeyPath?: string;
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
    const errs: ValidationErrors = {};
    if (!form.label.trim()) errs.label = t("credentials.validation.labelRequired");
    if (!form.username.trim()) errs.username = t("credentials.validation.usernameRequired");
    if (form.authMethod === "password" && !form.password?.trim()) {
      errs.password = t("credentials.validation.passwordRequired");
    }
    if (form.authMethod === "privateKey" && !form.privateKeyPath?.trim()) {
      errs.privateKeyPath = t("credentials.validation.privateKeyPathRequired");
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    if (isNew) {
      addCredential(form);
    } else if (id) {
      updateCredential(id, form);
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
                onChange={(e) =>
                  set("authMethod", e.target.value as Credential["authMethod"])
                }
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
                <>
                  <Input
                    id="privateKeyPath"
                    label={t("credentials.fields.privateKeyPath")}
                    placeholder={t("credentials.fields.privateKeyPathPlaceholder")}
                    value={form.privateKeyPath ?? ""}
                    onChange={(e) => set("privateKeyPath", e.target.value || undefined)}
                    error={errors.privateKeyPath}
                  />
                  <Input
                    id="passphrase"
                    label={t("credentials.fields.passphrase")}
                    type="password"
                    placeholder="••••••••"
                    value={form.passphrase ?? ""}
                    onChange={(e) => set("passphrase", e.target.value || undefined)}
                  />
                </>
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
