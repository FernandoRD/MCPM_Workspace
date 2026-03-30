import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Lock, KeyRound, Cpu, Pencil, Trash2, Plus } from "lucide-react";
import { useCredentialsStore } from "@/store/credentials";
import { useHostsStore } from "@/store/hosts";
import { Credential } from "@/types";
import { Button } from "@/components/ui/Button";

function AuthMethodIcon({ method }: { method: Credential["authMethod"] }) {
  if (method === "password") return <Lock size={18} className="text-[var(--accent)]" />;
  if (method === "privateKey") return <KeyRound size={18} className="text-[var(--accent)]" />;
  return <Cpu size={18} className="text-[var(--accent)]" />;
}

function TypeBadge({ method }: { method: Credential["authMethod"] }) {
  const { t } = useTranslation();
  const label = t(`credentials.types.${method}`);
  const colors: Record<string, string> = {
    password: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    privateKey: "bg-purple-500/10 text-purple-400 border-purple-500/20",
    agent: "bg-green-500/10 text-green-400 border-green-500/20",
  };
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colors[method] ?? ""}`}
    >
      {label}
    </span>
  );
}

export function Credentials() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { credentials, deleteCredential } = useCredentialsStore();
  const hosts = useHostsStore((s) => s.hosts);

  const handleDelete = (cred: Credential) => {
    const usedBy = hosts.filter((h) => h.credentialId === cred.id);
    if (usedBy.length > 0) {
      const confirmed = window.confirm(
        t("credentials.deleteInUseWarning", { count: usedBy.length })
      );
      if (!confirmed) return;
    } else {
      const confirmed = window.confirm(
        t("common.confirmDelete", { name: cred.label })
      );
      if (!confirmed) return;
    }
    deleteCredential(cred.id);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-6 py-4">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("credentials.title")}
        </h1>
        <Button onClick={() => navigate("/credentials/new")}>
          <Plus size={14} />
          {t("credentials.newCredential")}
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-3xl mx-auto px-6 py-6">
          {credentials.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--bg-secondary)] border border-[var(--border)]">
                <KeyRound size={24} className="text-[var(--text-muted)]" />
              </div>
              <div>
                <p className="text-[var(--text-primary)] font-medium">
                  {t("credentials.noCredentials")}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {t("credentials.noCredentialsDescription")}
                </p>
              </div>
              <Button onClick={() => navigate("/credentials/new")}>
                <Plus size={14} />
                {t("credentials.newCredential")}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {credentials.map((cred) => {
                const usedByCount = hosts.filter((h) => h.credentialId === cred.id).length;
                return (
                  <div
                    key={cred.id}
                    className="group rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-5 py-4 hover:border-[var(--border-focus)] transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--accent-subtle)]">
                        <AuthMethodIcon method={cred.authMethod} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-base font-semibold text-[var(--text-primary)] truncate">
                            {cred.label}
                          </span>
                          <TypeBadge method={cred.authMethod} />
                        </div>
                        {cred.username && (
                          <p className="text-xs font-mono text-[var(--text-secondary)] mt-0.5">
                            {cred.username}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-[var(--text-muted)]">
                            {new Date(cred.createdAt).toLocaleDateString()}
                          </span>
                          <span className="text-xs text-[var(--text-muted)]">
                            {usedByCount > 0
                              ? t("credentials.inUseBy", { count: usedByCount })
                              : t("credentials.notInUse")}
                          </span>
                        </div>
                      </div>
                      <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => navigate(`/credentials/${cred.id}`)}
                          className="flex h-7 w-7 items-center justify-center rounded text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
                          title={t("common.edit")}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(cred)}
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
