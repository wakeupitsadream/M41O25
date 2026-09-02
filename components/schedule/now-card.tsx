"use client";

import { motion } from "motion/react";
import { ChevronRight, MapPin } from "lucide-react";
import type { ScheduleLesson } from "@/lib/schedule/types";
import { nowState } from "@/lib/schedule/derive";
import { fmtDuration } from "@/lib/schedule/time";
import { pluralRu } from "@/lib/utils";

const ordinal = (i: number) => `${i + 1}-я`;

/** Живая плашка «Сейчас идёт»: считается на клиенте из расписания дня, ноль бэкенда. */
export function NowCard({ lessons, minutes, onOpen }: { lessons: ScheduleLesson[]; minutes: number; onOpen: () => void }) {
  const st = nowState(lessons, minutes);
  if (st.kind === "none") return null;

  let label = "";
  let title = "";
  let sub: React.ReactNode = null;
  let progress: number | null = null;
  let accent = false;

  switch (st.kind) {
    case "during":
      accent = true;
      label = `Сейчас идёт · ${ordinal(st.index)} пара из ${st.total}`;
      title = st.current.title;
      sub = (
        <>
          {st.current.room && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3.5" /> {st.current.room}
            </span>
          )}
          <span>до конца {fmtDuration(st.minutesLeft)}</span>
        </>
      );
      progress = st.progress;
      break;
    case "break":
      label = `Перемена · следующая через ${fmtDuration(st.minutesUntil)}`;
      title = st.next.title;
      sub = st.next.room ? (
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3.5" /> {st.next.room} · {st.next.startsAt}
        </span>
      ) : (
        <span>{st.next.startsAt}</span>
      );
      break;
    case "before":
      label = `Первая пара через ${fmtDuration(st.minutesUntil)}`;
      title = st.next.title;
      sub = (
        <span className="inline-flex items-center gap-1">
          {st.next.startsAt}
          {st.next.room && (
            <>
              {" · "}
              <MapPin className="size-3.5" /> {st.next.room}
            </>
          )}
        </span>
      );
      break;
    case "done":
      label = "На сегодня всё";
      title = "Пары закончились 🎉";
      sub = (
        <span>
          {st.total} {pluralRu(st.total, "пара", "пары", "пар")} позади
        </span>
      );
      break;
  }

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className={
        accent
          ? "relative w-full overflow-hidden rounded-lg bg-accent p-4 text-left text-accent-ink shadow-glow"
          : "relative w-full overflow-hidden rounded-lg bg-surface-2 p-4 text-left hairline"
      }
    >
      <div className={`text-[12px] font-semibold uppercase tracking-wide ${accent ? "text-accent-ink/70" : "text-muted"}`}>{label}</div>
      <div className="mt-1 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-display text-[19px] font-bold leading-tight">{title}</div>
          <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-medium ${accent ? "text-accent-ink/80" : "text-muted"}`}>{sub}</div>
        </div>
        <ChevronRight className={`size-5 shrink-0 ${accent ? "text-accent-ink/60" : "text-dim"}`} />
      </div>
      {progress !== null && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-accent-ink/15">
          <motion.div
            className="h-full rounded-full bg-accent-ink/70"
            initial={false}
            animate={{ width: `${Math.round(progress * 100)}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 24 }}
          />
        </div>
      )}
    </motion.button>
  );
}
