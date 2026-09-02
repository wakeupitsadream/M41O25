"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-press active:bg-accent-press shadow-[0_8px_24px_-10px_rgba(200,255,46,0.6)]",
  secondary: "bg-surface-2 text-fg hover:bg-surface-3 active:bg-surface-3",
  outline: "bg-transparent text-fg hairline hover:bg-surface active:bg-surface",
  ghost: "bg-transparent text-muted hover:text-fg hover:bg-surface active:bg-surface",
  danger: "bg-danger/15 text-danger hover:bg-danger/25 active:bg-danger/25",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm rounded-full gap-1.5",
  md: "h-12 px-5 text-[15px] rounded-full gap-2",
  lg: "h-14 px-6 text-base rounded-full gap-2",
  icon: "size-11 rounded-full",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", loading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold transition-[transform,background-color,color] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : children}
    </button>
  );
});
