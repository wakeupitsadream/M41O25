import { marginTone, type MarginTone } from "./finance";
import { costKopecks } from "./pricing";
import type { AssistantSettings, AssistantUsage } from "./types";

/*
 * Оценка «сколько стоит один человек, который выбирает лимиты до конца» — для строки-справки под настройками
 * помощника в админке (docs/AI-CHAT.md §1). Чистая функция без server-only: считается в клиентской форме на лету,
 * пока админ двигает цену и лимиты, а курс, наценку и модели ей передаёт сервер из env.
 */

/**
 * Профиль сообщения из §1: контекст ~2300 + история ≤ 2500 + вопрос ~300 ≈ 5000 токенов входа, ответ ~500.
 * Кеш не учитываем — худший случай. На Flash-Lite это ≈ 0,30 ₽, на Sonnet 5 ≈ 1,6 ₽ при курсе 85 и наценке 25 %.
 */
export const TYPICAL_USAGE: AssistantUsage = { prompt: 5000, completion: 500, cached: 0 };

/** Оплата — «+30 дней», поэтому и оценка на 30 дней, а не на календарный месяц. */
export const PAID_PERIOD_DAYS = 30;

export type EstimateModels = { model: string; strongModel: string };
export type EstimateLimits = Pick<AssistantSettings, "dailyLimit" | "weeklyLimit" | "strongWeeklyLimit">;

/** Цена одного обычного и одного сильного сообщения в копейках по профилю TYPICAL_USAGE. */
export function messageCostKopecks(models: EstimateModels, rate: number, markup: number): { normal: number; strong: number } {
  return { normal: costKopecks(models.model, TYPICAL_USAGE, rate, markup), strong: costKopecks(models.strongModel, TYPICAL_USAGE, rate, markup) };
}

/**
 * Сколько сообщений человек успеет потратить за неделю: недельный лимит, но не больше семи дневных. Сильные входят
 * в это же число (каждое сильное расходует и обычный лимит, §1), поэтому их не больше, чем сообщений вообще.
 */
export function weeklyMessages(limits: EstimateLimits): { total: number; strong: number } {
  const total = Math.max(0, Math.min(limits.weeklyLimit, limits.dailyLimit * 7));
  return { total, strong: Math.max(0, Math.min(limits.strongWeeklyLimit, total)) };
}

/**
 * Себестоимость одного человека за 30 дней в копейках, если он каждую неделю выбирает лимиты полностью, а сильные —
 * все до одного. Неделя масштабируется на 30/7: выравнивание 30 дней по календарным неделям (захватить края шести
 * недель и в каждой выбрать сильные) при умолчаниях даёт на ~16 % больше, но это экзотика, а не нагрузка —
 * справка должна быть понятной, а запас по марже админ и так закладывает.
 * Округление вверх: оценка расхода не должна быть оптимистичнее счёта Polza.
 */
export function worstCaseCostKopecks(limits: EstimateLimits, models: EstimateModels, rate: number, markup: number): number {
  const { normal, strong } = messageCostKopecks(models, rate, markup);
  const week = weeklyMessages(limits);
  const weekKopecks = (week.total - week.strong) * normal + week.strong * strong;
  return Math.ceil((weekKopecks * PAID_PERIOD_DAYS) / 7);
}

export type WorstCaseEstimate = {
  costKopecks: number;
  /** Сообщений за 30 дней при полном выборе лимитов (округлено вниз — столько целых сообщений человек успеет). */
  messages: number;
  strongMessages: number;
  perMessage: { normal: number; strong: number };
  /** Маржа с одного человека в процентах, целое; null — цена 0, делить нечего. */
  marginPct: number | null;
  tone: MarginTone;
};

/**
 * Строка-справка «при цене X и лимитах Y худший случай ≈ Z ₽, маржа ≈ N %». Тон — те же пороги, что у карточки
 * «Помощник за месяц» (marginTone): цвет в настройках и в обзоре значит одно и то же. Бесплатный помощник — warn:
 * это не ошибка, но весь расход ляжет на владельца.
 */
export function worstCaseEstimate(settings: EstimateLimits & Pick<AssistantSettings, "priceRub">, models: EstimateModels, rate: number, markup: number): WorstCaseEstimate {
  const cost = worstCaseCostKopecks(settings, models, rate, markup);
  const week = weeklyMessages(settings);
  const scale = PAID_PERIOD_DAYS / 7;
  const priceKopecks = settings.priceRub * 100;
  const marginPct = priceKopecks > 0 ? Math.round(((priceKopecks - cost) / priceKopecks) * 100) : null;
  return {
    costKopecks: cost,
    messages: Math.floor(week.total * scale),
    strongMessages: Math.floor(week.strong * scale),
    perMessage: messageCostKopecks(models, rate, markup),
    marginPct,
    tone: marginPct === null ? "warn" : marginTone(marginPct),
  };
}
