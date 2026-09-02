"use client";

import { motion } from "motion/react";
import { CalendarRange, ChevronLeft, ChevronRight, Layers } from "lucide-react";
import type { NowParts } from "@/lib/schedule/time";
import { addDaysIso, capitalize, fmtDayNum, fmtRangeShort, fmtWeekday, mondayOf } from "@/lib/schedule/time";
import { PARITY_LABEL, type ScheduleLesson, type SchedulePayload } from "@/lib/schedule/types";
import { lessonsOn, nowState, weekFor } from "@/lib/schedule/derive";
import { cn, pluralRu } from "@/lib/utils";
import { NowCard } from "./now-card";
import { Badge } from "@/components/ui/primitives";

type Props = {
  data: SchedulePayload | null;
  now: NowParts | null;
  today: string;
  weekStart: string;
  onOpenDay: (date: string) => void;
  onShiftWeek: (delta: number) => void;
  onSemester: () => void;
  onToday: () => void;
};

export function WeekView({ data, now, today, weekStart, onOpenDay, onShiftWeek, onSemester, onToday }: Props) {
  const week = data ? weekFor(data.weeks, weekStart) : null;
  const isCurrentWeek = mondayOf(today) === weekStart;
  const days = [0, 1, 2, 3, 4, 5].map((i) => addDaysIso(weekStart, i));
  const sundayLessons = data ? lessonsOn(data.weeks, addDaysIso(weekStart, 6)) : [];
  if (sundayLessons.length) days.push(addDaysIso(weekStart, 6));
  const todayLessons = data && isCurrentWeek ? lessonsOn(data.weeks, today) : [];
  const semesterOver = data?.semester ? today > data.semester.endsOn : false;

  return (
    <div className="px-5">
      <header className="flex items-end justify-between gap-3 pt-safe pb-4">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[13px] font-medium uppercase tracking-wide text-muted">
            <span>{isCurrentWeek ? "Эта неделя" : "Неделя"}</span>
            {week?.parity && (
              <Badge tone={week.parity === "upper" ? "accent" : "neutral"} className="normal-case tracking-normal">
                {PARITY_LABEL[week.parity]}
              </Badge>
            )}
          </div>
          <h1 className="font-display text-[26px] font-bold leading-none">{fmtRangeShort(weekStart, addDaysIso(weekStart, 5))}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={onToday}
              className="h-10 rounded-full bg-surface-2 px-3.5 text-[13px] font-semibold text-fg hairline active:scale-95"
            >
              Сегодня
            </button>
          )}
          <button
            type="button"
            onClick={onSemester}
            aria-label="Семестр"
            className="grid size-10 place-items-center rounded-full bg-surface-2 text-fg hairline active:scale-95"
          >
            <Layers className="size-[18px]" />
          </button>
        </div>
      </header>

      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onShiftWeek(-1)}
          aria-label="Предыдущая неделя"
          className="grid size-9 place-items-center rounded-full text-muted active:bg-surface-2"
        >
          <ChevronLeft className="size-5" />
        </button>
        <div className="text-[13px] text-dim">
          {data?.semester ? data.semester.title : ""}
        </div>
        <button
          type="button"
          onClick={() => onShiftWeek(1)}
          aria-label="Следующая неделя"
          className="grid size-9 place-items-center rounded-full text-muted active:bg-surface-2"
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <motion.div
        key={weekStart}
        className="space-y-3"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.x < -70 || info.velocity.x < -500) onShiftWeek(1);
          else if (info.offset.x > 70 || info.velocity.x > 500) onShiftWeek(-1);
        }}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
      >
        {isCurrentWeek && now && todayLessons.length > 0 && (
          <NowCard lessons={todayLessons} minutes={now.minutes} onOpen={() => onOpenDay(today)} />
        )}

        {!data && (
          <>
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-[92px] rounded-lg skeleton" />
            ))}
          </>
        )}

        {data && !week && (
          <div className="rounded-lg bg-surface p-5 text-center hairline">
            <div className="text-4xl">{semesterOver ? "❄️" : "🕐"}</div>
            <div className="mt-2 font-display text-lg font-bold">{semesterOver ? "Каникулы" : "Расписания на неделю пока нет"}</div>
            <p className="mt-1 text-[14px] text-muted">
              {semesterOver ? "Семестр закончился. Увидимся в новом." : "Обычно появляется в субботу вечером — как только учебный отдел пришлёт скан."}
            </p>
          </div>
        )}

        {data &&
          week &&
          days.map((date, i) => (
            <DayCard
              key={date}
              date={date}
              index={i}
              lessons={week.lessons.filter((l) => l.date === date)}
              isToday={date === today}
              isPast={date < today}
              minutes={now?.minutes ?? null}
              onOpen={() => onOpenDay(date)}
            />
          ))}
      </motion.div>

      {data && week && (
        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-dim">
          <CalendarRange className="size-3.5" />
          {week.lessons.filter((l) => !l.isCancelled).length} {pluralRu(week.lessons.length, "пара", "пары", "пар")} на неделе
        </div>
      )}
    </div>
  );
}

