import "server-only";
import { APIConnectionError, APIConnectionTimeoutError, APIError } from "openai";
import { describeProviderError } from "@/lib/ocr/recognize";

/*
 * Ошибки модели помощника (docs/AI-CHAT.md §6). Два текста на каждую: message — студенту (коротко, без слов
 * «Polza» и «HTTP»), detail — в assistant_messages.error и app_errors для админа (что чинить). Основа detail —
 * describeProviderError из OCR: те же статусы Polza, только переменные окружения у помощника свои.
 */

export type ChatErrorInfo = {
  /** Для студента: событие {"t":"error"} и карточка в чате. */
  message: string;
  /** Для админа: колонка error и журнал ошибок. */
  detail: string;
  /** Чинить должен админ (ключ, баланс, модель) — пишем в app_errors, чтобы он увидел в «Обзоре». */
  notifyAdmin: boolean;
};

/** Свой таймаут стрима (нет чанков дольше порога или кончился общий бюджет функции) — не ошибка SDK, а наш abort. */
export class ChatTimeoutError extends Error {
  constructor() {
    super("Модель не ответила вовремя");
    this.name = "ChatTimeoutError";
  }
}

const OVERLOADED = "Помощник перегружен, повтори через минуту";
const ADMIN_KNOWS = "Помощник сейчас недоступен — админ уже знает";

/** Тексты describeProviderError писались для OCR: подставляем переменные помощника и убираем «заполни вручную». */
const forAssistant = (s: string) =>
  s
    .replace("поправь OCR_MODEL или OCR_MODEL_STRONG", "поправь ASSISTANT_MODEL или ASSISTANT_MODEL_STRONG")
    .replace(" или заполни вручную", "")
    .replace("Распознавание не удалось", "Помощник не ответил");

export function describeChatError(e: unknown, model: string): ChatErrorInfo {
  if (e instanceof ChatTimeoutError || e instanceof APIConnectionTimeoutError) {
    return { message: "Ответ не успел за минуту — спроси короче или без сильного режима", detail: `Таймаут ответа модели ${model}`, notifyAdmin: false };
  }
  if (e instanceof APIError && e.status !== undefined) {
    const status = e.status;
    const msg = e.message ?? "";
    const detail = forAssistant(describeProviderError(e, model));
    if (status === 402 || /insufficient|balance|funds|недостаточно|quota/i.test(msg)) {
      return { message: "У помощника закончился баланс — админ уже знает", detail, notifyAdmin: true };
    }
    if (status === 401 || status === 403 || status === 404) return { message: ADMIN_KNOWS, detail, notifyAdmin: true };
    if (status === 429 || status >= 500) return { message: OVERLOADED, detail, notifyAdmin: false };
    if (status === 400 || status === 413) {
      if (/context|too long|too many tokens|maximum.*tokens|token limit|413|payload/i.test(msg) || status === 413) {
        return { message: "Слишком длинно для помощника — начни новый чат или пришли меньше файлов", detail, notifyAdmin: false };
      }
      if (/image|mime|media/i.test(msg)) return { message: "Не получилось прочитать фото — пришли JPG или PNG", detail, notifyAdmin: false };
    }
    return { message: "Помощник не смог ответить — повтори или переформулируй вопрос", detail, notifyAdmin: false };
  }
  // Обрыв соединения до ответа: у SDK это APIConnectionError (без статуса), у fetch — «fetch failed».
  if (e instanceof APIConnectionError || (e instanceof Error && /fetch failed|ECONNRESET|ENOTFOUND|socket hang up|network/i.test(e.message))) {
    return { message: "Нет связи с помощником — повтори через минуту", detail: `Сеть: ${e instanceof Error ? e.message : String(e)}`, notifyAdmin: false };
  }
  const detail = forAssistant(describeProviderError(e, model));
  return { message: "Помощник не смог ответить — повтори через минуту", detail, notifyAdmin: false };
}
