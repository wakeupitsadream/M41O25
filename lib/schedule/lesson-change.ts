import { dueDateLabel } from "@/lib/push/format";
import { KIND_LABEL, type LessonKind } from "@/lib/schedule/types";

/** Поля пары, которые видит студент; этого достаточно, чтобы сказать, что в ней поменялось. */
export type LessonFacts = {
  date: string;
  startsAt: string;
  endsAt: string;
  room: string | null;
  teacherName: string | null;
  title: string;
  kind: LessonKind;
  note: string | null;
};

/** Время из базы приходит как «08:30:00», из формы — «08:30»; сравниваем и печатаем в одном виде. */
const hm = (t: string) => t.slice(0, 5);

const clean = (s: string | null | undefined): string | null => s?.trim() || null;

/**
 * Чем правка пары отличается от прежней версии — одной строкой для тела пуша: «аудитория 305, преподаватель
 * Иванова И.И.». Заметка админа важнее автоматического перечня: если он написал «перенесена в 305», студенты читают
 * это, а не наш пересказ, — поэтому новая заметка возвращается одна. Ничего значимого не поменялось — null: такой пуш
 * слать незачем (открыли пару и нажали «Сохранить»).
 */
export function lessonChangeSummary(prev: LessonFacts, next: LessonFacts): string | null {
  const note = clean(next.note);
  if (note && note !== clean(prev.note)) return note;

  const parts: string[] = [];
  if (next.date !== prev.date) parts.push(`перенесли с ${dueDateLabel(prev.date)}`);
  if (hm(next.startsAt) !== hm(prev.startsAt) || hm(next.endsAt) !== hm(prev.endsAt)) parts.push(`было ${hm(prev.startsAt)}–${hm(prev.endsAt)}`);
  const room = clean(next.room);
  if (room !== clean(prev.room)) parts.push(room ? `аудитория ${room}` : "аудитория не указана");
  const teacher = clean(next.teacherName);
  if (teacher !== clean(prev.teacherName)) parts.push(teacher ? `преподаватель ${teacher}` : "преподаватель не указан");
  if (next.title.trim() !== prev.title.trim()) parts.push(`вместо «${prev.title.trim()}»`);
  if (next.kind !== prev.kind && KIND_LABEL[next.kind]) parts.push(`теперь ${KIND_LABEL[next.kind].toLowerCase()}`);
  return parts.length ? parts.join(", ") : null;
}
