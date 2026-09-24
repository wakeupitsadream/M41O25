import { addDaysIso } from "@/lib/tz";
import type { AssistantSettings, LimitsView } from "./types";

/** Что уже потрачено: day — из строки assistant_quota за сегодня, weekTotal/strongWeek — суммы строк с day >= понедельника. */
export type LimitCounts = { day: number; weekTotal: number; strongWeek: number };

/**
 * Остатки лимитов по календарным суткам и неделям группы (docs/AI-CHAT.md §1): сброс «в полночь» и «в понедельник»,
 * а не скользящее окно — студенту так понятнее. today и monday приходят снаружи (todayIso/mondayIso из lib/tz),
 * чтобы функция оставалась чистой.
 */
export function limitsView(settings: AssistantSettings, counts: LimitCounts, today: string, monday: string): LimitsView {
  return {
    day: { used: counts.day, limit: settings.dailyLimit },
    week: { used: counts.weekTotal, limit: settings.weeklyLimit },
    strong: { used: counts.strongWeek, limit: settings.strongWeeklyLimit },
    resetsDay: addDaysIso(today, 1),
    resetsWeek: addDaysIso(monday, 7),
  };
}

export type LimitReason = "day" | "week" | "strong";

export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  day: "Лимит на сегодня исчерпан — обновится в полночь",
  week: "На этой неделе всё — обновится в понедельник",
  strong: "Сильных ответов на неделю больше нет",
};

export type SendCheck = { ok: true } | { ok: false; reason: LimitReason; message: string };

/**
 * Можно ли отправить сообщение. Сильное расходует и обычный лимит, поэтому день и неделя проверяются всегда,
 * а сильный счётчик — сверху. Порядок важен для текста: «сегодня всё» точнее, чем «сильных нет».
 */
export function canSend(view: LimitsView, strong: boolean): SendCheck {
  const blocked = (reason: LimitReason): SendCheck => ({ ok: false, reason, message: LIMIT_MESSAGES[reason] });
  if (view.day.used >= view.day.limit) return blocked("day");
  if (view.week.used >= view.week.limit) return blocked("week");
  if (strong && view.strong.used >= view.strong.limit) return blocked("strong");
  return { ok: true };
}
