import { TZDate } from "@date-fns/tz";
import { addDays, format, startOfWeek } from "date-fns";

// Все даты пар и дедлайнов живут в часовом поясе группы (Оренбург, UTC+5).
export const APP_TZ = process.env.APP_TZ ?? process.env.NEXT_PUBLIC_APP_TZ ?? "Asia/Yekaterinburg";

export const nowTz = () => new TZDate(Date.now(), APP_TZ);

export const toTz = (d: Date | string | number) => new TZDate(d instanceof Date ? d.getTime() : typeof d === "string" ? new Date(d).getTime() : d, APP_TZ);

/** YYYY-MM-DD текущего дня в поясе группы */
export const todayIso = () => format(nowTz(), "yyyy-MM-dd");

/** YYYY-MM-DD понедельника недели, в которую попадает дата (в поясе группы) */
export const mondayIso = (d: Date | string = nowTz()) =>
  format(startOfWeek(typeof d === "string" ? new TZDate(d, APP_TZ) : toTz(d), { weekStartsOn: 1 }), "yyyy-MM-dd");

/**
 * YYYY-MM-DD через `days` дней, считая в поясе группы (TZDate).
 * Намеренный двойник клиентского `addDaysIso` из lib/schedule/time.ts (там — локальный Date и NEXT_PUBLIC_APP_TZ,
 * без date-fns/tz в клиентском бандле). Серверный код импортирует только lib/tz; не смешивать (CLAUDE.md, «Время»).
 */
export const addDaysIso = (iso: string, days: number) => format(addDays(new TZDate(iso, APP_TZ), days), "yyyy-MM-dd");

/** "HH:MM" текущего времени в поясе группы */
export const nowHm = () => format(nowTz(), "HH:mm");

/** Минуты от полуночи для "HH:MM[:SS]" */
export const hmToMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

/** "YYYY-MM-DDTHH:mm" из <input type="datetime-local"> → момент времени в поясе группы (сервер на Vercel живёт в UTC). */
export function parseLocalDateTime(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (!m) return null;
  const d = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), APP_TZ);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime());
}
