import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { useUpdateStore, type UpdateInfo } from "@/store/updateStore";
import { logFrontendError } from "@/lib/logger";

/**
 * Aviso discreto de nova versão. Consulta o GitHub uma vez na montagem
 * (no boot do app) e, se houver release mais nova, mostra um cartão pequeno
 * no canto inferior direito. Falhas de rede são silenciosas.
 */
export function UpdateBanner() {
  const { t } = useTranslation();
  const info = useUpdateStore((s) => s.info);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const setInfo = useUpdateStore((s) => s.setInfo);
  const dismiss = useUpdateStore((s) => s.dismiss);

  useEffect(() => {
    invoke<UpdateInfo>("check_for_updates")
      .then((result) => {
        if (result.updateAvailable) setInfo(result);
      })
      .catch((error) => {
        logFrontendError("updates.check", "Falha ao checar atualizações", error);
      });
  }, [setInfo]);

  if (!info || !info.updateAvailable || dismissed) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-xs items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 shadow-lg"
      role="status"
    >
      <span
        className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]"
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {t("updates.available", { version: info.latestVersion })}
        </p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">
          {t("updates.current", { version: info.currentVersion })}
        </p>
        <button
          type="button"
          onClick={() => {
            void openUrl(info.releaseUrl).catch((error) => {
              logFrontendError("updates.openUrl", "Falha ao abrir release", error, {
                url: info.releaseUrl,
              });
            });
          }}
          className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
        >
          {t("updates.viewRelease")}
        </button>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label={t("updates.dismiss")}
        className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        ✕
      </button>
    </div>
  );
}
