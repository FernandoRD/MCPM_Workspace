import { useTranslation } from "react-i18next";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Server,
  Settings,
  CloudUpload,
  HardDriveDownload,
  KeyRound,
  KeySquare,
  Layers,
  History,
  PlugZap,
  Search,
  Activity,
  Info,
  ScrollText,
} from "lucide-react";
import { useUIStore } from "@/store/uiStore";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const openCommandPalette = useUIStore((s) => s.openCommandPalette);

  const navItems = [
    { to: "/", icon: Server, label: t("nav.dashboard") },
    { to: "/credentials", icon: KeyRound, label: t("nav.credentials") },
    { to: "/ssh-keys", icon: KeySquare, label: t("nav.sshKeys") },
    { to: "/groups", icon: Layers, label: t("nav.groups") },
    { to: "/connection-log", icon: History, label: t("nav.connectionLog") },
    { to: "/operations", icon: PlugZap, label: t("nav.operations") },
    { to: "/health", icon: Activity, label: t("nav.health") },
    { to: "/logs", icon: ScrollText, label: t("nav.logs") },
    { to: "/about", icon: Info, label: t("nav.about") },
    { to: "/sync", icon: CloudUpload, label: t("nav.sync") },
    { to: "/backup", icon: HardDriveDownload, label: t("nav.backup") },
    { to: "/settings", icon: Settings, label: t("nav.settings") },
  ];

  return (
    <aside className="flex flex-col w-52 min-w-[208px] h-full bg-[var(--bg-secondary)] border-r border-[var(--border)]">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b border-[var(--border)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white">
          <Server size={16} />
        </div>
        <span className="font-semibold text-[var(--text-primary)]">{t("app.name")}</span>
      </div>

      {/* Nav links */}
      <nav className="flex flex-col gap-0.5 px-2 py-3">
        <button
          onClick={openCommandPalette}
          className="mb-2 flex items-center justify-between rounded-md border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] transition-colors hover:border-[var(--border-focus)] hover:bg-[var(--bg-hover)]"
        >
          <span className="inline-flex items-center gap-2.5">
            <Search size={16} className="text-[var(--accent)]" />
            {t("nav.quickConnect")}
          </span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            Ctrl+K
          </span>
        </button>
        {navItems.map(({ to, icon: Icon, label }) => (
          <button
            key={to}
            onClick={() => navigate(to)}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors text-left",
              (to === "/" ? location.pathname === to : location.pathname.startsWith(to))
                ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
