import { TOOL_RESULT_LIMIT } from "./compact";
import { HISTORY_TOKENS } from "./context";
import { budgetKopecks, COST_SHARE } from "./limits";
import { costKopecks, estimateTokens, PRICES_USD_PER_MTOK } from "./pricing";
import type { AssistantSettings, AssistantUsage } from "./types";

/*
 * Оценка цены сообщения и того, сколько вопросов помещается в ресурс человека, — для справки под настройками
 * помощника в админке (docs/AI-CHAT.md §1). Маржу гарантирует не эта оценка, а ресурс (lib/assistant/limits.ts:
 * себестоимость ответов человека за 30 дней не выше COST_SHARE цены); здесь — честный ответ на вопрос «много ли это».
 * Чистая функция без server-only: считается в клиентской форме на лету, пока админ двигает цену и лимиты, а курс,
 * наценку и модели ей передаёт сервер из env.
 */

/**
 * Профиль запроса в токенах по estimateTokens (≈3,5 символа на токен), замерен 24.09.2026: системный промпт — 467,
 * контекст дня — 243 на демо-базе без домашки и 374 на плотном дне из context.test.ts (4 + 4 пары, 5 домашек),
 * берём с запасом 500; описания девяти инструментов (TOOL_DEFINITIONS, уходят в каждом круге) — 787. Вопрос ~300,
 * вызов инструмента на выходе первого круга ~60, результат инструмента — потолок fitJson (TOOL_RESULT_LIMIT
 * символов, ~1100 токенов). Сменил промпт или инструменты — перемерь: estimate.test.ts сверяет промпт с этим числом.
 */
export const REQUEST_PROFILE = {
  system: 470,
  context: 500,
  tools: 790,
  question: 300,
  toolCall: 60,
  toolResult: estimateTokens("x".repeat(TOOL_RESULT_LIMIT)),
  answer: { normal: 500, strong: 1000 },
} as const;

/**
 * Токенизатор Claude тратит на русский текст заметно больше токенов, чем Gemini, при той же длине — закладываем
 * +30 % входа. Незнакомая модель считается как Claude: как и в priceFor, оценка не должна быть оптимистичнее счёта.
 */
export const CLAUDE_INPUT_FACTOR = 1.3;

export const inputFactor = (model: string) => (model in PRICES_USD_PER_MTOK && !model.startsWith("anthropic/") ? 1 : CLAUDE_INPUT_FACTOR);

/**
 * Типичный вопрос о группе — «что задали по матану», «какие пары в среду»: два запроса к модели, и каждый несёт
 * полный вход (промпт, контекст, описания инструментов, историю до HISTORY_TOKENS, вопрос); во втором к нему
 * добавлены вызов инструмента и его результат. Кеш не учитываем: у Gemini его скидку не обещают.
 */
export function questionUsage(model: string, answerTokens: number): AssistantUsage {
  const p = REQUEST_PROFILE;
  const firstRound = p.system + p.context + p.tools + HISTORY_TOKENS + p.question;
  const secondRound = firstRound + p.toolCall + p.toolResult;
  return { prompt: Math.ceil((firstRound + secondRound) * inputFactor(model)), completion: p.toolCall + answerTokens, cached: 0 };
}

/** Оплата — «+30 дней», поэтому и ресурс, и оценки на 30 дней, а не на календарный месяц. */
export const PAID_PERIOD_DAYS = 30;

export type EstimateModels = { model: string; strongModel: string };
export type EstimateLimits = Pick<AssistantSettings, "dailyLimit" | "weeklyLimit" | "strongWeeklyLimit">;

/** Цена одного обычного и одного сильного вопроса с кругом инструмента, в копейках. */
export function messageCostKopecks(models: EstimateModels, rate: number, markup: number): { normal: number; strong: number } {
  return {
    normal: costKopecks(models.model, questionUsage(models.model, REQUEST_PROFILE.answer.normal), rate, markup),
    strong: costKopecks(models.strongModel, questionUsage(models.strongModel, REQUEST_PROFILE.answer.strong), rate, markup),
  };
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
 * Себестоимость одного человека за 30 дней в копейках, если он каждую неделю выбирает лимиты сообщений полностью,
 * а сильные — все до одного. Нужна там, где ресурса нет (цена 0): тогда потолок расхода задают только лимиты.
 * Неделя масштабируется на 30/7; округление вверх — оценка расхода не должна быть оптимистичнее счёта Polza.
 */
export function worstCaseCostKopecks(limits: EstimateLimits, models: EstimateModels, rate: number, markup: number): number {
  const { normal, strong } = messageCostKopecks(models, rate, markup);
  const week = weeklyMessages(limits);
  const weekKopecks = (week.total - week.strong) * normal + week.strong * strong;
  return Math.ceil((weekKopecks * PAID_PERIOD_DAYS) / 7);
}

export type BudgetEstimate = {
  /** Ресурс человека за 30 дней оплаты; null — цена 0, ресурса нет. */
  budgetKopecks: number | null;
  /** Гарантированная ресурсом маржа, %: 1 − COST_SHARE. */
  marginFloorPct: number;
  perMessage: { normal: number; strong: number };
  /** Сколько вопросов с поиском по данным группы (или только сильных) помещается в ресурс; null — ресурса нет. */
  questions: number | null;
  strongQuestions: number | null;
  /** Сколько сообщений за 30 дней пропускают лимиты (округлено вниз), из них сильных. */
  limitMessages: number;
  limitStrong: number;
  /** Расход за 30 дней при полном выборе лимитов — для бесплатного помощника, где потолок только в лимитах. */
  worstCaseKopecks: number;
};

/**
 * Справка под настройками: ресурс на человека и сколько это вопросов. Ресурс — тот же budgetKopecks, что проверяет
 * стрим-роут (для оплаченных 30 дней), так что цифра в админке и потолок на сервере не разойдутся.
 */
export function budgetEstimate(settings: EstimateLimits & Pick<AssistantSettings, "priceRub">, models: EstimateModels, rate: number, markup: number): BudgetEstimate {
  const perMessage = messageCostKopecks(models, rate, markup);
  const budget = budgetKopecks({ priceRub: settings.priceRub, trialDays: 0 }, { kind: "paid", until: "" });
  const week = weeklyMessages(settings);
  const scale = PAID_PERIOD_DAYS / 7;
  return {
    budgetKopecks: budget,
    marginFloorPct: Math.round((1 - COST_SHARE) * 100),
    perMessage,
    questions: budget === null ? null : Math.floor(budget / perMessage.normal),
    strongQuestions: budget === null ? null : Math.floor(budget / perMessage.strong),
    limitMessages: Math.floor(week.total * scale),
    limitStrong: Math.floor(week.strong * scale),
    worstCaseKopecks: worstCaseCostKopecks(settings, models, rate, markup),
  };
}
