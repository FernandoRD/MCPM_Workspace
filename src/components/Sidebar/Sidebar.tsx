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
} from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const navItems = [
    { to: "/", icon: Server, label: t("nav.dashboard") },
    { to: "/credentials", icon: KeyRound, label: t("nav.credentials") },
    { to: "/ssh-keys", icon: KeySquare, label: t("nav.sshKeys") },
    { to: "/groups", icon: Layers, label: t("nav.groups") },
    { to: "/connection-log", icon: History, label: t("nav.connectionLog") },
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
