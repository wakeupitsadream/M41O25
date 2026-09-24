export type MarginTone = "ok" | "warn" | "danger";

export type MonthSummaryInput = { revenueRub: number; costKopecks: number; messages: number; activeUsers: number };

export type MonthSummary = {
  revenueRub: number;
  /** Расход в рублях с копейками (costKopecks / 100) — для вывода «12,40 ₽». */
  costRub: number;
  /** Маржа в процентах, целое; null — выручки нет, делить нечего. */
  marginPct: number | null;
  tone: MarginTone;
  messages: number;
  activeUsers: number;
};

/** Пороги docs/AI-CHAT.md §9: ≥ 60 — ok, 40–60 — warn, < 40 — danger. Цель владельца — маржа ≥ 60 % до налога. */
export const MARGIN_OK_PCT = 60;
export const MARGIN_WARN_PCT = 40;

export const marginTone = (marginPct: number): MarginTone => (marginPct >= MARGIN_OK_PCT ? "ok" : marginPct >= MARGIN_WARN_PCT ? "warn" : "danger");

/**
 * Карточка «Помощник за месяц». Маржа считается по округлённому проценту, чтобы цвет совпадал с цифрой на экране
 * (59,6 % показываем как 60 — и красим как 60). Без выручки маржи нет: расход при этом — warn, а не danger:
 * пробная неделя всей группы выглядит именно так и провалом не является; нули везде — спокойный ok.
 */
export function monthSummary(input: MonthSummaryInput): MonthSummary {
  const costRub = input.costKopecks / 100;
  if (input.revenueRub <= 0) {
    return { revenueRub: input.revenueRub, costRub, marginPct: null, tone: input.costKopecks > 0 ? "warn" : "ok", messages: input.messages, activeUsers: input.activeUsers };
  }
  const marginPct = Math.round(((input.revenueRub - costRub) / input.revenueRub) * 100);
  return { revenueRub: input.revenueRub, costRub, marginPct, tone: marginTone(marginPct), messages: input.messages, activeUsers: input.activeUsers };
}
