// Клиентские помощники по времени. Всё считается в часовом поясе группы, а не устройства.
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export const CLIENT_TZ = process.env.NEXT_PUBLIC_APP_TZ ?? "Asia/Yekaterinburg";

export type NowParts = { dateIso: string; minutes: number; seconds: number };

export function nowParts(tz: string = CLIENT_TZ, at: Date = new Date()): NowParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = Number(get("hour")) % 24;
  return {
    dateIso: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: hour * 60 + Number(get("minute")),
    seconds: Number(get("second")),
  };
}

export const isIso = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** ISO-строку даты → локальный Date (только для форматирования, без сдвига по поясу) */
export const parseIso = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const toIso = (d: Date) => format(d, "yyyy-MM-dd");

/**
 * YYYY-MM-DD через `days` дней: календарная арифметика на локальном Date, без сдвигов по поясу.
 * Намеренный двойник серверного `addDaysIso` из lib/tz.ts (там — TZDate в APP_TZ). Серверный код → lib/tz,
 * клиентские компоненты → этот модуль; не смешивать импорты (CLAUDE.md, «Время»).
 */
export const addDaysIso = (iso: string, days: number) => {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
};

export const mondayOf = (iso: string) => {
  const d = parseIso(iso);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return toIso(d);
};

export const diffDays = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86_400_000);

export const toMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export const hm = (t: string) => t.slice(0, 5);

export const fmtWeekday = (iso: string, long = true) => format(parseIso(iso), long ? "EEEE" : "EEEEEE", { locale: ru });
export const fmtDayMonth = (iso: string) => format(parseIso(iso), "d MMMM", { locale: ru });
export const fmtDayShort = (iso: string) => format(parseIso(iso), "d MMM", { locale: ru }).replace(".", "");
export const fmtDayNum = (iso: string) => format(parseIso(iso), "d");

/** «31 авг — 5 сент» / «7–12 сент» — коротко, для заголовков и плиток */
export const fmtRangeShort = (fromIso: string, toIso: string) => {
  const a = parseIso(fromIso);
  const b = parseIso(toIso);
  const mon = (d: Date) => format(d, "MMM", { locale: ru }).replace(".", "");
  if (a.getMonth() === b.getMonth()) return `${format(a, "d")}–${format(b, "d")} ${mon(b)}`;
  return `${format(a, "d")} ${mon(a)} — ${format(b, "d")} ${mon(b)}`;
};

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Остаток минут — в человеческий вид: «37 мин», «1 ч 05 мин» */
export const fmtDuration = (minutes: number) => {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} ч ${String(rest).padStart(2, "0")} мин` : `${h} ч`;
};
