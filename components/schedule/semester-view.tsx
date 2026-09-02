"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import { addDaysIso, diffDays, fmtRangeShort, mondayOf } from "@/lib/schedule/time";
import type { SchedulePayload } from "@/lib/schedule/types";
import { cn, pluralRu } from "@/lib/utils";

type Props = {
  data: SchedulePayload | null;
  today: string;
  onOpenWeek: (monday: string) => void;
  onClose: () => void;
};

export function SemesterView({ data, today, onOpenWeek, onClose }: Props) {
  const sem = data?.semester ?? null;
  const currentMonday = mondayOf(today);

  const mondays: string[] = [];
  if (sem) {
    for (let m = mondayOf(sem.startsOn); m <= sem.endsOn; m = addDaysIso(m, 7)) mondays.push(m);
  } else if (data) {
    for (const w of data.weeks) mondays.push(w.startsOn);
  }

  const totalDays = sem ? Math.max(1, diffDays(sem.startsOn, sem.endsOn)) : 0;
  const passedDays = sem ? Math.min(totalDays, Math.max(0, diffDays(sem.startsOn, today))) : 0;
  const progress = sem ? passedDays / totalDays : 0;
  const weekIndex = mondays.indexOf(currentMonday);
  const sessionTarget = sem?.sessionStartsOn ?? sem?.endsOn ?? null;
  const daysToSession = sessionTarget ? diffDays(today, sessionTarget) : null;
  const halfway = sem && progress >= 0.5 && progress < 0.53;

  return (
    <div className="px-5">
      <header className="flex items-end justify-between gap-3 pt-safe pb-4">
        <div className="min-w-0">
          <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-muted">Семестр</div>
          <h1 className="truncate font-display text-[28px] font-bold leading-none">{sem?.title ?? "Расписание"}</h1>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="grid size-10 place-items-center rounded-full bg-surface-2 text-fg hairline active:scale-95">
          <X className="size-[18px]" />
        </button>
      </header>

      {sem && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Stat label={weekIndex >= 0 ? "Неделя" : "Недель"} value={weekIndex >= 0 ? `${weekIndex + 1} / ${mondays.length}` : String(mondays.length)} />
          <Stat
            label={daysToSession !== null && daysToSession < 0 ? "Сессия" : "До сессии"}
            value={daysToSession === null ? "—" : daysToSession < 0 ? "идёт" : daysToSession === 0 ? "сегодня" : `${daysToSession} ${pluralRu(daysToSession, "день", "дня", "дней")}`}
            accent={daysToSession !== null && daysToSession >= 0 && daysToSession <= 14}
          />
          <div className="col-span-2 rounded-lg bg-surface p-4 hairline">
            <div className="flex items-baseline justify-between">
              <span className="text-[13px] font-medium text-muted">Семестр пройден</span>
              <span className="font-display text-[22px] font-bold tnum">{Math.round(progress * 100)}%</span>
            </div>
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-3">
              <motion.div className="h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ type: "spring", stiffness: 80, damping: 20, delay: 0.15 }} />
            </div>
            {halfway && <div className="mt-2 text-[13px] text-accent">Полпути! 🏁</div>}
          </div>
        </div>
      )}

      {!data && <div className="grid grid-cols-2 gap-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 rounded-lg skeleton" />)}</div>}

      <div className="grid grid-cols-2 gap-3">
        {mondays.map((m, i) => {
          const w = data?.weeks.find((x) => x.startsOn === m) ?? null;
          const count = w ? w.lessons.filter((l) => !l.isCancelled).length : 0;
          const isCurrent = m === currentMonday;
          const isPast = m < currentMonday;
          const load = Math.min(1, count / 18);
          return (
            <motion.button
              key={m}
              type="button"
              onClick={() => onOpenWeek(m)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(0.4, 0.025 * i), type: "spring", stiffness: 420, damping: 34 }}
              whileTap={{ scale: 0.97 }}
              className={cn(
                "relative overflow-hidden rounded-lg bg-surface p-3.5 text-left hairline",
                isCurrent && "ring-1 ring-accent/80",
                isPast && "opacity-60",
                !w && !isPast && "opacity-70",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{i + 1} нед</span>
                {w?.parity && <span className={cn("size-2 rounded-full", w.parity === "upper" ? "bg-accent" : "bg-border-strong")} title={w.parity === "upper" ? "верхняя" : "нижняя"} />}
              </div>
              <div className={cn("mt-1 font-display text-[15px] font-bold leading-tight", isCurrent && "text-accent")}>
                {fmtRangeShort(m, addDaysIso(m, 5))}
              </div>
              <div className="mt-1 text-[12px] text-muted tnum">{w ? `${count} ${pluralRu(count, "пара", "пары", "пар")}` : "нет данных"}</div>
              {w && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-3">
                  <div className="h-full bg-accent/70" style={{ width: `${Math.round(load * 100)}%` }} />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-surface p-4 hairline">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={cn("mt-1 font-display text-[22px] font-bold leading-none tnum", accent && "text-accent")}>{value}</div>
    </div>
  );
}
