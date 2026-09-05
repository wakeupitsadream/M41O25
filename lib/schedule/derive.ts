import type { ScheduleHomework, ScheduleLesson, SchedulePayload, ScheduleSemester, ScheduleWeek } from "./types";
import { addDaysIso, diffDays, mondayOf, toMinutes } from "./time";

export const lessonsOn = (weeks: ScheduleWeek[], dateIso: string): ScheduleLesson[] =>
  weeks
    .flatMap((w) => w.lessons)
    .filter((l) => l.date === dateIso)
    .sort((a, b) => a.slot - b.slot || a.startsAt.localeCompare(b.startsAt));

export const weekFor = (weeks: ScheduleWeek[], mondayIso: string) => weeks.find((w) => w.startsOn === mondayIso) ?? null;

export type NowState =
  | { kind: "none" }
  | { kind: "before"; next: ScheduleLesson; minutesUntil: number }
  | { kind: "during"; current: ScheduleLesson; progress: number; minutesLeft: number; index: number; total: number }
  | { kind: "break"; next: ScheduleLesson; minutesUntil: number; index: number; total: number }
  | { kind: "done"; total: number };

/** Что сейчас происходит по расписанию дня. */
export function nowState(dayLessons: ScheduleLesson[], minutes: number): NowState {
  const active = dayLessons.filter((l) => !l.isCancelled);
  if (active.length === 0) return { kind: "none" };
  const total = active.length;
  for (let i = 0; i < active.length; i++) {
    const l = active[i];
    const s = toMinutes(l.startsAt);
    const e = toMinutes(l.endsAt);
    if (minutes < s) {
      return i === 0
        ? { kind: "before", next: l, minutesUntil: s - minutes }
        : { kind: "break", next: l, minutesUntil: s - minutes, index: i, total };
    }
    if (minutes >= s && minutes < e) {
      return { kind: "during", current: l, progress: (minutes - s) / (e - s), minutesLeft: e - minutes, index: i, total };
    }
  }
  return { kind: "done", total };
}

/**
 * Бейдж «изменение» живёт до конца дня пары: флаг в базе стоит до следующей публикации недели, но показывать его
 * после того, как пара прошла, незачем. Сравниваем даты как строки YYYY-MM-DD в поясе группы — так бейдж гаснет
 * и на офлайн-кеше, открытом утром следующего дня.
 */
export const changeBadgeAlive = (l: Pick<ScheduleLesson, "modifiedAfterPublish" | "date">, today: string) => l.modifiedAfterPublish && l.date >= today;

/** Есть ли в дне свежие правки (изменение или отмена), о которых ещё стоит предупреждать на карточке недели. */
export const dayHasFreshChanges = (lessons: ScheduleLesson[], today: string) =>
  lessons.some((l) => l.date >= today && (l.modifiedAfterPublish || l.isCancelled));

/** ДЗ с дедлайном в этот день — блок «К этому дню». */
export const homeworkOn = (hw: ScheduleHomework[] | undefined, dateIso: string) => (hw ?? []).filter((h) => h.dueDate === dateIso);

/** ДЗ к конкретной паре: привязанные явно (lessonId) плюс непривязанные того же предмета на этот день. */
export const homeworkForLesson = (hw: ScheduleHomework[] | undefined, lesson: Pick<ScheduleLesson, "id" | "date" | "subjectId">) =>
  (hw ?? []).filter((h) => (h.lessonId ? h.lessonId === lesson.id : h.dueDate === lesson.date && lesson.subjectId !== null && h.subjectId === lesson.subjectId));

/** Список семестров из payload; старый офлайн-кеш без поля `semesters` — только текущий. */
export const semestersOf = (data: Pick<SchedulePayload, "semester" | "semesters">): ScheduleSemester[] =>
  data.semesters ?? (data.semester ? [data.semester] : []);

/** Семестр, в который попадает дата (границы включительно). */
export const semesterAt = (semesters: ScheduleSemester[], dateIso: string): ScheduleSemester | null =>
  semesters.find((s) => s.startsOn <= dateIso && dateIso <= s.endsOn) ?? null;

export type SemesterPhase =
  | { kind: "unknown" }
  /** Учебные недели */
  | { kind: "study"; semester: ScheduleSemester }
  /** Сессия: от sessionStartsOn до endsOn включительно */
  | { kind: "session"; semester: ScheduleSemester; until: string }
  /** Каникулы до начала следующего семестра; days — сколько дней осталось от dateIso */
  | { kind: "break"; until: string; days: number; next: ScheduleSemester }
  /** Семестр закончился, следующий не заведён */
  | { kind: "over"; semester: ScheduleSemester };

/**
 * Что идёт в указанный день: учёба, сессия, каникулы или «семестр закончился».
 * Последний день семестра (endsOn) — ещё сессия/учёба, следующий день — уже каникулы,
 * день начала следующего семестра — уже учёба.
 */
export function semesterPhase(semesters: ScheduleSemester[], dateIso: string): SemesterPhase {
  const sorted = [...semesters].sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const current = semesterAt(sorted, dateIso);
  if (current) {
    return current.sessionStartsOn && dateIso >= current.sessionStartsOn
      ? { kind: "session", semester: current, until: current.endsOn }
      : { kind: "study", semester: current };
  }
  const next = sorted.find((s) => s.startsOn > dateIso);
  if (next) return { kind: "break", until: next.startsOn, days: diffDays(dateIso, next.startsOn), next };
  const last = [...sorted].reverse().find((s) => s.endsOn < dateIso);
  return last ? { kind: "over", semester: last } : { kind: "unknown" };
}

/** Понедельники всех недель семестра: от недели с startsOn до недели с endsOn. */
export function semesterMondays(sem: Pick<ScheduleSemester, "startsOn" | "endsOn">): string[] {
  const out: string[] = [];
  for (let m = mondayOf(sem.startsOn); m <= sem.endsOn; m = addDaysIso(m, 7)) out.push(m);
  return out;
}

/** Неделя сессии: хотя бы один её день попадает в [sessionStartsOn, endsOn]. */
export const isSessionWeek = (mondayIso: string, sem: Pick<ScheduleSemester, "sessionStartsOn" | "endsOn">): boolean =>
  !!sem.sessionStartsOn && addDaysIso(mondayIso, 6) >= sem.sessionStartsOn && mondayIso <= sem.endsOn;

/** Недели текущего payload плюс подгруженный архив: без дублей по понедельнику, приоритет у базовых, по возрастанию. */
export function mergeWeeks(base: ScheduleWeek[], extra: ScheduleWeek[]): ScheduleWeek[] {
  if (extra.length === 0) return base;
  const seen = new Set(base.map((w) => w.startsOn));
  const merged = [...base];
  for (const w of extra) {
    if (seen.has(w.startsOn)) continue;
    seen.add(w.startsOn);
    merged.push(w);
  }
  return merged.sort((a, b) => a.startsOn.localeCompare(b.startsOn));
}

export const kindTone = (kind: ScheduleLesson["kind"]): "neutral" | "accent" | "ok" | "warn" | "danger" => {
  switch (kind) {
    case "exam":
      return "danger";
    case "credit":
      return "warn";
    case "lab":
      return "ok";
    case "lecture":
      return "neutral";
    default:
      return "neutral";
  }
};
