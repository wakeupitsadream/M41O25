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
  // Короткое имя — только как целое слово и от 3 символов: «ИЯ» не должно цеплять «История».
  const tokens = new Set(t.split(" "));
  const byShort = subjects.filter((s) => s.shortName && norm(s.shortName).length >= 3 && tokens.has(norm(s.shortName)));
  if (byShort.length === 1) return byShort[0].id;
  const contains = subjects.filter((s) => t.length >= 5 && (norm(s.name).includes(t) || t.includes(norm(s.name))));
  if (contains.length === 1) return contains[0].id;
  const head = t.slice(0, 6);
  const prefix = subjects.filter((s) => head.length >= 5 && norm(s.name).startsWith(head));
  return prefix.length === 1 ? prefix[0].id : null;
}

/** «8.30», «8-30», «8:30» → «08:30». */
export const normalizeTime = (t: string) => {
  const [h, m] = t.replace(/[.\-]/, ":").split(":");
  return `${h.padStart(2, "0")}:${m}`;
};
const pad = normalizeTime;

const toMin = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

/** Номер пары по времени начала: ближайшая пара сетки в пределах ±20 минут, иначе null. */
export const slotByTime = (timeStart: string, slotTimes: SlotTime[]): number | null => {
  const t = toMin(normalizeTime(timeStart));
  let best: { slot: number; diff: number } | null = null;
  for (const s of slotTimes) {
    const diff = Math.abs(toMin(s.start) - t);
    if (diff <= 20 && (!best || diff < best.diff)) best = { slot: s.slot, diff };
  }
  return best?.slot ?? null;
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
  const perDay: Record<string, number> = {};
  result.lessons.forEach((l: OcrLesson, i) => {
    const dayIdx = DAY_CODES.indexOf(l.day);
    if (dayIdx < 0) return;
    perDay[l.day] = (perDay[l.day] ?? 0) + 1;
    const byTime = l.time_start ? slotByTime(l.time_start, slotTimes) : null;
    const slotTime = slotTimes.find((s) => s.slot === (l.slot > 0 ? l.slot : byTime ?? -1));
    const slot = Math.min(10, Math.max(1, l.slot > 0 ? l.slot : byTime ?? perDay[l.day]));
    const startsAt = l.time_start ? pad(l.time_start) : slotTime?.start ?? "08:30";
    const endsAt = l.time_end ? pad(l.time_end) : slotTime?.end ?? "10:00";
    const foreignParity = weekParity !== null && l.week_type !== "both" && l.week_type !== weekParity;
    out.push({
      key: `${l.day}-${slot}-${i}`,
      date: addDays(weekStartsOn, dayIdx),
      slot,
      startsAt,
      endsAt,
      title: l.subject.trim().slice(0, 120),
      subjectId: matchSubject(l.subject, subjects),
      room: l.room?.trim().slice(0, 40) || null,
      teacherName: l.teacher?.trim().slice(0, 80) || null,
      kind: l.lesson_type ? KIND_FROM_OCR[l.lesson_type] : "other",
      weekType: l.week_type,
      uncertain: l.uncertain,
      rawText: l.raw_text,
      include: !foreignParity,
    });
  });
  // Два занятия в одной паре одной чётности — почти наверняка ошибка разметки: подсвечиваем оба.
  const seen = new Map<string, DraftLesson>();
  for (const d of out) {
    for (const wt of d.weekType === "both" ? ["upper", "lower"] : [d.weekType]) {
      const k = `${d.date}|${d.slot}|${wt}`;
      const prev = seen.get(k);
      if (prev && prev !== d) {
        prev.uncertain = true;
        d.uncertain = true;
        if (!d.rawText.includes("два занятия")) d.rawText = `${d.rawText} · два занятия в одной паре`;
      } else seen.set(k, d);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.slot - b.slot);
}
