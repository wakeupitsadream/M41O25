import { addDaysIso } from "@/lib/tz";
import type { AccessStatus, AssistantSettings, LimitsView } from "./types";

/**
 * Что уже потрачено: day — из строки assistant_quota за сегодня, weekTotal/strongWeek — суммы строк с day >= понедельника,
 * costKopecks30d — себестоимость ответов этого человека за последние BUDGET_WINDOW_DAYS дней.
 */
export type LimitCounts = { day: number; weekTotal: number; strongWeek: number; costKopecks30d: number };

/**
 * Какую долю цены может съесть себестоимость одного человека: требование владельца — маржа не ниже 60 %.
 * Константа, а не настройка: это условие бизнеса, а не ручка, которую крутят, когда лимиты кажутся тесными.
 */
export const COST_SHARE = 0.4;
export const BUDGET_WINDOW_DAYS = 30;

/**
 * Запас на следующее сообщение: проверка идёт ДО ответа, его цена ещё неизвестна. Без запаса последнее сообщение
 * пробивало бы потолок на цену одного ответа. Оценки — обычный вопрос с одним кругом инструмента на дешёвой модели
 * и сильный на Sonnet (lib/assistant/estimate.ts); точность тут не нужна, нужен порядок величины.
 */
export const NEXT_MESSAGE_KOPECKS = { normal: 60, strong: 400 } as const;

/**
 * Потолок ресурса в копейках. Оплата — COST_SHARE цены месяца; пробная неделя — доля пропорционально её дням:
 * триал оплачивает владелец, и он должен стоить предсказуемо. Цена 0 — потолка нет (null). Без доступа — 0.
 */
export function budgetKopecks(settings: Pick<AssistantSettings, "priceRub" | "trialDays">, access: AccessStatus): number | null {
  if (settings.priceRub <= 0) return null;
  const full = Math.round(settings.priceRub * 100 * COST_SHARE);
  if (access.kind === "paid") return full;
  if (access.kind === "trial") return Math.round((full * Math.min(Math.max(settings.trialDays, 0), BUDGET_WINDOW_DAYS)) / BUDGET_WINDOW_DAYS);
  return 0;
}

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

export type LimitReason = "day" | "week" | "strong" | "budget";

export const LIMIT_MESSAGES: Record<LimitReason, string> = {
  day: "Лимит на сегодня исчерпан — обновится в полночь",
  week: "На этой неделе всё — обновится в понедельник",
  strong: "Сильных ответов на неделю больше нет",
  budget: "Ресурс помощника на 30 дней исчерпан — он возвращается по мере того, как старые вопросы выходят из окна. Документы и сильный режим тратят его быстрее",
};

export type SendCheck = { ok: true } | { ok: false; reason: LimitReason; message: string };

/**
 * Можно ли отправить сообщение. Сильное расходует и обычный лимит, поэтому день и неделя проверяются всегда,
 * а сильный счётчик — сверху. Порядок важен для текста: «сегодня всё» точнее, чем «сильных нет». Ресурс — перед
 * сильным: если на сильный не хватает денег, обычный ещё может пройти, и текст должен говорить про ресурс.
 */
export function canSend(view: LimitsView, strong: boolean): SendCheck {
  const blocked = (reason: LimitReason): SendCheck => ({ ok: false, reason, message: LIMIT_MESSAGES[reason] });
  if (view.day.used >= view.day.limit) return blocked("day");
  if (view.week.used >= view.week.limit) return blocked("week");
  if (view.budget && view.budget.used + NEXT_MESSAGE_KOPECKS[strong ? "strong" : "normal"] > view.budget.limit) return blocked("budget");
  if (strong && view.strong.used >= view.strong.limit) return blocked("strong");
  return { ok: true };
}
