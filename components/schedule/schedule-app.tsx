"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { WifiOff } from "lucide-react";
import type { SchedulePayload } from "@/lib/schedule/types";
import { addDaysIso, isIso, mondayOf } from "@/lib/schedule/time";
import { mergeWeeks, semesterAt, semestersOf } from "@/lib/schedule/derive";
import { useSchedule } from "./use-schedule";
import { useNow } from "./use-now";
import { WeekView } from "./week-view";
import { DayView } from "./day-view";
import { SemesterView, type ArchiveStatus } from "./semester-view";

type View = { level: "week"; weekStart: string } | { level: "day"; date: string } | { level: "semester"; semesterId: string | null };

const DEPTH: Record<View["level"], number> = { semester: 0, week: 1, day: 2 };

const isId = (s: string | undefined): s is string => !!s && /^[0-9a-f-]{8,36}$/i.test(s);

function parseView(pathname: string, today: string): View {
  const seg = pathname.replace(/^\/s\/?/, "").split("/").filter(Boolean);
  if (seg[0] === "semester") return { level: "semester", semesterId: isId(seg[1]) ? seg[1] : null };
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
  // Переключение семестра в сетке — тот же уровень, поэтому replace: «назад» ведёт к неделе, а не по списку семестров.
  const selectSemester = useCallback((id: string | null) => replace(id ? `/s/semester/${id}` : "/s/semester"), [replace]);

  // Архив: недели прошлых (или будущих) семестров подгружаем по требованию и подмешиваем к текущим.
  // В localStorage и офлайн-кеш они не попадают — старый кеш без поля `semesters` работает как раньше.
  const [archive, setArchive] = useState<Record<string, SchedulePayload | "loading" | "error">>({});
  const requested = useRef(new Set<string>());
  const loadArchive = useCallback(async (id: string) => {
    requested.current.add(id);
    setArchive((a) => ({ ...a, [id]: "loading" }));
    try {
      const res = await fetch(`/api/schedule?semester=${encodeURIComponent(id)}`, { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(String(res.status));
      const payload = (await res.json()) as SchedulePayload;
      setArchive((a) => ({ ...a, [id]: payload }));
    } catch {
      setArchive((a) => ({ ...a, [id]: "error" }));
    }
  }, []);
  // Какой семестр нужен экрану, но ещё не загружен: выбранный в сетке или тот, куда попала открытая неделя/день.
  const wantedSemesterId = useMemo(() => {
    if (!data) return null;
    const semesters = semestersOf(data);
    let id: string | null = null;
    if (view.level === "semester") id = view.semesterId;
    else {
      const from = view.level === "week" ? view.weekStart : view.date;
      id = (semesterAt(semesters, from) ?? (view.level === "week" ? semesterAt(semesters, addDaysIso(from, 6)) : null))?.id ?? null;
    }
    return id && id !== data.semester?.id && semesters.some((s) => s.id === id) ? id : null;
  }, [view, data]);
  useEffect(() => {
    if (wantedSemesterId && !requested.current.has(wantedSemesterId)) void loadArchive(wantedSemesterId);
  }, [wantedSemesterId, loadArchive]);
  const archiveStatus: ArchiveStatus = !wantedSemesterId
    ? "ready"
    : archive[wantedSemesterId] === "error"
      ? "error"
      : typeof archive[wantedSemesterId] === "object"
        ? "ready"
        : "loading";
  const merged = useMemo(() => {
    if (!data) return null;
    const extra = Object.values(archive)
      .filter((p): p is SchedulePayload => typeof p === "object")
      .flatMap((p) => p.weeks);
    return extra.length ? { ...data, weeks: mergeWeeks(data.weeks, extra) } : data;
  }, [data, archive]);
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
              data={merged}
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
              data={merged}
              now={now}
              today={today}
              date={view.date}
              onBack={() => up(`/s/w/${mondayOf(view.date)}`)}
              onShiftDay={(d) => shiftDay(view.date, d)}
            />
          )}
          {view.level === "semester" && (
            <SemesterView
              data={merged}
              today={today}
              semesterId={view.semesterId}
              archiveStatus={archiveStatus}
              onSelectSemester={selectSemester}
              onRetryArchive={() => wantedSemesterId && void loadArchive(wantedSemesterId)}
              onOpenWeek={openWeek}
              onClose={() => up("/s")}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
