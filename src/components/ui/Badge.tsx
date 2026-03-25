import { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "danger" | "accent";
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        {
          "bg-[var(--bg-tertiary)] text-[var(--text-secondary)]": variant === "default",
          "bg-[var(--success)]/20 text-[var(--success)]": variant === "success",
          "bg-[var(--warning)]/20 text-[var(--warning)]": variant === "warning",
          "bg-[var(--danger)]/20 text-[var(--danger)]": variant === "danger",
          "bg-[var(--accent-subtle)] text-[var(--accent)]": variant === "accent",
        },
        className
      )}
      {...props}
    />
  );
}
