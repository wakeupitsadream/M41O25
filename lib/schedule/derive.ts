import type { ScheduleHomework, ScheduleLesson, ScheduleWeek } from "./types";
import { toMinutes } from "./time";

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
