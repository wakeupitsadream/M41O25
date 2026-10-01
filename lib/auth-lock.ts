import { pluralRu } from "@/lib/utils";

/**
 * Блокировка PIN после серий неудач — чистая арифметика и тексты, без базы (гоняется под node:test).
 * Каждая пятая неудача подряд закрывает вход, и каждая следующая серия длиннее: 1 мин → 5 → 30 → сутки.
 */
export const PIN_LOCK_STEPS_MIN = [1, 5, 30, 24 * 60] as const;
export const PIN_LOCK_EVERY = 5;

/** Минуты блокировки по номеру серии (1, 2, 3…); дальше последней ступени не растёт. */
export const lockMinutesForSeries = (series: number): number => PIN_LOCK_STEPS_MIN[Math.min(Math.max(series, 1), PIN_LOCK_STEPS_MIN.length) - 1];

/** Сколько неудач подряд → замок ли это и на сколько; null — ещё не замок. */
export const lockMinutesForFailures = (failed: number): number | null => (failed > 0 && failed % PIN_LOCK_EVERY === 0 ? lockMinutesForSeries(failed / PIN_LOCK_EVERY) : null);

/** «вход закрыт на 5 минут» / «до завтра»: человек должен знать, сколько ждать, а не пробовать каждую минуту. */
export const lockMessage = (minutes: number): string =>
  minutes >= 24 * 60
    ? "Пять неверных PIN подряд — вход закрыт до завтра. Забыл PIN — напиши админу, он сбросит"
    : `Пять неверных PIN подряд — вход закрыт на ${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}. Забыл PIN — напиши админу, он сбросит`;

/** Остаток блокировки словами: до часа — в минутах (не меньше одной), дальше — в часах с округлением вверх. */
export const remainingLabel = (until: Date, now = Date.now()): string => {
  const minutes = Math.max(1, Math.ceil((until.getTime() - now) / 60_000));
  if (minutes >= 60) {
    const hours = Math.ceil(minutes / 60);
    return `${hours} ${pluralRu(hours, "час", "часа", "часов")}`;
  }
  return `${minutes} ${pluralRu(minutes, "минуту", "минуты", "минут")}`;
};

/** Текст для попытки входа при действующей блокировке; null — блокировки нет или она истекла. */
export const stillLockedMessage = (until: Date | null, now = Date.now()): string | null =>
  until && until.getTime() > now ? `Вход пока закрыт — попробуй через ${remainingLabel(until, now)}. Забыл PIN — напиши админу` : null;

export const WRONG_PIN = "Неверный PIN. Забыл — напиши админу, он сбросит";
