import { z } from "zod";

/**
 * Общие проверки пользовательского ввода, которые раньше жили копиями в каждом файле actions.
 * Дата — не только формат: «2026-02-30» проходит регулярку, а дальше V8 молча делает из неё 2 марта,
 * Postgres падает английской ошибкой, а TZDate даёт Invalid Date. Здесь проверяется, что день существует.
 */
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Round-trip через UTC: строка → дата → строка; совпало — такой день в календаре есть. */
export const isCalendarDate = (iso: string): boolean => {
  if (!ISO_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};

/** Дата YYYY-MM-DD, существующая в календаре. Сообщение одно на оба случая: человеку всё равно, формат или число. */
export const isoDate = z.string().trim().refine(isCalendarDate, "Такой даты нет — проверь день и месяц");
