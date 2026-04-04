import { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { getTagStyle } from "@/lib/tagColors";

interface SharedProps {
  tag: string;
  selected?: boolean;
  compact?: boolean;
  className?: string;
}

type TagBadgeProps =
  | (SharedProps & HTMLAttributes<HTMLSpanElement> & { onClick?: never })
  | (SharedProps & ButtonHTMLAttributes<HTMLButtonElement> & { onClick: () => void });

export function TagBadge({ tag, selected = false, compact = false, className, ...props }: TagBadgeProps) {
  const style = getTagStyle(tag, selected);
  const classes = cn(
    "inline-flex items-center rounded-full border font-medium transition-colors",
    compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-0.5 text-xs",
    selected && "ring-1 ring-offset-1 ring-[var(--bg-primary)]",
    "max-w-full",
    className
  );

  if ("onClick" in props && typeof props.onClick === "function") {
    const { onClick, ...buttonProps } = props;
    return (
      <button type="button" onClick={onClick} className={classes} style={style} {...buttonProps}>
        <span className="truncate">{tag}</span>
      </button>
    );
  }

  return (
    <span className={classes} style={style} {...props}>
      <span className="truncate">{tag}</span>
    </span>
  );
}
