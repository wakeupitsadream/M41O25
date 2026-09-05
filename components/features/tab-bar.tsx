"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, CalendarDays, Plus, UserRound, Users } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { SECTIONS, sectionOfPath, tabSeenKey, unreadSections, type Section, type SectionLatest } from "@/lib/group/unread";

const tabs = [
  { href: "/s", label: "Расписание", icon: CalendarDays, match: /^\/s(\/|$)/, section: "schedule" },
  { href: "/hw", label: "Домашка", icon: BookOpen, match: /^\/hw(\/|$)/, section: "hw" },
  { href: "/group", label: "Группа", icon: Users, match: /^\/group(\/|$)/, section: "group" },
  { href: "/me", label: "Профиль", icon: UserRound, match: /^\/(me|admin)(\/|$)/, section: null },
] as const satisfies readonly { href: string; label: string; icon: unknown; match: RegExp; section: Section | null }[];

const readSeen = () => {
  const out: Partial<Record<Section, string | null>> = {};
  try {
    for (const s of SECTIONS) out[s] = localStorage.getItem(tabSeenKey(s));
  } catch {
    // приватный режим / нет storage — точки просто считаются от feed_seen_at
  }
  return out;
};

/**
 * Точки непрочитанного по вкладкам. Сервер даёт время последнего чужого события по секции (`latest`)
 * и `feedSeenAt`; телефон помнит в localStorage, когда каждую вкладку открывали. Точка — если событие
 * новее обоих. На сервере и при первом рендере точек нет (иначе mismatch гидратации), появляются после монтирования.
 * Число на «Группе» убрано: три одинаковых индикатора честнее одного числа, которое считало и ДЗ, и расписание,
 * а само число живёт на плитке «Что нового» в хабе.
 */
export function TabBar({ latest = {}, feedSeenAt = null }: { latest?: SectionLatest; feedSeenAt?: string | null }) {
  const pathname = usePathname();
  const [dots, setDots] = useState<Section[]>([]);
  const active = sectionOfPath(pathname);
  // Объект `latest` приходит новым на каждый RSC-ответ; сравниваем по содержимому, чтобы эффект не дёргался зря.
  const latestKey = JSON.stringify(latest);

  useEffect(() => {
    // Открытая вкладка считается просмотренной прямо сейчас — все её события до этого момента прочитаны.
    if (active) {
      try {
        localStorage.setItem(tabSeenKey(active), new Date().toISOString());
      } catch {
        // без storage отметка живёт только в этом рендере
      }
    }
    setDots(unreadSections(JSON.parse(latestKey) as SectionLatest, readSeen(), feedSeenAt, active));
  }, [active, latestKey, feedSeenAt]);

  const left = tabs.slice(0, 2);
  const right = tabs.slice(2);

  const renderTab = (t: (typeof tabs)[number]) => {
    const isActive = t.match.test(pathname);
    const Icon = t.icon;
    const dot = t.section !== null && dots.includes(t.section);
    return (
      <Link
        key={t.href}
        href={t.href}
        className={cn("relative flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors", isActive ? "text-accent" : "text-muted")}
      >
        <span className="relative">
          <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 2} />
          {dot && <span aria-label="есть новое" className="absolute -right-1.5 -top-1 size-2 rounded-full bg-accent ring-2 ring-bg" />}
        </span>
        <span>{t.label}</span>
        {isActive && (
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
