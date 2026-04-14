import { useTranslation } from "react-i18next";
import { APP_CLASSIFICATION, APP_NAME, APP_VERSION } from "@/lib/appInfo";
import { Badge } from "@/components/ui/Badge";

export function About() {
  const { t } = useTranslation();

  const highlights = [
    t("about.highlights.quickConnect"),
    t("about.highlights.sessions"),
    t("about.highlights.health"),
    t("about.highlights.sync"),
  ];

  const protocols = [
    t("about.protocols.ssh"),
    t("about.protocols.sftp"),
    t("about.protocols.telnet"),
    t("about.protocols.rdp"),
    t("about.protocols.vnc"),
    t("about.protocols.future"),
  ];

  const protocolStatus = [
    { key: "ssh", variant: "accent" as const },
    { key: "sftp", variant: "accent" as const },
    { key: "telnet", variant: "warning" as const },
    { key: "rdp", variant: "accent" as const },
    { key: "vnc", variant: "accent" as const },
    { key: "future", variant: "default" as const },
  ];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-6 py-6">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {APP_CLASSIFICATION}
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-[var(--text-primary)]">{APP_NAME}</h1>
        <p className="mt-2 max-w-2xl text-sm text-[var(--text-secondary)]">
          {t("about.description")}
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <InfoCard label={t("about.facts.version")} value={APP_VERSION} />
        <InfoCard label={t("about.facts.category")} value={APP_CLASSIFICATION} />
        <InfoCard label={t("about.facts.protocols")} value={protocols.join(" / ")} />
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("about.highlightsTitle")}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {highlights.map((item) => (
            <div
              key={item}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-3 text-sm text-[var(--text-secondary)]"
            >
              {item}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("about.stackTitle")}</h2>
        <p className="mt-3 text-sm text-[var(--text-secondary)]">
          {t("about.stackDescription")}
        </p>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("about.protocolStatusTitle")}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {protocolStatus.map(({ key, variant }) => (
            <div
              key={key}
              className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-4 py-4"
            >
              <div className="flex items-center gap-2">
                <Badge variant={variant}>{t(`about.protocols.${key}`)}</Badge>
              </div>
              <p className="mt-3 text-sm text-[var(--text-secondary)]">
                {t(`about.protocolStatus.${key}`)}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--accent)]/25 bg-[var(--accent-subtle)] p-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("about.compatibilityTitle")}</h2>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t("about.compatibilityDescription")}
        </p>
      </section>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-primary)] p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  );
}
