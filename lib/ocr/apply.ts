/** Режим применения черновика: заменить все пары недели или добавить только те, которых нет по (дата, пара). */
export type ApplyMode = "replace" | "add-missing";

/**
 * «Добавить только новые»: из черновика остаются строки, для которых в неделе ещё нет пары на ту же дату и номер.
 * Существующие пары не трогаем — так субботний скан не затирает ручные правки прошлой недели.
 */
export function pickNewLessons<T extends { date: string; slot: number }>(items: T[], existing: { date: string; slot: number }[]): { add: T[]; skipped: T[] } {
  const taken = new Set(existing.map((l) => `${l.date}|${l.slot}`));
  const add: T[] = [];
  const skipped: T[] = [];
  for (const it of items) (taken.has(`${it.date}|${it.slot}`) ? skipped : add).push(it);
  return { add, skipped };
}
