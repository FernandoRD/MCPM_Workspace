import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { KeyRound, Pencil, Trash2, Plus, ShieldCheck, Copy, Check, Wand2 } from "lucide-react";
import { useSshKeysStore } from "@/store/sshKeys";
import { useCredentialsStore } from "@/store/credentials";
import { SshKey } from "@/types";
import { Button } from "@/components/ui/Button";

export function SshKeys() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { sshKeys, deleteSshKey } = useSshKeysStore();
  const credentials = useCredentialsStore((s) => s.credentials);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const keyTypeLabel = (pub?: string): string | null => {
    if (!pub) return null;
    if (pub.startsWith("ssh-ed25519")) return "Ed25519";
    if (pub.startsWith("ecdsa-sha2-nistp256")) return "ECDSA P-256";
    if (pub.startsWith("ecdsa-sha2-nistp384")) return "ECDSA P-384";
    if (pub.startsWith("ssh-rsa")) return "RSA";
    return null;
  };

  const handleCopyPublicKey = (key: SshKey) => {
    navigator.clipboard.writeText(key.publicKeyContent!);
    setCopiedId(key.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = (key: SshKey) => {
    const usedBy = credentials.filter((c) => c.keyId === key.id);
    if (usedBy.length > 0) {
      const confirmed = window.confirm(
        t("sshKeys.deleteInUseWarning", { count: usedBy.length })
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(t("common.confirmDelete", { name: key.label }));
      if (!confirmed) return;
    }
    deleteSshKey(key.id);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("sshKeys.title")}
        </h1>
        <Button onClick={() => navigate("/ssh-keys/new")}>
          <Plus size={14} />
          {t("sshKeys.newKey")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {sshKeys.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-secondary)] border border-[var(--border)]">
                <KeyRound size={24} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-medium">
                  {t("sshKeys.noKeys")}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {t("sshKeys.noKeysDescription")}
                </p>
              </div>
              <Button onClick={() => navigate("/ssh-keys/new")}>
                <Plus size={14} />
                {t("sshKeys.newKey")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {sshKeys.map((key) => {
                const usedByCount = credentials.filter((c) => c.keyId === key.id).length;
                return (
                  <div
                    key={key.id}
                    className="group rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-4 hover:border-[var(--border-focus)] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent-subtle)]">
                        <KeyRound size={18} className="text-[var(--accent)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-semibold text-[var(--text-primary)] truncate">
                            {key.label}
                          </span>
                          {keyTypeLabel(key.publicKeyContent) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent)]/20">
                              <Wand2 size={11} />
                              {keyTypeLabel(key.publicKeyContent)}
                            </span>
                          )}
                          {key.publicKeyContent && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-green-500/10 text-green-400 border-green-500/20">
                              <ShieldCheck size={11} />
                              {t("sshKeys.hasPublicKey")}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-[var(--text-muted)]">
                            {new Date(key.createdAt).toLocaleDateString()}
                          </span>
                          <span className="text-xs text-[var(--text-muted)]">
                            {usedByCount > 0
                              ? t("sshKeys.inUseBy", { count: usedByCount })
                              : t("sshKeys.notInUse")}
                          </span>
                        </div>
                      </div>
                      <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                        {key.publicKeyContent && (
                          <button
                            onClick={() => handleCopyPublicKey(key)}
                            className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--accent)] transition-colors"
                            title={t("sshKeys.copyPublicKey")}
                          >
                            {copiedId === key.id ? <Check size={14} className="text-[var(--success)]" /> : <Copy size={14} />}
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/ssh-keys/${key.id}`)}
                          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                          title={t("common.edit")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(key)}
                          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--danger)] transition-colors"
                          title={t("common.delete")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