function DayCard({
  date,
  index,
  lessons,
  isToday,
  isPast,
  minutes,
  onOpen,
}: {
  date: string;
  index: number;
  lessons: ScheduleLesson[];
  isToday: boolean;
  isPast: boolean;
  minutes: number | null;
  onOpen: () => void;
}) {
  const active = lessons.filter((l) => !l.isCancelled);
  const empty = active.length === 0;
  const st = isToday && minutes !== null ? nowState(lessons, minutes) : null;
  const first = active[0];
  const last = active[active.length - 1];
  const changed = lessons.some((l) => l.modifiedAfterPublish || l.isCancelled);

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      layoutId={`day-${date}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 * index, type: "spring", stiffness: 420, damping: 34 }}
      whileTap={{ scale: 0.98 }}
      className={cn(
        "relative flex w-full items-stretch gap-4 rounded-lg bg-surface p-4 text-left hairline transition-colors",
        isToday && "ring-1 ring-accent/80 shadow-[0_0_0_4px_rgba(200,255,46,0.08),0_14px_40px_-16px_rgba(200,255,46,0.45)]",
        isPast && !isToday && "opacity-55",
        empty && !isToday && "opacity-70",
      )}
    >
      <div className="flex w-14 shrink-0 flex-col items-start">
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", isToday ? "text-accent" : "text-muted")}>
          {fmtWeekday(date, false)}
        </span>
        <span className={cn("font-display text-[30px] font-bold leading-none tnum", isToday ? "text-accent" : "text-fg")}>{fmtDayNum(date)}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span>{capitalize(fmtWeekday(date))}</span>
          {isToday && <Badge tone="accent">сегодня</Badge>}
          {changed && <Badge tone="warn">изменения</Badge>}
        </div>
        {empty ? (
          <div className="mt-1 text-[13px] text-dim">Пар нет</div>
        ) : (
          <>
            <div className="mt-0.5 text-[13px] text-muted tnum">
              {active.length} {pluralRu(active.length, "пара", "пары", "пар")} · {first.startsAt}–{last.endsAt}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {active.slice(0, 3).map((l) => (
                <span
                  key={l.id}
                  className="rounded-full px-2 py-0.5 text-[12px] font-medium"
                  style={{ background: `${l.subjectColor ?? "#9C9CA8"}22`, color: l.subjectColor ?? "#9C9CA8" }}
                >
                  {l.subjectShort ?? l.title}
                </span>
              ))}
              {active.length > 3 && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] text-muted">+{active.length - 3}</span>}
            </div>
          </>
        )}
        {st && st.kind === "during" && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[11px] font-medium text-accent">
              <span>
                {st.index + 1}-я пара из {st.total}
              </span>
              <span>ещё {st.minutesLeft} мин</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-accent/15">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(st.progress * 100)}%` }} />
            </div>
          </div>
        )}
      </div>
      <ChevronRight className="my-auto size-5 shrink-0 text-dim" />
    </motion.button>
  );
}
