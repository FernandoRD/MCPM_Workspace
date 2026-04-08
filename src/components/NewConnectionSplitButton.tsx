import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { ChevronDown, FileSpreadsheet, FileCode2, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { buildAppRoute } from "@/lib/windowMode";
import { cn } from "@/lib/utils";

interface NewConnectionSplitButtonProps {
  size?: "sm" | "md" | "lg";
  standaloneWindow?: boolean;
  onImportSshConfig: () => void;
}

export function NewConnectionSplitButton({
  size = "sm",
  standaloneWindow = false,
  onImportSshConfig,
}: NewConnectionSplitButtonProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const openSingleHost = () => {
    setOpen(false);
    navigate(buildAppRoute("/hosts/new", standaloneWindow));
  };

  const openCsvImport = () => {
    setOpen(false);
    navigate(buildAppRoute("/hosts/import/csv", standaloneWindow));
  };

  const openSshConfigImport = () => {
    setOpen(false);
    onImportSshConfig();
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <Button
        size={size}
        className="rounded-r-none"
        onClick={openSingleHost}
      >
        <Plus size={14} />
        {t("nav.newConnection")}
      </Button>

      <Button
        size={size}
        className={cn(
          "rounded-l-none border-l border-white/20 px-2",
          size === "md" && "px-2.5",
          size === "lg" && "px-3"
        )}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("newConnectionMenu.openMenu")}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 min-w-60 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] shadow-xl">
          <MenuItem
            icon={Plus}
            title={t("newConnectionMenu.singleHost")}
            description={t("newConnectionMenu.singleHostDescription")}
            onClick={openSingleHost}
          />
          <MenuItem
            icon={FileSpreadsheet}
            title={t("newConnectionMenu.csvImport")}
            description={t("newConnectionMenu.csvImportDescription")}
            onClick={openCsvImport}
          />
          <MenuItem
            icon={FileCode2}
            title={t("newConnectionMenu.sshConfigImport")}
            description={t("newConnectionMenu.sshConfigImportDescription")}
            onClick={openSshConfigImport}
          />
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-hover)]"
    >
      <div className="mt-0.5 rounded-lg bg-[var(--accent-subtle)] p-2 text-[var(--accent)]">
        <Icon size={15} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
      </div>
    </button>
  );
}
