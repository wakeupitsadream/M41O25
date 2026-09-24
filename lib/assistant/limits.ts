import { addDaysIso } from "@/lib/tz";
import type { AssistantSettings, LimitsView } from "./types";

/**
 * Что уже потрачено: day — из строки assistant_quota за сегодня, weekTotal/strongWeek — суммы строк с day >= понедельника,
 * costKopecks30d — себестоимость ответов этого человека за последние BUDGET_WINDOW_DAYS дней.
 */
export type LimitCounts = { day: number; weekTotal: number; strongWeek: number; costKopecks30d: number };

/**
 * Остатки лимитов по календарным суткам и неделям группы (docs/AI-CHAT.md §1): сброс «в полночь» и «в понедельник»,
 * а не скользящее окно — студенту так понятнее. today и monday приходят снаружи (todayIso/mondayIso из lib/tz),
 * чтобы функция оставалась чистой.
 */
export function limitsView(settings: AssistantSettings, counts: LimitCounts, today: string, monday: string, budgetLimit: number | null): LimitsView {
  return {
    day: { used: counts.day, limit: settings.dailyLimit },
    week: { used: counts.weekTotal, limit: settings.weeklyLimit },
    strong: { used: counts.strongWeek, limit: settings.strongWeeklyLimit },
    budget: budgetLimit === null ? null : { used: counts.costKopecks30d, limit: budgetLimit },
    resetsDay: addDaysIso(today, 1),
    resetsWeek: addDaysIso(monday, 7),
  };
}

export {
  BUDGET_WINDOW_DAYS,
  COST_SHARE,
  LIMIT_MESSAGES,
  NEXT_MESSAGE_KOPECKS,
  budgetKopecks,
  canSend,
  type LimitReason,
  type SendCheck,
} from "./limit-rules";
