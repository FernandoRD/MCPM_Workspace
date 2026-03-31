import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ChevronRight, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useSshKeysStore } from "@/store/sshKeys";
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

export function SshKeyEditor() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new" || !id;

  const { addSshKey, updateSshKey, getSshKey } = useSshKeysStore();

  const [form, setForm] = useState<FormData>(DEFAULT_FORM);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [openSections, setOpenSections] = useState<Set<string>>(
    new Set(["general", "privateKey", "publicKey"])
  );

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
              </div>
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
