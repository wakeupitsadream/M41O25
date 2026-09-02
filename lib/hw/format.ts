import { capitalize, diffDays, fmtDayShort, fmtWeekday } from "@/lib/schedule/time";

/** «сегодня», «завтра», «к чт, 11 сент», «просрочено на 3 дня» */
export function dueLabel(dueIso: string, todayIso: string): { text: string; tone: "accent" | "warn" | "danger" | "neutral" } {
  const d = diffDays(todayIso, dueIso);
  if (d === 0) return { text: "сегодня", tone: "danger" };
  if (d === 1) return { text: "завтра", tone: "warn" };
  if (d < 0) return { text: `просрочено${d === -1 ? "" : ` · ${fmtDayShort(dueIso)}`}`, tone: "neutral" };
  if (d <= 6) return { text: `к ${fmtWeekday(dueIso, false)}, ${fmtDayShort(dueIso)}`, tone: "accent" };
  return { text: `к ${fmtDayShort(dueIso)}`, tone: "neutral" };
}

export const dueHeading = (dueIso: string, todayIso: string) => {
  const d = diffDays(todayIso, dueIso);
  if (d === 0) return "Сегодня";
  if (d === 1) return "Завтра";
  return `${capitalize(fmtWeekday(dueIso))}, ${fmtDayShort(dueIso)}`;
};

export const fmtDateTime = (iso: string | Date, tz = process.env.NEXT_PUBLIC_APP_TZ ?? "Asia/Yekaterinburg") =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(".", "");

export const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);
