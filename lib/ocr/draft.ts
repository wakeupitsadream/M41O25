import type { SlotTime } from "@/lib/db/schema";
import type { LessonKind } from "@/lib/schedule/types";
import { DAY_CODES, KIND_FROM_OCR, type OcrLesson, type OcrResult } from "./schema";
import { matchSubjectDetailed, type MatchKind, type SubjectRef as MatchSubjectRef } from "./match";

export { matchSubject, matchSubjectDetailed, normalizeTitle } from "./match";
export type { MatchKind } from "./match";

/** Откуда взято поле черновика: из скана или подставлено из справочника предметов. */
export type FieldSource = "scan" | "catalog";

export type DraftLesson = {
  key: string;
  date: string;
  slot: number;
  startsAt: string;
  endsAt: string;
  title: string;
  /** Название ровно как в скане — для автообучения алиасов, даже если админ заменил title названием предмета. */
  scanTitle: string;
  subjectId: string | null;
  /** Как нашли предмет: точно, по алиасу, нечётко (стоит проверить) или не нашли. */
  matchKind: MatchKind | null;
  room: string | null;
  roomSource: FieldSource | null;
  teacherName: string | null;
  teacherSource: FieldSource | null;
  kind: LessonKind;
  weekType: "upper" | "lower" | "both";
  uncertain: boolean;
  rawText: string;
  include: boolean;
};

export type SubjectRef = MatchSubjectRef & { defaultTeacher?: string | null; defaultRoom?: string | null };

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

/** Сдвиг даты-строки на n дней без часовых поясов (арифметика по UTC над YYYY-MM-DD). */
export const addDays = (iso: string, n: number) => {
  const [y, mo, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d + n));
  return dt.toISOString().slice(0, 10);
};

/** Разница в днях между двумя датами-строками (b − a). */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Ответ модели → черновик пар на конкретные даты недели. Пары «чужой» чётности отбрасываются:
 * скан всегда приходит на конкретную неделю с известной чётностью.
 * Если в скане нет преподавателя или аудитории, а у найденного предмета есть значения по умолчанию — подставляем их
 * с пометкой источника «catalog».
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
    const match = matchSubjectDetailed(l.subject, subjects);
    const subject = match ? subjects.find((s) => s.id === match.id) ?? null : null;
    const scanRoom = l.room?.trim().slice(0, 40) || null;
    const scanTeacher = l.teacher?.trim().slice(0, 80) || null;
    const room = scanRoom ?? (subject?.defaultRoom?.trim().slice(0, 40) || null);
    const teacherName = scanTeacher ?? (subject?.defaultTeacher?.trim().slice(0, 80) || null);
    const title = l.subject.trim().slice(0, 120);
    out.push({
      key: `${l.day}-${slot}-${i}`,
      date: addDays(weekStartsOn, dayIdx),
      slot,
      startsAt,
      endsAt,
      title,
      scanTitle: title,
      subjectId: match?.id ?? null,
      matchKind: match?.kind ?? null,
      room,
      roomSource: room ? (scanRoom ? "scan" : "catalog") : null,
      teacherName,
      teacherSource: teacherName ? (scanTeacher ? "scan" : "catalog") : null,
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
