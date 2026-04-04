import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ShieldCheck, ShieldOff, Eye, EyeOff, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

const TERMINAL_FONTS: { id: string; label: string }[] = [
  { id: "JetBrains Mono",  label: "JetBrains Mono"  },
  { id: "Fira Code",       label: "Fira Code"        },
  { id: "Source Code Pro", label: "Source Code Pro"  },
  { id: "Ubuntu Mono",     label: "Ubuntu Mono"      },
  { id: "Inconsolata",     label: "Inconsolata"      },
  { id: "Cascadia Code",   label: "Cascadia Code"    },
  { id: "Hack",            label: "Hack"             },
  { id: "Courier New",     label: "Courier New"      },
  { id: "monospace",       label: "System Default"   },
];
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/store/settings";
import { THEMES, ThemeId } from "@/themes";
import { LOCALES } from "@/lib/i18n";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { AppSettings } from "@/types";

export function Settings() {
  const { t } = useTranslation();
  const { settings, setTheme, setLocale, updateTerminal, updateSecurity, updateSsh, resetSettings } =
    useSettingsStore();
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("settings.title")}
        </h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={resetSettings}>
            {t("settings.actions.reset")}
          </Button>
          <Button size="sm" onClick={handleSave}>
            {saved ? (
              <>
                <Check size={14} />
                {t("settings.actions.saved")}
              </>
            ) : (
              t("settings.actions.save")
            )}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-6 py-6 flex flex-col gap-8">
          {/* Appearance */}
          <Section title={t("settings.sections.appearance")}>
            <div className="flex flex-col gap-3">
              <p className="text-sm text-[var(--text-secondary)]">
                {t("settings.appearance.themeDescription")}
              </p>
              <div className="grid grid-cols-3 gap-3">
                {THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id as ThemeId)}
                    className={cn(
                      "relative flex flex-col items-center gap-2 rounded-xl border-2 p-3 transition-all",
                      settings.themeId === theme.id
                        ? "border-[var(--accent)]"
                        : "border-[var(--border)] hover:border-[var(--text-muted)]"
                    )}
                  >
                    <div
                      className="w-full h-10 rounded-md flex items-center gap-1.5 px-2"
                      style={{ backgroundColor: theme.preview.bg }}
                    >
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.preview.accent }} />
                      <div className="flex-1 h-1.5 rounded-full opacity-60" style={{ backgroundColor: theme.preview.text }} />
                    </div>
                    <span className="text-xs font-medium text-[var(--text-primary)]">
                      {theme.name}
                    </span>
                    {settings.themeId === theme.id && (
                      <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-[var(--accent)] flex items-center justify-center">
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          {/* Language */}
          <Section title={t("settings.sections.language")}>
            <div className="max-w-xs">
              <Select
                id="locale"
                label={t("settings.language.label")}
                value={settings.locale}
                onChange={(e) => setLocale(e.target.value)}
              >
                {LOCALES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.flag} {l.label}
                  </option>
                ))}
              </Select>
            </div>
          </Section>

          {/* Terminal */}
          <Section title={t("settings.sections.terminal")}>
            <div className="flex flex-col gap-5">

              {/* Fonte */}
              <div>
                <label className="text-sm font-medium text-[var(--text-primary)] block mb-2">
                  {t("settings.terminal.fontFamily")}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {TERMINAL_FONTS.map((font) => {
                    const selected = settings.terminal.fontFamily === font.id;
                    return (
                      <button
                        key={font.id}
                        onClick={() => updateTerminal({ fontFamily: font.id })}
                        className={cn(
                          "relative flex flex-col items-start gap-1 rounded-lg border-2 px-3 py-2.5 text-left transition-all",
                          selected
                            ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                            : "border-[var(--border)] bg-[var(--bg-secondary)] hover:border-[var(--text-muted)]"
                        )}
                      >
                        {selected && (
                          <Check size={10} className="absolute top-1.5 right-1.5 text-[var(--accent)]" />
                        )}
                        <span
                          className="text-xl leading-none text-[var(--text-primary)]"
                          style={{ fontFamily: `"${font.id}", monospace` }}
                        >
                          Aa
                        </span>
                        <span className="text-xs text-[var(--text-muted)] truncate w-full">
                          {font.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                    {t("settings.terminal.fontSize")}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min={10}
                      max={24}
                      value={settings.terminal.fontSize}
                      onChange={(e) => updateTerminal({ fontSize: parseInt(e.target.value) })}
                      className="flex-1 accent-[var(--accent)]"
                    />
                    <span className="text-sm font-mono text-[var(--text-secondary)] w-8">
                      {settings.terminal.fontSize}
                    </span>
                  </div>
                </div>

                <Select
                  id="cursorStyle"
                  label={t("settings.terminal.cursorStyle")}
                  value={settings.terminal.cursorStyle}
                  onChange={(e) =>
                    updateTerminal({ cursorStyle: e.target.value as "block" | "underline" | "bar" })
                  }
                >
                  <option value="block">{t("settings.terminal.cursorStyles.block")}</option>
                  <option value="underline">{t("settings.terminal.cursorStyles.underline")}</option>
                  <option value="bar">{t("settings.terminal.cursorStyles.bar")}</option>
                </Select>

                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.terminal.cursorBlink}
                      onChange={(e) => updateTerminal({ cursorBlink: e.target.checked })}
                      className="accent-[var(--accent)] w-4 h-4"
                    />
                    <span className="text-sm text-[var(--text-primary)]">
                      {t("settings.terminal.cursorBlink")}
                    </span>
                  </label>
                </div>

                <div>
                  <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
                    {t("settings.terminal.scrollback")}
                  </label>
                  <input
                    type="number"
                    min={500}
                    max={50000}
                    step={500}
                    value={settings.terminal.scrollback}
                    onChange={(e) =>
                      updateTerminal({ scrollback: parseInt(e.target.value) || 5000 })
                    }
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
                  />
                </div>

                <div className="col-span-2">
                  <Select
                    id="sessionOpenMode"
                    label={t("settings.terminal.sessionOpenMode")}
                    value={settings.terminal.sessionOpenMode}
                    onChange={(e) =>
                      updateTerminal({
                        sessionOpenMode: e.target.value as "tab" | "window",
                      })
                    }
                  >
                    <option value="tab">{t("settings.terminal.sessionOpenModes.tab")}</option>
                    <option value="window">{t("settings.terminal.sessionOpenModes.window")}</option>
                  </Select>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {t("settings.terminal.sessionOpenModeHint")}
                  </p>
                </div>
              </div>
            </div>
          </Section>

          {/* SSH */}
          <Section title={t("settings.sections.ssh")}>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--text-secondary)]">
                {t("settings.ssh.description")}
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("settings.ssh.keepAliveInterval")}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={settings.ssh?.keepAliveInterval ?? 60}
                    onChange={(e) => updateSsh({ keepAliveInterval: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("settings.ssh.keepAliveHint")}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium text-[var(--text-primary)]">
                    {t("settings.ssh.inactivityTimeout")}
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={settings.ssh?.inactivityTimeout ?? 0}
                    onChange={(e) => updateSsh({ inactivityTimeout: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-focus)]"
                  />
                  <p className="text-xs text-[var(--text-muted)]">
                    {t("settings.ssh.inactivityTimeoutHint")}
                  </p>
                </div>
              </div>
            </div>
          </Section>

          {/* Security */}
          <Section title={t("settings.sections.security")}>
            <MasterPasswordSection
              isSet={settings.security?.masterPasswordSet ?? false}
              verificationPayload={settings.security?.verificationPayload}
              syncCredentials={settings.security?.syncCredentials ?? false}
              onUpdate={updateSecurity}
            />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ─── Seção de Senha Mestra ────────────────────────────────────────────────────

interface MasterPasswordSectionProps {
  isSet: boolean;
  verificationPayload?: string;
  syncCredentials: boolean;
  onUpdate: (s: Partial<AppSettings["security"]>) => void;
}

function MasterPasswordSection({ isSet, verificationPayload, syncCredentials, onUpdate }: MasterPasswordSectionProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"idle" | "define" | "change" | "remove">("idle");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setMode("idle");
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
  };

  const handleDefine = async () => {
    if (next.length < 8) { setError(t("settings.security.masterPasswordTooShort")); return; }
    if (next !== confirm) { setError(t("settings.security.masterPasswordMismatch")); return; }
    setLoading(true);
    try {
      // Cifra uma sentinela para verificação futura
      const sentinel = JSON.stringify({ sentinel: true, ts: Date.now() });
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: sentinel,
        masterPassword: next,
      });
      onUpdate({ masterPasswordSet: true, verificationPayload: payloadJson });
      reset();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = async () => {
    if (!verificationPayload) return;
    if (next.length < 8) { setError(t("settings.security.masterPasswordTooShort")); return; }
    if (next !== confirm) { setError(t("settings.security.masterPasswordMismatch")); return; }
    setLoading(true);
    try {
      const ok = await invoke<boolean>("verify_master_password", {
        encryptedPayloadJson: verificationPayload,
        masterPassword: current,
      });
      if (!ok) { setError(t("settings.security.masterPasswordWrong")); setLoading(false); return; }
      const sentinel = JSON.stringify({ sentinel: true, ts: Date.now() });
      const payloadJson = await invoke<string>("encrypt_credentials", {
        credentialsJson: sentinel,
        masterPassword: next,
      });
      onUpdate({ masterPasswordSet: true, verificationPayload: payloadJson });
      reset();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRemove = async () => {
    if (!verificationPayload) return;
    setLoading(true);
    try {
      const ok = await invoke<boolean>("verify_master_password", {
        encryptedPayloadJson: verificationPayload,
        masterPassword: current,
      });
      if (!ok) { setError(t("settings.security.masterPasswordWrong")); setLoading(false); return; }
      onUpdate({ masterPasswordSet: false, verificationPayload: undefined, syncCredentials: false });
      reset();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Status badge */}
      <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4">
        {isSet ? (
          <ShieldCheck size={20} className="text-[var(--success)] shrink-0" />
        ) : (
          <ShieldOff size={20} className="text-[var(--text-muted)] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {isSet ? t("settings.security.masterPasswordSet") : t("settings.security.masterPasswordNotSet")}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t("settings.security.masterPasswordDescription")}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isSet ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => { reset(); setMode("change"); }}>
                {t("settings.security.masterPasswordChange")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { reset(); setMode("remove"); }}>
                {t("settings.security.masterPasswordRemove")}
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => { reset(); setMode("define"); }}>
              {t("settings.security.masterPasswordDefine")}
            </Button>
          )}
        </div>
      </div>

      {/* Formulário inline */}
      {mode !== "idle" && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-5 flex flex-col gap-4">
          {(mode === "change" || mode === "remove") && (
            <PasswordField
              id="current-password"
              label={t("settings.security.masterPasswordCurrent")}
              value={current}
              show={showCurrent}
              onToggleShow={() => setShowCurrent((v) => !v)}
              onChange={setCurrent}
            />
          )}
          {(mode === "define" || mode === "change") && (
            <>
              <PasswordField
                id="new-password"
                label={mode === "define" ? t("settings.security.masterPassword") : t("settings.security.masterPasswordNew")}
                placeholder={t("settings.security.masterPasswordPlaceholder")}
                value={next}
                show={showNext}
                onToggleShow={() => setShowNext((v) => !v)}
                onChange={setNext}
              />
              <Input
                id="confirm-password"
                label={t("settings.security.masterPasswordConfirm")}
                placeholder={t("settings.security.masterPasswordConfirmPlaceholder")}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                error={confirm && confirm !== next ? t("settings.security.masterPasswordMismatch") : undefined}
              />
            </>
          )}
          {error && (
            <p className="text-sm text-[var(--danger)] flex items-center gap-1.5">
              <AlertTriangle size={14} />
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("common.cancel")}
            </Button>
            <Button
              size="sm"
              variant={mode === "remove" ? "danger" : "primary"}
              disabled={loading}
              onClick={mode === "define" ? handleDefine : mode === "change" ? handleChange : handleRemove}
            >
              {mode === "remove" ? t("settings.security.masterPasswordRemove") : t("common.save")}
            </Button>
          </div>
        </div>
      )}

      {/* Opção de sync de credenciais */}
      {isSet && (
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3 cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4 hover:bg-[var(--bg-hover)] transition-colors">
            <input
              type="checkbox"
              checked={syncCredentials}
              onChange={(e) => onUpdate({ syncCredentials: e.target.checked })}
              className="accent-[var(--accent)] w-4 h-4 mt-0.5 shrink-0"
            />
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                {t("settings.security.syncCredentials")}
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                {t("settings.security.syncCredentialsDescription")}
              </p>
            </div>
          </label>
          <div className="flex items-start gap-2 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30 px-3 py-2.5">
            <AlertTriangle size={14} className="text-[var(--warning)] shrink-0 mt-0.5" />
            <p className="text-xs text-[var(--warning)]">
              {t("settings.security.warning")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PasswordField({
  id, label, placeholder, value, show, onToggleShow, onChange,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  show: boolean;
  onToggleShow: () => void;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-[var(--text-primary)]">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          placeholder={placeholder ?? "••••••••"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)] pl-3 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          {show ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-semibold text-[var(--text-primary)] mb-4 pb-2 border-b border-[var(--border)]">
        {title}
      </h2>
      {children}
    </div>
  );
}
