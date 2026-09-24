import type { AssistantUsage } from "./types";

/** USD за 1M токенов. cachedInput — цена закешированного входа; нет поля — считаем по полной (у Gemini скидку не обещаем). */
export type ModelPrice = { input: number; output: number; cachedInput?: number };

/** Цены на 16.09.2026 (docs/AI-CHAT.md §1). У Claude чтение кеша — 0,1 × input. Ключи — id моделей в Polza. */
export const PRICES_USD_PER_MTOK: Record<string, ModelPrice> = {
  "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "google/gemini-3.5-flash": { input: 1.5, output: 9 },
  "anthropic/claude-haiku-4.5": { input: 1, output: 5, cachedInput: 0.1 },
  "anthropic/claude-sonnet-5": { input: 2, output: 10, cachedInput: 0.2 },
};

/** Незнакомая модель (админ сменил ASSISTANT_MODEL, а таблицу не обновили) считается по самой дорогой — маржа занижается, а не завышается. */
export const FALLBACK_PRICE_MODEL = "anthropic/claude-sonnet-5";

export const priceFor = (model: string): ModelPrice => PRICES_USD_PER_MTOK[model] ?? PRICES_USD_PER_MTOK[FALLBACK_PRICE_MODEL];

/**
 * Себестоимость сообщения в копейках. rate — ₽ за $, markup — множитель наценки Polza (1.25 = +25 %).
 * usage.cached — часть prompt (как cached_tokens у OpenAI), поэтому из prompt она вычитается, а не прибавляется.
 * Округляем вверх: копейка в пользу расхода, чтобы сумма за месяц не оказалась оптимистичнее счёта.
 */
export function costKopecks(model: string, usage: AssistantUsage, rate: number, markup: number): number {
  const price = priceFor(model);
  const prompt = Math.max(0, usage.prompt);
  const cached = Math.min(Math.max(0, usage.cached), prompt);
  const completion = Math.max(0, usage.completion);
  const usd = ((prompt - cached) * price.input + cached * (price.cachedInput ?? price.input) + completion * price.output) / 1_000_000;
  const kopecks = usd * rate * markup * 100;
  // Плавающая точка: 1.4999999999 после умножений — это 1.5, а не «округлить вверх до 2».
  return Math.ceil(Math.round(kopecks * 1e6) / 1e6);
}

/** Оценка токенов по длине текста, когда usage от провайдера не пришёл (стрим оборвался). ~3,5 символа на токен для русского. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);
