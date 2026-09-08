"use client";

import { cn } from "@/lib/utils";

/** Сам тумблер: дорожка с кружком, состояние — цветом и положением (не только цветом). */
export function Switch({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-150",
        checked ? "bg-accent" : "bg-surface-3 ring-1 ring-border-strong",
        className,
      )}
    >
      <span
        className={cn(
          "absolute size-5 rounded-full bg-fg shadow-sm transition-[left] duration-150",
          checked ? "left-[1.625rem] bg-accent-ink" : "left-1 bg-border-strong",
        )}
      />
    </span>
  );
}

/**
 * Строка настройки с тумблером: название, пояснение и переключатель справа.
 * Тапается целиком (высота ≥ 44px), состояние держит родитель — так его можно менять оптимистично.
 */
export function SwitchRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex min-h-11 w-full items-center gap-4 rounded-lg bg-surface p-4 text-left hairline active:bg-surface-2 disabled:opacity-50",
        className,
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="mt-1 block text-[13px] leading-snug text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} />
    </button>
  );
}
