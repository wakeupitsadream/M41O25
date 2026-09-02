import type { SlotTime } from "@/lib/db/schema";
import type { LessonKind } from "@/lib/schedule/types";
import { DAY_CODES, KIND_FROM_OCR, type OcrLesson, type OcrResult } from "./schema";

export type DraftLesson = {
  key: string;
  date: string;
  slot: number;
  startsAt: string;
  endsAt: string;
  title: string;
  subjectId: string | null;
  room: string | null;
  teacherName: string | null;
  kind: LessonKind;
  weekType: "upper" | "lower" | "both";
  uncertain: boolean;
  rawText: string;
  include: boolean;
};

type SubjectRef = { id: string; name: string; shortName: string | null };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

/** Сопоставление названия из скана со справочником: точное → по короткому имени → по вхождению → по первым буквам. */
export function matchSubject(title: string, subjects: SubjectRef[]): string | null {
  const t = norm(title);
  if (!t) return null;
  const exact = subjects.find((s) => norm(s.name) === t || (s.shortName && norm(s.shortName) === t));
  if (exact) return exact.id;
  const contains = subjects.find((s) => norm(s.name).includes(t) || t.includes(norm(s.name)) || (s.shortName && t.includes(norm(s.shortName))));
  if (contains) return contains.id;
  const head = t.slice(0, 6);
  const prefix = subjects.find((s) => head.length >= 5 && norm(s.name).startsWith(head));
  return prefix?.id ?? null;
}

const pad = (t: string) => {
  const [h, m] = t.split(":");
  return `${h.padStart(2, "0")}:${m}`;
};

const addDays = (iso: string, n: number) => {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

/**
 * Ответ модели → черновик пар на конкретные даты недели. Пары «чужой» чётности отбрасываются:
 * скан всегда приходит на конкретную неделю с известной чётностью.
 */
export function toDraft(result: OcrResult, weekStartsOn: string, weekParity: "upper" | "lower" | null, slotTimes: SlotTime[], subjects: SubjectRef[]): DraftLesson[] {
  const out: DraftLesson[] = [];
  result.lessons.forEach((l: OcrLesson, i) => {
    const dayIdx = DAY_CODES.indexOf(l.day);
    if (dayIdx < 0) return;
    const slotTime = slotTimes.find((s) => s.slot === l.slot) ?? (l.time_start ? slotTimes.find((s) => s.start === pad(l.time_start!)) : undefined);
    const slot = l.slot > 0 ? l.slot : slotTime?.slot ?? i + 1;
    const startsAt = l.time_start ? pad(l.time_start) : slotTime?.start ?? "08:30";
    const endsAt = l.time_end ? pad(l.time_end) : slotTime?.end ?? "10:00";
    const foreignParity = weekParity !== null && l.week_type !== "both" && l.week_type !== weekParity;
    out.push({
      key: `${l.day}-${slot}-${i}`,
      date: addDays(weekStartsOn, dayIdx),
      slot,
      startsAt,
      endsAt,
      title: l.subject.trim(),
      subjectId: matchSubject(l.subject, subjects),
      room: l.room?.trim() || null,
      teacherName: l.teacher?.trim() || null,
      kind: l.lesson_type ? KIND_FROM_OCR[l.lesson_type] : "other",
      weekType: l.week_type,
      uncertain: l.uncertain,
      rawText: l.raw_text,
      include: !foreignParity,
    });
  });
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
}
