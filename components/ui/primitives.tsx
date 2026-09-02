import type { HTMLAttributes } from "react";
import { cn, initials } from "@/lib/utils";

export function Badge({ className, tone = "neutral", ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: "neutral" | "accent" | "ok" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    accent: "bg-accent/15 text-accent",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    danger: "bg-danger/15 text-danger",
  };
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold leading-none", tones[tone], className)}
      {...props}
    />
  );
}

export function Avatar({
  user,
  size = "md",
  className,
}: {
  user: { fullName: string; avatarEmoji: string; color: string };
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes = { xs: "size-6 text-[11px]", sm: "size-8 text-sm", md: "size-10 text-lg", lg: "size-14 text-2xl" };
  const hasEmoji = Boolean(user.avatarEmoji);
  return (
    <span
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold", sizes[size], className)}
      style={{ background: `${user.color}22`, boxShadow: `inset 0 0 0 1.5px ${user.color}66`, color: user.color }}
      aria-hidden
    >
      {hasEmoji ? user.avatarEmoji : initials(user.fullName)}
    </span>
  );
}

export function EmptyState({
  emoji,
  title,
  text,
  action,
  className,
}: {
  emoji: string;
  title: string;
  text?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-14 text-center", className)}>
      <div className="text-5xl leading-none">{emoji}</div>
      <h3 className="font-display text-xl font-bold">{title}</h3>
      {text && <p className="max-w-xs text-[15px] leading-relaxed text-muted">{text}</p>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-4 px-5 pt-safe pb-4", className)}>
      <div className="min-w-0">
        {subtitle && <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-muted">{subtitle}</div>}
        <h1 className="truncate font-display text-[28px] font-bold leading-none">{title}</h1>
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </header>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-display font-bold tracking-tight", className)}>
      Raspis<span className="text-accent">on</span>
    </span>
  );
}
