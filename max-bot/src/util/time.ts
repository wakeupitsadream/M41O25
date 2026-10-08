/** Смещение часового пояса tz относительно UTC в миллисекундах для момента at. */
export function tzOffsetMs(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Календарная дата YYYY-MM-DD в поясе tz. */
export function localDayIso(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Ближайшая полночь в поясе tz строго после at (с учётом перехода на летнее время). */
export function nextMidnight(at: Date, tz: string): Date {
  const [y, m, d] = localDayIso(at, tz).split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  let result = guess - tzOffsetMs(guess, tz);
  // Если между guess и result сменилось смещение (DST), пересчитываем по смещению в самой точке.
  result = guess - tzOffsetMs(result, tz);
  return new Date(result);
}

/** Дневные квоты Gemini обнуляются в полночь по тихоокеанскому времени. */
export const nextPacificMidnight = (at: Date) => nextMidnight(at, "America/Los_Angeles");
export const nextUtcMidnight = (at: Date) => nextMidnight(at, "UTC");

/** «12:00» сегодня или «12:00, 9 окт.» — для сообщений о том, когда модель снова доступна. */
export function formatWhen(when: Date, now: Date, tz: string): string {
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(when);
  if (localDayIso(when, tz) === localDayIso(now, tz)) return time;
  const day = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short" }).format(when);
  return `${time}, ${day}`;
}

/** Курс по году поступления: учебный год начинается 1 сентября. */
export function courseNumber(at: Date, startYear: number, tz: string): number {
  const [y, m] = localDayIso(at, tz).split("-").map(Number) as [number, number];
  const academicYear = m >= 9 ? y : y - 1;
  return Math.max(1, academicYear - startYear + 1);
}
