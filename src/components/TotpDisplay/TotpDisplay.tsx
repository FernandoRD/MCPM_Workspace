import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";

interface TotpCode {
  code: string;
  remaining_seconds: number;
  valid_from: number;
}

interface TotpDisplayProps {
  secretBase32: string;
}

const STEP = 30;

export function TotpDisplay({ secretBase32 }: TotpDisplayProps) {
  const { t } = useTranslation();
  const [totpCode, setTotpCode] = useState<TotpCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const fetchCode = useCallback(async () => {
    if (!secretBase32.trim()) return;
    try {
      const result = await invoke<TotpCode>("generate_totp_code", {
        secretBase32: secretBase32.trim().toUpperCase(),
      });
      setTotpCode(result);
      setError(false);
    } catch {
      setError(true);
    }
  }, [secretBase32]);

  useEffect(() => {
    if (!secretBase32.trim()) return;
    fetchCode();
    const interval = setInterval(fetchCode, 1000);
    return () => clearInterval(interval);
  }, [fetchCode, secretBase32]);

  const handleCopy = () => {
    if (!totpCode) return;
    navigator.clipboard.writeText(totpCode.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <p className="text-xs text-[var(--danger)]">{t("hostEditor.mfa.invalidSecret")}</p>
    );
  }

  if (!totpCode) return null;

  const progress = totpCode.remaining_seconds / STEP;
  const isWarning = totpCode.remaining_seconds <= 5;
  // SVG circle circumference for r=15.9: 2π×15.9 ≈ 99.9
  const circumference = 99.9;
  const strokeDash = progress * circumference;

  return (
    <div className="flex items-center gap-4 rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] px-4 py-3">
      {/* Countdown ring */}
      <div className="relative h-11 w-11 flex-shrink-0">
        <svg className="h-11 w-11 -rotate-90" viewBox="0 0 36 36">
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke="var(--border)"
            strokeWidth="2.8"
          />
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke={isWarning ? "var(--danger)" : "var(--accent)"}
            strokeWidth="2.8"
            strokeDasharray={`${strokeDash} ${circumference}`}
            strokeLinecap="round"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold text-[var(--text-muted)]">
          {totpCode.remaining_seconds}s
        </span>
      </div>

      {/* Code */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] text-[var(--text-muted)] font-medium uppercase tracking-wider">
          {t("hostEditor.mfa.liveCode")}
        </span>
        <span
          className={`font-mono text-2xl font-bold tracking-[0.25em] ${
            isWarning ? "text-[var(--danger)]" : "text-[var(--text-primary)]"
          }`}
        >
          {totpCode.code.slice(0, 3)}&thinsp;{totpCode.code.slice(3)}
        </span>
      </div>

      {/* Copy button */}
      <button
        onClick={handleCopy}
        title={copied ? t("hostEditor.mfa.codeCopied") : t("hostEditor.mfa.copyCode")}
        className="ml-auto h-8 w-8 flex items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
      >
        {copied ? (
          <Check size={14} className="text-[var(--success,#2ea043)]" />
        ) : (
          <Copy size={14} />
        )}
      </button>
    </div>
  );
}
