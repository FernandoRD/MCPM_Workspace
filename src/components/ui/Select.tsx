import { useState, useRef, useEffect, Children, isValidElement, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionData {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  id?: string;
  label?: string;
  value?: string;
  onChange?: (e: { target: { value: string } }) => void;
  className?: string;
  error?: string;
  disabled?: boolean;
  children: ReactNode;
}

function parseOptions(children: ReactNode): OptionData[] {
  const options: OptionData[] = [];
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === "option") {
      const props = child.props as {
        value?: string;
        children?: ReactNode;
        disabled?: boolean;
      };
      options.push({
        value: String(props.value ?? ""),
        label: String(props.children ?? ""),
        disabled: props.disabled,
      });
    }
  });
  return options;
}

export function Select({ id, label, value, onChange, className, error, disabled, children }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = parseOptions(children);
  const selected = options.find((o) => o.value === value) ?? options[0];

  // Fecha ao clicar fora
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = (optValue: string) => {
    if (disabled) return;
    setOpen(false);
    onChange?.({ target: { value: optValue } });
  };

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </label>
      )}
      <div ref={containerRef} className="relative">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            "h-9 w-full rounded-md border border-[var(--border)] bg-[var(--bg-primary)]",
            "px-3 pr-8 text-sm text-[var(--text-primary)] text-left transition-colors",
            "focus:outline-none focus:border-[var(--border-focus)] focus:ring-1 focus:ring-[var(--border-focus)]",
            error && "border-[var(--danger)]",
            disabled && "cursor-not-allowed opacity-60",
            className
          )}
        >
          {selected?.label}
        </button>

        <ChevronDown
          size={14}
          className={cn(
            "absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none transition-transform duration-150",
            open && "rotate-180"
          )}
        />

        {open && !disabled && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] shadow-lg py-1 max-h-60 overflow-auto">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                disabled={opt.disabled}
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  "w-full px-3 py-1.5 text-sm text-left transition-colors",
                  opt.value === value
                    ? "text-[var(--accent)] bg-[var(--accent-subtle)]"
                    : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]",
                  opt.disabled && "opacity-40 cursor-not-allowed"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
