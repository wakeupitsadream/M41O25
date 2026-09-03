"use client";

import { motion } from "motion/react";
import { ChevronLeft, ChevronRight, MapPin, UserRound } from "lucide-react";
import type { NowParts } from "@/lib/schedule/time";
import { capitalize, fmtDayMonth, fmtWeekday, mondayOf, parseIso, toMinutes } from "@/lib/schedule/time";
import { KIND_LABEL, PARITY_LABEL, type ScheduleLesson, type SchedulePayload } from "@/lib/schedule/types";
import { kindTone, lessonsOn, weekFor } from "@/lib/schedule/derive";
import { cn, pluralRu } from "@/lib/utils";
import { Badge } from "@/components/ui/primitives";

type Props = {
  data: SchedulePayload | null;
  now: NowParts | null;
  today: string;
  date: string;
  onBack: () => void;
  onShiftDay: (delta: number) => void;
};

export function DayView({ data, now, today, date, onBack, onShiftDay }: Props) {
  const lessons = data ? lessonsOn(data.weeks, date) : [];
  const week = data ? weekFor(data.weeks, mondayOf(date)) : null;
  const active = lessons.filter((l) => !l.isCancelled);
  const isToday = date === today;
  const minutes = isToday && now ? now.minutes : null;

  return (
    <div className="px-5">
      <header className="flex items-center gap-2 pt-safe pb-2">
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-[15px] font-medium text-muted active:bg-surface-2"
        >
          <ChevronLeft className="size-5" /> Неделя
        </button>
        <div className="flex-1" />
        <button type="button" onClick={() => onShiftDay(-1)} aria-label="Предыдущий день" className="grid size-9 place-items-center rounded-full text-muted active:bg-surface-2">
          <ChevronLeft className="size-5" />
        </button>
        <button type="button" onClick={() => onShiftDay(1)} aria-label="Следующий день" className="grid size-9 place-items-center rounded-full text-muted active:bg-surface-2">
          <ChevronRight className="size-5" />
        </button>
      </header>

      <motion.div layoutId={`day-${date}`} className="rounded-lg pb-5 pt-1">
        <div className="flex items-center gap-2 text-[13px] font-medium uppercase tracking-wide text-muted">
          <span>{fmtDayMonth(date)}</span>
          {isToday && <Badge tone="accent" className="normal-case tracking-normal">сегодня</Badge>}
          {week?.parity && <Badge className="normal-case tracking-normal">{PARITY_LABEL[week.parity]}</Badge>}
        </div>
        <h1 className="mt-1 font-display text-[34px] font-bold leading-none">{capitalize(fmtWeekday(date))}</h1>
        <div className="mt-2 text-[14px] text-muted tnum">
          {active.length === 0
            ? "Пар нет"
            : `${active.length} ${pluralRu(active.length, "пара", "пары", "пар")} · ${active[0].startsAt}–${active[active.length - 1].endsAt}`}
        </div>
      </motion.div>

      <motion.div
        key={date}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.12}
        dragMomentum={false}
        onDragEnd={(_, info) => {
          if (info.offset.x < -70 || info.velocity.x < -500) onShiftDay(1);
          else if (info.offset.x > 70 || info.velocity.x > 500) onShiftDay(-1);
        }}
        initial={{ opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
      >
        {!data && <div className="h-40 rounded-lg skeleton" />}
        {data && lessons.length === 0 && (
          <div className="rounded-lg bg-surface p-6 text-center hairline">
            <div className="text-4xl">{[0, 6].includes(parseIso(date).getDay()) ? "😴" : "🎉"}</div>
            <div className="mt-2 font-display text-lg font-bold">{week ? "Свободный день" : "Расписания пока нет"}</div>
            <p className="mt-1 text-[14px] text-muted">{week ? "Ни одной пары. Можно выспаться." : "Появится, когда неделю опубликуют."}</p>
          </div>
        )}
        <ol className="relative">
          {lessons.map((l, i) => {
            const s = toMinutes(l.startsAt);
            const e = toMinutes(l.endsAt);
            const state = minutes === null ? "none" : minutes >= e ? "past" : minutes >= s ? "now" : "future";
            return (
              <LessonRow key={l.id} lesson={l} index={i} state={state} progress={state === "now" && minutes !== null ? (minutes - s) / (e - s) : 0} />
            );
          })}
        </ol>
      </motion.div>
    </div>
  );
}

function LessonRow({
  lesson: l,
  index,
  state,
  progress,
}: {
  lesson: ScheduleLesson;
  index: number;
  state: "none" | "past" | "now" | "future";
  progress: number;
}) {
  const color = l.subjectColor ?? "#9C9CA8";
  return (
    <motion.li
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 * index, type: "spring", stiffness: 420, damping: 34 }}
      className={cn("flex gap-3 pb-3", state === "past" && "opacity-50")}
    >
      <div className="flex w-12 shrink-0 flex-col items-end pt-3 text-right tnum">
        <span className={cn("text-[15px] font-semibold leading-none", state === "now" ? "text-accent" : "text-fg")}>{l.startsAt}</span>
        <span className="mt-1 text-[12px] text-dim">{l.endsAt}</span>
      </div>
      <div className="relative flex w-3 shrink-0 justify-center">
        <div className="absolute inset-y-0 w-px bg-border" />
        <div
          className={cn("relative z-10 mt-4 size-2.5 rounded-full", state === "now" ? "bg-accent shadow-[0_0_0_4px_rgba(200,255,46,0.2)]" : "bg-border-strong")}
          style={state !== "now" ? { background: color } : undefined}
        />
      </div>
      <div
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-lg bg-surface p-4 hairline",
          state === "now" && "ring-1 ring-accent/80",
          l.isCancelled && "opacity-70",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {KIND_LABEL[l.kind] && <Badge tone={kindTone(l.kind)}>{KIND_LABEL[l.kind]}</Badge>}
          {l.isCancelled && <Badge tone="danger">отменена</Badge>}
          {!l.isCancelled && l.modifiedAfterPublish && <Badge tone="warn">изменение</Badge>}
          {state === "now" && <Badge tone="accent">сейчас</Badge>}
        </div>
        <div className={cn("mt-1.5 font-display text-[17px] font-bold leading-snug", l.isCancelled && "line-through decoration-danger/70")}>{l.title}</div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
          {l.room && (
            <span className="inline-flex items-center gap-1.5 font-semibold text-fg">
              <MapPin className="size-3.5 text-muted" /> {l.room}
            </span>
          )}
          {l.teacherName && (
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="size-3.5" /> {l.teacherName}
            </span>
          )}
        </div>
        {l.note && <div className="mt-2 rounded-md bg-warn/10 px-3 py-2 text-[13px] text-warn">{l.note}</div>}
        {state === "now" && (
          <div className="absolute inset-x-0 bottom-0 h-0.5 bg-accent/15">
            <div className="h-full bg-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </motion.li>
  );
}
