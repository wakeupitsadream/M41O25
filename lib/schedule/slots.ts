import type { SlotTime } from "@/lib/db/schema";

/**
 * Сетка звонков филиала (РАНХиГС, Оренбург) с осени 2026: шесть пар по 80 минут. Своя сетка группы лежит
 * в groups.slot_times и правится в Настройках; стандартная подставляется там, где у группы нет времени для пары
 * (строки 5–6 в редакторе недели, черновик по скану, сид), и ставится целиком кнопкой в настройках.
 */
export const DEFAULT_SLOT_TIMES: SlotTime[] = [
  { slot: 1, start: "08:30", end: "09:50" },
  { slot: 2, start: "10:00", end: "11:20" },
  { slot: 3, start: "11:30", end: "12:50" },
  { slot: 4, start: "13:30", end: "14:50" },
  { slot: 5, start: "15:00", end: "16:20" },
  { slot: 6, start: "16:30", end: "17:50" },
];

/** Столько пар редактор недели показывает всегда, даже если в настройках время задано не для всех. */
export const EDITOR_SLOTS = 6;

/** Столько строк в настройках «Время пар»; номер у самой пары может быть и больше (до 10, см. upsertLesson). */
export const MAX_SLOTS = 8;

/** Время пары: из сетки группы, иначе из стандартной, иначе null. */
export const slotTime = (slot: number, slotTimes: SlotTime[]): SlotTime | null =>
  slotTimes.find((s) => s.slot === slot) ?? DEFAULT_SLOT_TIMES.find((s) => s.slot === slot) ?? null;

/** Сетка группы, дополненная стандартной для пар, которых в ней нет, по номеру и по возрастанию. */
export const withDefaultSlots = (slotTimes: SlotTime[]): SlotTime[] =>
  [...slotTimes, ...DEFAULT_SLOT_TIMES.filter((d) => !slotTimes.some((s) => s.slot === d.slot))].sort((a, b) => a.slot - b.slot);

/** Строка редактора: время из настроек группы (configured) или подсказка из стандартной сетки либо из самой пары. */
export type EditorSlot = SlotTime & { configured: boolean };

/**
 * Строки редактора недели: пары 1..EDITOR_SLOTS всегда, плюс все номера из настроек и из пар недели
 * (например, 7-я пара из скана). Для пары без времени в настройках берём время уже стоящей в этом слоте пары,
 * иначе стандартное, иначе пустое — и помечаем configured=false, чтобы редактор показал его как подсказку.
 */
export function editorSlots(slotTimes: SlotTime[], lessons: { slot: number; startsAt: string; endsAt: string }[]): EditorSlot[] {
  const numbers = new Set<number>();
  for (let s = 1; s <= EDITOR_SLOTS; s++) numbers.add(s);
  for (const s of slotTimes) numbers.add(s.slot);
  for (const l of lessons) numbers.add(l.slot);
  return [...numbers]
    .sort((a, b) => a - b)
    .map((slot) => {
      const own = slotTimes.find((s) => s.slot === slot);
      if (own) return { ...own, configured: true };
      const lesson = lessons.find((l) => l.slot === slot);
      const def = DEFAULT_SLOT_TIMES.find((s) => s.slot === slot);
      return { slot, start: lesson?.startsAt ?? def?.start ?? "", end: lesson?.endsAt ?? def?.end ?? "", configured: false };
    });
}
