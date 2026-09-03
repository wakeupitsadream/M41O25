"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { WifiOff } from "lucide-react";
import type { SchedulePayload } from "@/lib/schedule/types";
import { addDaysIso, isIso, mondayOf } from "@/lib/schedule/time";
import { useSchedule } from "./use-schedule";
import { useNow } from "./use-now";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";
import { SemesterView } from "./semester-view";

type View = { level: "week"; weekStart: string } | { level: "day"; date: string } | { level: "semester" };

const DEPTH: Record<View["level"], number> = { semester: 0, week: 1, day: 2 };

function parseView(pathname: string, today: string): View {
  const seg = pathname.replace(/^\/s\/?/, "").split("/").filter(Boolean);
  if (seg[0] === "semester") return { level: "semester" };
  if (seg[0] === "w" && isIso(seg[1])) return { level: "week", weekStart: mondayOf(seg[1]) };
  if (seg[0] === "d" && isIso(seg[1])) return { level: "day", date: seg[1] };
  // В воскресенье учебная неделя уже прошла — по умолчанию показываем следующую.
  const monday = mondayOf(today);
  return { level: "week", weekStart: addDaysIso(monday, 6) === today ? addDaysIso(monday, 7) : monday };
}

const viewKey = (v: View) => (v.level === "week" ? `w:${v.weekStart}` : v.level === "day" ? `d:${v.date}` : "semester");

// Погружение: новый уровень «подлетает» из глубины (крупнее и размыт), предыдущий уходит назад.
const depthVariants: Variants = {
  enter: (dir: number) => ({ opacity: 0, scale: dir >= 0 ? 1.06 : 0.94, filter: "blur(8px)" }),
  center: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: (dir: number) => ({ opacity: 0, scale: dir >= 0 ? 0.94 : 1.06, filter: "blur(8px)" }),
};

const depthTransition = { type: "spring", stiffness: 300, damping: 34, mass: 0.9 } as const;

export type WeatherLine = { text: string; emoji: string };

export function ScheduleApp({ initialData, serverToday, weather = null }: { initialData: SchedulePayload | null; serverToday: string; weather?: WeatherLine | null }) {
  const pathname = usePathname();
  const now = useNow();
  const today = now?.dateIso ?? serverToday;
  const { data, status } = useSchedule(initialData);

  const view = useMemo(() => parseView(pathname, today), [pathname, today]);
  const key = viewKey(view);
  // Неделя «по умолчанию» (в воскресенье — следующая): от неё считаем «эта неделя» и кнопку «Сегодня».
  const defaultWeekStart = useMemo(() => {
    const v = parseView("/s", today);
    return v.level === "week" ? v.weekStart : mondayOf(today);
  }, [today]);

  // Направление анимации: глубже (+1), обратно (−1) или соседний экран того же уровня (0).
  const prevRef = useRef<View>(view);
  const dir = DEPTH[view.level] === DEPTH[prevRef.current.level] ? 0 : DEPTH[view.level] > DEPTH[prevRef.current.level] ? 1 : -1;
  useEffect(() => {
    prevRef.current = view;
  }, [view]);

  // Сколько раз мы сами углублялись — чтобы «назад» уходил по истории, а не выбрасывал из приложения.
  const pushed = useRef(0);
  const toTop = () => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  const go = useCallback((path: string) => {
    window.history.pushState(null, "", path);
    pushed.current += 1;
    toTop();
  }, []);
  const replace = useCallback((path: string) => {
    window.history.replaceState(null, "", path);
    toTop();
  }, []);
  // «Назад» списывает pushed только в popstate — иначе один возврат считался бы дважды.
  const up = useCallback(
    (fallback: string) => {
      if (pushed.current > 0) window.history.back();
      else replace(fallback);
    },
    [replace],
  );
  useEffect(() => {
    const onPop = () => {
      pushed.current = Math.max(0, pushed.current - 1);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const openDay = useCallback((date: string) => go(`/s/d/${date}`), [go]);
  const openWeek = useCallback((monday: string) => go(`/s/w/${monday}`), [go]);
  const openSemester = useCallback(() => go("/s/semester"), [go]);
  const shiftWeek = useCallback(
    (from: string, delta: number) => replace(`/s/w/${addDaysIso(from, delta * 7)}`),
    [replace],
  );
  const shiftDay = useCallback((from: string, delta: number) => replace(`/s/d/${addDaysIso(from, delta)}`), [replace]);

  const offline = status === "offline" || status === "error";

  return (
    <div className="relative">
      {offline && data && (
        <div className="pointer-events-none fixed inset-x-0 z-20 flex justify-center" style={{ top: "calc(var(--sat) + 0.5rem)" }}>
          <div className="flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-muted shadow-float hairline">
            <WifiOff className="size-3.5" />
            Офлайн · данные от{" "}
            {new Date(data.generatedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      )}

      <AnimatePresence initial={false} custom={dir} mode="popLayout">
        <motion.div
          key={key}
          custom={dir}
          variants={depthVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={depthTransition}
          className="min-h-dvh origin-center"
          style={{ willChange: "transform, opacity, filter" }}
        >
          {view.level === "week" && (
            <WeekView
              data={data}
              now={now}
              today={today}
              weekStart={view.weekStart}
              defaultWeekStart={defaultWeekStart}
              weather={weather}
              onOpenDay={openDay}
              onShiftWeek={(d) => shiftWeek(view.weekStart, d)}
              onSemester={openSemester}
              onToday={() => replace("/s")}
            />
          )}
          {view.level === "day" && (
            <DayView
              data={data}
              now={now}
              today={today}
              date={view.date}
              onBack={() => up(`/s/w/${mondayOf(view.date)}`)}
              onShiftDay={(d) => shiftDay(view.date, d)}
            />
          )}
          {view.level === "semester" && (
            <SemesterView data={data} today={today} onOpenWeek={openWeek} onClose={() => up("/s")} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
