"use client";

import { Fragment } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { addDaysIso, diffDays, fmtDdMm, fmtRangeShort, mondayOf } from "@/lib/schedule/time";
import type { SchedulePayload } from "@/lib/schedule/types";
import { isSessionWeek, semesterMondays, semesterPhase, semestersOf } from "@/lib/schedule/derive";
import { cn, pluralRu } from "@/lib/utils";

export type ArchiveStatus = "ready" | "loading" | "error";

type Props = {
  data: SchedulePayload | null;
  today: string;
  /** Выбранный семестр из URL; null — текущий. */
  semesterId: string | null;
  /** Состояние подгрузки недель выбранного архивного семестра. */
  archiveStatus: ArchiveStatus;
  onSelectSemester: (id: string | null) => void;
  onRetryArchive: () => void;
  onOpenWeek: (monday: string) => void;
  onClose: () => void;
};

export function SemesterView({ data, today, semesterId, archiveStatus, onSelectSemester, onRetryArchive, onOpenWeek, onClose }: Props) {
  const semesters = data ? semestersOf(data) : [];
  const current = data?.semester ?? null;
  const sem = (semesterId ? semesters.find((s) => s.id === semesterId) : null) ?? current;
  const isArchive = !!sem && sem.id !== current?.id;
  const currentMonday = mondayOf(today);

  const mondays: string[] = sem ? semesterMondays(sem) : data ? data.weeks.map((w) => w.startsOn) : [];
  const sessionWeeks = sem ? mondays.filter((m) => isSessionWeek(m, sem)).length : 0;

  const totalDays = sem ? Math.max(1, diffDays(sem.startsOn, sem.endsOn)) : 0;
  const passedDays = sem ? Math.min(totalDays, Math.max(0, diffDays(sem.startsOn, today))) : 0;
  const progress = sem ? passedDays / totalDays : 0;
  const weekIndex = mondays.indexOf(currentMonday);
  const phase = sem ? semesterPhase([sem], today) : ({ kind: "unknown" } as const);
  const halfway = sem && !isArchive && progress >= 0.5 && progress < 0.53;

  // Второй счётчик: до начала / до сессии / сессия идёт / семестр завершён.
  let stat: { label: string; value: string; accent?: boolean } = { label: "До сессии", value: "—" };
  if (sem && phase.kind === "break") {
    stat = { label: "До начала", value: `${phase.days} ${pluralRu(phase.days, "день", "дня", "дней")}`, accent: phase.days <= 14 };
  } else if (sem && phase.kind === "session") {
    stat = { label: "Сессия", value: `до ${fmtDdMm(phase.until)}`, accent: true };
  } else if (sem && phase.kind === "over") {
    stat = { label: "Семестр", value: "завершён" };
  } else if (sem) {
    const target = sem.sessionStartsOn ?? sem.endsOn;
    const days = diffDays(today, target);
    stat = {
      label: sem.sessionStartsOn ? "До сессии" : "До конца",
      value: days === 0 ? "сегодня" : `${days} ${pluralRu(days, "день", "дня", "дней")}`,
      accent: days <= 14,
    };
  }

  const weeksLabel = weekIndex >= 0 && !isArchive ? `${weekIndex + 1} / ${mondays.length}` : String(mondays.length);

  return (
    <div className="px-5">
      <header className="flex items-end justify-between gap-3 pt-safe pb-4">
        <div className="min-w-0">
          <div className="mb-1 text-[13px] font-medium uppercase tracking-wide text-muted">{isArchive ? "Архив" : "Семестр"}</div>
          <h1 className="truncate font-display text-[28px] font-bold leading-none">{sem?.title ?? "Расписание"}</h1>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="grid size-10 place-items-center rounded-full bg-surface-2 text-fg hairline active:scale-95">
          <X className="size-[18px]" />
        </button>
      </header>

      {semesters.length > 1 && (
        <div className="-mx-5 mb-4 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[...semesters].reverse().map((s) => {
            const active = s.id === sem?.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onSelectSemester(s.id === current?.id ? null : s.id)}
                aria-pressed={active}
                className={cn(
                  "h-10 shrink-0 rounded-full px-4 text-[13px] font-semibold transition active:scale-95",
                  active ? "bg-fg text-bg" : "bg-surface-2 text-muted hairline",
                )}
              >
                {s.title}
              </button>
            );
          })}
        </div>
      )}

      {sem && (
        <div className="mb-5 grid grid-cols-2 gap-3">
          <Stat label={weekIndex >= 0 && !isArchive ? "Неделя" : "Недель"} value={weeksLabel} hint={sessionWeeks ? `из них сессия — ${sessionWeeks}` : undefined} />
          <Stat label={stat.label} value={stat.value} accent={stat.accent} />
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

      {(!data || (isArchive && archiveStatus === "loading")) && (
        <div className="grid grid-cols-2 gap-3">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 rounded-lg skeleton" />)}</div>
      )}

      {isArchive && archiveStatus === "error" && (
        <div className="rounded-lg bg-surface p-5 text-center hairline">
          <div className="font-display text-lg font-bold">Архив не загрузился</div>
          <p className="mt-1 text-[14px] text-muted">Нужна сеть: прошлые семестры не хранятся офлайн.</p>
          <button type="button" onClick={onRetryArchive} className="mt-3 h-10 rounded-full bg-surface-2 px-4 text-[13px] font-semibold text-fg hairline active:scale-95">
            Повторить
          </button>
        </div>
      )}

      {data && (!isArchive || archiveStatus === "ready") && (
        <div className="grid grid-cols-2 gap-3">
          {mondays.map((m, i) => {
            const w = data.weeks.find((x) => x.startsOn === m) ?? null;
            const count = w ? w.lessons.filter((l) => !l.isCancelled).length : 0;
            const isCurrent = m === currentMonday;
            const isPast = !isArchive && m < currentMonday;
            const session = sem ? isSessionWeek(m, sem) : false;
            const firstSession = session && sem?.sessionStartsOn && (i === 0 || !isSessionWeek(mondays[i - 1], sem));
            const load = Math.min(1, count / 18);
            return (
              <Fragment key={m}>
                {firstSession && sem && (
                  <div className="col-span-2 mt-1 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-warn">
                    <span>Сессия</span>
                    <span className="h-px flex-1 bg-warn/30" />
                    <span className="font-medium normal-case tracking-normal text-muted">{fmtRangeShort(sem.sessionStartsOn!, sem.endsOn)}</span>
                  </div>
                )}
                <motion.button
                  type="button"
                  onClick={() => onOpenWeek(m)}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(0.4, 0.025 * i), type: "spring", stiffness: 420, damping: 34 }}
                  whileTap={{ scale: 0.97 }}
                  className={cn(
                    "relative overflow-hidden rounded-lg bg-surface p-3.5 text-left hairline",
                    session && "bg-warn/5",
                    isCurrent ? "ring-1 ring-accent/80" : session && "ring-1 ring-warn/40",
                    isPast && "opacity-60",
                    !w && !isPast && !session && "opacity-70",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className={cn("text-[11px] font-semibold uppercase tracking-wide", session ? "text-warn" : "text-muted")}>
                      {session ? "сессия" : `${i + 1} нед`}
                    </span>
                    {w?.parity && <span className={cn("size-2 rounded-full", w.parity === "upper" ? "bg-accent" : "bg-border-strong")} title={w.parity === "upper" ? "верхняя" : "нижняя"} />}
                  </div>
                  <div className={cn("mt-1 font-display text-[15px] font-bold leading-tight", isCurrent && "text-accent")}>
                    {fmtRangeShort(m, addDaysIso(m, 5))}
                  </div>
                  <div className="mt-1 text-[12px] text-muted tnum">{w ? `${count} ${pluralRu(count, "пара", "пары", "пар")}` : "нет данных"}</div>
                  {w && (
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-surface-3">
                      <div className={cn("h-full", session ? "bg-warn/70" : "bg-accent/70")} style={{ width: `${Math.round(load * 100)}%` }} />
                    </div>
                  )}
                </motion.button>
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent, hint }: { label: string; value: string; accent?: boolean; hint?: string }) {
  return (
    <div className="rounded-lg bg-surface p-4 hairline">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={cn("mt-1 font-display text-[22px] font-bold leading-none tnum", accent && "text-accent")}>{value}</div>
      {hint && <div className="mt-1 text-[12px] text-dim">{hint}</div>}
    </div>
  );
}
