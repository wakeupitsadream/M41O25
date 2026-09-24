import { canSend, NEXT_MESSAGE_KOPECKS, type LimitReason } from "../limit-rules";
import type { LimitsView } from "../types";

/* Лимиты глазами клиента: та же проверка, что у сервера (lib/assistant/limit-rules.ts), плюс то, как это показать. */

export { NEXT_MESSAGE_KOPECKS };

/** Почему сервер откажет, если отправить сейчас; null — пустит. Ровно canSend сервера — один модуль на двоих. */
export function blockReason(v: LimitsView, strong: boolean): LimitReason | null {
  const r = canSend(v, strong);
  return r.ok ? null : r.reason;
}

export const BUDGET_LABEL = "Ресурс · 30 дней";
/** Одна строка под полоской и в карточке отказа: почему ресурс кончается быстрее счётчиков. */
export const BUDGET_HINT = "Документы и сильный режим тратят ресурс быстрее";

/**
 * Ресурс для полоски: процент от потолка и «исчерпан». Исчерпан — когда сервер уже не пустит обычный вопрос
 * (нужен запас на ответ), а не только при 100 %: иначе полоска показывала бы «98 %», а отправка — отказ.
 * text — «37 %», «<1 %» (что-то потрачено, но до процента не дотянуло) или «исчерпан».
 */
export function budgetMeter(b: { used: number; limit: number }): { pct: number; exhausted: boolean; text: string } {
  const exhausted = b.used + NEXT_MESSAGE_KOPECKS.normal > b.limit;
  if (exhausted) return { pct: 100, exhausted, text: "исчерпан" };
  const raw = b.limit > 0 ? (b.used / b.limit) * 100 : 100;
  const pct = Math.min(100, Math.round(raw));
  return { pct, exhausted, text: pct === 0 && b.used > 0 ? "<1 %" : `${pct} %` };
}

/**
 * Заголовок и текст карточки 429 по причине отказа. Серверный текст берём, когда он есть, — кроме ресурса: там
 * своя формулировка, чтобы карточка говорила то же, что подпись под полоской в разделе. strong — отправляли
 * сильное: если на обычный вопрос ресурса ещё хватает, так и говорим, а не «всё закончилось».
 */
export function limitCopy(reason: LimitReason | null, serverMessage: string, limits: LimitsView | null, strong: boolean): { title: string; message: string } {
  if (reason === "budget") {
    if (strong && limits && blockReason(limits, false) === null) {
      // Чип «Сильный» к этому моменту уже погас (остатки из ответа 429), так что достаточно отправить ещё раз.
      return { title: "На сильный ответ ресурса не хватает", message: `Обычный — можно: отправь вопрос ещё раз, сильный режим уже выключен. ${BUDGET_HINT}.` };
    }
    return { title: "Ресурс на 30 дней исчерпан", message: `Он возвращается по мере того, как старые вопросы выходят из 30 дней. ${BUDGET_HINT}.` };
  }
  return { title: "Лимит исчерпан", message: serverMessage };
}
