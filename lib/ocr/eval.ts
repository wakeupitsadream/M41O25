import type { SlotTime } from "@/lib/db/schema";
import { slotByTime } from "./draft";
import { normalizeTitle } from "./match";
import type { DayCode, OcrResult } from "./schema";

/** Ожидаемые пары фикстуры — `fixtures/ocr/<name>.expected.json`, формат описан в fixtures/ocr/README.md. */
export type ExpectedLesson = { day: DayCode; slot: number; subject: string; weekType?: "upper" | "lower" | "both" };
export type ExpectedFixture = {
  group?: string;
  /** Чётность недели скана; пары другой чётности из ответа модели не считаются. */
  weekType?: "upper" | "lower" | null;
  /** Сетка звонков для пар с slot=0 и указанным временем; по умолчанию — стандартная сетка группы. */
  slotTimes?: SlotTime[];
  /** Синонимы написаний: «Матан» → «Математический анализ». Применяются к обеим сторонам. */
  synonyms?: Record<string, string>;
  lessons: ExpectedLesson[];
};

export type EvalMetrics = {
  expected: number;
  found: number;
  tp: number;
  precision: number;
  recall: number;
  f1: number;
  missing: string[];
  extra: string[];
};

export const DEFAULT_SLOT_TIMES: SlotTime[] = [
  { slot: 1, start: "08:30", end: "10:00" },
  { slot: 2, start: "10:10", end: "11:40" },
  { slot: 3, start: "12:10", end: "13:40" },
  { slot: 4, start: "13:50", end: "15:20" },
  { slot: 5, start: "15:30", end: "17:00" },
  { slot: 6, start: "17:10", end: "18:40" },
];

const canon = (subject: string, synonyms: Record<string, string>) => {
  const t = normalizeTitle(subject);
  return synonyms[t] ?? t;
};

const normSynonyms = (synonyms: Record<string, string> = {}) => Object.fromEntries(Object.entries(synonyms).map(([k, v]) => [normalizeTitle(k), normalizeTitle(v)]));

/** Ключ сравнения: день | пара | нормализованный предмет. */
export const lessonKey = (day: string, slot: number, subject: string, synonyms: Record<string, string> = {}) => `${day}|${slot}|${canon(subject, synonyms)}`;

/** Ключи ответа модели: чужая чётность отброшена, slot=0 восстановлен по времени. */
export function actualKeys(result: OcrResult, fixture: ExpectedFixture): string[] {
  const synonyms = normSynonyms(fixture.synonyms);
  const slotTimes = fixture.slotTimes ?? DEFAULT_SLOT_TIMES;
  return result.lessons
    .filter((l) => !fixture.weekType || l.week_type === "both" || l.week_type === fixture.weekType)
    .map((l) => lessonKey(l.day, l.slot > 0 ? l.slot : (l.time_start ? slotByTime(l.time_start, slotTimes) : null) ?? 0, l.subject, synonyms));
}

export function expectedKeys(fixture: ExpectedFixture): string[] {
  const synonyms = normSynonyms(fixture.synonyms);
  return fixture.lessons.filter((l) => !fixture.weekType || !l.weekType || l.weekType === "both" || l.weekType === fixture.weekType).map((l) => lessonKey(l.day, l.slot, l.subject, synonyms));
}

/** Precision/recall по мультимножествам ключей: две одинаковые пары в ожидании требуют двух в ответе. */
export function evalMetrics(fixture: ExpectedFixture, result: OcrResult): EvalMetrics {
  const exp = expectedKeys(fixture);
  const act = actualKeys(result, fixture);
  const pool = new Map<string, number>();
  for (const k of exp) pool.set(k, (pool.get(k) ?? 0) + 1);
  let tp = 0;
  const extra: string[] = [];
  for (const k of act) {
    const n = pool.get(k) ?? 0;
    if (n > 0) {
      tp++;
      pool.set(k, n - 1);
    } else extra.push(k);
  }
  const missing = [...pool.entries()].flatMap(([k, n]) => Array.from({ length: n }, () => k));
  const precision = act.length ? tp / act.length : exp.length ? 0 : 1;
  const recall = exp.length ? tp / exp.length : act.length ? 0 : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { expected: exp.length, found: act.length, tp, precision, recall, f1, missing, extra };
}
