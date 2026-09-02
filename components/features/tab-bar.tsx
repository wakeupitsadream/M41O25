"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, CalendarDays, Plus, UserRound, Users } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const tabs = [
  { href: "/s", label: "Расписание", icon: CalendarDays, match: /^\/s(\/|$)/ },
  { href: "/hw", label: "Домашка", icon: BookOpen, match: /^\/hw(\/|$)/ },
  { href: "/group", label: "Группа", icon: Users, match: /^\/group(\/|$)/ },
  { href: "/me", label: "Профиль", icon: UserRound, match: /^\/(me|admin)(\/|$)/ },
] as const;

export function TabBar({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname();
  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  const renderTab = (t: (typeof tabs)[number]) => {
    const active = t.match.test(pathname);
    const Icon = t.icon;
    const badge = t.href === "/group" && unread > 0 ? unread : 0;
    return (
      <Link
        key={t.href}
        href={t.href}
        className={cn("relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors", active ? "text-accent" : "text-muted")}
      >
        <span className="relative">
          <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} />
          {badge > 0 && (
            <span className="absolute -right-2.5 -top-1.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-ink tnum">{badge > 99 ? "99" : badge}</span>
          )}
        </span>
        <span>{t.label}</span>
        {active && (
          <motion.span layoutId="tab-dot" className="absolute -top-0.5 h-1 w-6 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 40 }} />
        )}
      </Link>
    );
  };

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-lg glass border-t border-border"
      style={{ paddingBottom: "var(--sab)" }}
      aria-label="Разделы"
    >
      <div className="flex items-stretch px-2">
        {left.map(renderTab)}
        <div className="flex flex-1 items-center justify-center">
          <Link
            href="/hw/new"
            aria-label="Добавить домашку"
            className="-mt-6 grid size-14 place-items-center rounded-full bg-accent text-accent-ink shadow-glow transition active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.6} />
          </Link>
        </div>
        {right.map(renderTab)}
      </div>
    </nav>
  );
}
