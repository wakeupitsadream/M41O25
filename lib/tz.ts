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

export const addDaysIso = (iso: string, days: number) => format(addDays(new TZDate(iso, APP_TZ), days), "yyyy-MM-dd");

/** "HH:MM" текущего времени в поясе группы */
export const nowHm = () => format(nowTz(), "HH:mm");

/** Минуты от полуночи для "HH:MM[:SS]" */
export const hmToMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export const isoToDate = (iso: string) => new TZDate(iso, APP_TZ);
