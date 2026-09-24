import type { AccessStatus, AssistantUsage, ChatEvent, LimitsView } from "../types";

/*
 * Клиентская сторона протокола POST /api/assistant/chat (docs/AI-CHAT.md §7): разбор NDJSON и толкование кодов
 * ответа. Чистые функции без DOM и React — их гоняет node:test на строках; сеть и состояние экрана живут
 * в components/assistant/use-chat.ts.
 */

/**
 * Событие стрима, как его видит клиент. Отличие от ChatEvent одно: limits в done может не прийти или прийти
 * битым — ответ от этого не перестаёт быть сохранённым, поэтому такой done не выбрасываем, а оставляем старые остатки.
 */
export type StreamEvent = Exclude<ChatEvent, { t: "done" }> | { t: "done"; messageId: string; limits: LimitsView | null; usage: AssistantUsage | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isUsed = (v: unknown): v is { used: number; limit: number } => isObj(v) && isCount(v.used) && isCount(v.limit);

export function isLimitsView(v: unknown): v is LimitsView {
  return isObj(v) && isUsed(v.day) && isUsed(v.week) && isUsed(v.strong) && isStr(v.resetsDay) && isStr(v.resetsWeek);
}

export function isAccessStatus(v: unknown): v is AccessStatus {
  if (!isObj(v)) return false;
  if (v.kind === "none") return true;
  if (v.kind === "trial" || v.kind === "paid") return isStr(v.until);
  if (v.kind === "expired") return v.since === null || isStr(v.since);
  return false;
}

const isUsage = (v: unknown): v is AssistantUsage => isObj(v) && isCount(v.prompt) && isCount(v.completion) && isCount(v.cached);

const FALLBACK_ERROR = "Помощник не ответил — попробуй ещё раз";

/**
 * Одна строка NDJSON → событие. Битая строка и незнакомый тип — null, а не исключение: новое событие на сервере
 * не должно ронять клиент, который ещё не обновился (PWA на телефоне живёт со старым бандлом сутками).
 */
export function parseChatEvent(line: string): StreamEvent | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObj(v)) return null;
  switch (v.t) {
    case "start":
      return isStr(v.conversationId) && isStr(v.messageId) ? { t: "start", conversationId: v.conversationId, messageId: v.messageId } : null;
    case "delta":
      return isStr(v.text) ? { t: "delta", text: v.text } : null;
    case "tool":
      return isStr(v.name) ? { t: "tool", name: v.name } : null;
    case "done":
      return isStr(v.messageId) ? { t: "done", messageId: v.messageId, limits: isLimitsView(v.limits) ? v.limits : null, usage: isUsage(v.usage) ? v.usage : null } : null;
    case "error":
      // Ошибку показываем всегда, даже без текста: молча потерять конец ответа хуже, чем показать общую фразу.
      return { t: "error", message: isStr(v.message) && v.message.trim() ? v.message.trim() : FALLBACK_ERROR };
    default:
      return null;
  }
}

/**
 * Построчный разборщик поверх кусков текста: кусок сети может оборвать строку где угодно, поэтому хвост без \n
 * ждёт следующего куска. \r и пустые строки не считаются событиями (прокси иногда добавляют CRLF или keep-alive).
 */
export function createEventParser() {
  let buf = "";
  const take = (lines: string[]) => {
    const out: StreamEvent[] = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      const e = parseChatEvent(line);
      if (e) out.push(e);
    }
    return out;
  };
  return {
    push(chunk: string): StreamEvent[] {
      buf += chunk;
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      return take(parts);
    },
    /** Конец потока: последняя строка могла прийти без завершающего \n. */
    end(): StreamEvent[] {
      const rest = buf;
      buf = "";
      return take([rest]);
    },
  };
}

/**
 * Читает тело ответа до конца и отдаёт события по мере прихода. TextDecoder в режиме stream: кириллическая буква —
 * два байта, и сеть легко режет её пополам между кусками. Обрыв (AbortError, сеть) пробрасывается вызывающему.
 */
export async function readChatStream(body: ReadableStream<Uint8Array>, onEvent: (e: StreamEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createEventParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const e of parser.push(decoder.decode(value, { stream: true }))) onEvent(e);
    }
    for (const e of parser.push(decoder.decode())) onEvent(e);
    for (const e of parser.end()) onEvent(e);
  } finally {
    reader.releaseLock();
  }
}

/** Почему сервер не принял сообщение — по коду ответа из §7. */
export type ChatFailure =
  | { kind: "auth" }
  | { kind: "blocked"; status: 402 | 403 | 429; message: string; access: AccessStatus | null; limits: LimitsView | null }
  | { kind: "server"; message: string };

const BLOCKED_TEXT = {
  402: "Доступ к помощнику закончился — продлить можно в разделе «Помощник»",
  403: "Помощник сейчас выключен",
  429: "Лимит сообщений исчерпан",
} as const;

/**
 * Код и JSON-тело не-200 ответа → что показать. 401 — сессия умерла (вход заново), 402/403/429 — карточка
 * с объяснением, 400 — текст сервера (слишком длинное сообщение и т.п.). Всё остальное, включая 404 до деплоя
 * стрим-роута и 5xx, — «сервер не ответил»: человеку важно, что сообщение не ушло и его можно отправить снова.
 */
export function describeFailure(status: number, body: unknown): ChatFailure {
  const error = isObj(body) && isStr(body.error) && body.error.trim() ? body.error.trim() : null;
  if (status === 401) return { kind: "auth" };
  if (status === 402 || status === 403 || status === 429) {
    return {
      kind: "blocked",
      status,
      message: error ?? BLOCKED_TEXT[status],
      access: isObj(body) && isAccessStatus(body.access) ? body.access : null,
      limits: isObj(body) && isLimitsView(body.limits) ? body.limits : null,
    };
  }
  if (status === 400 && error) return { kind: "server", message: error };
  if (status === 413) return { kind: "server", message: "Сообщение слишком большое — сократи текст" };
  return { kind: "server", message: `Сервер не ответил (${status}) — попробуй ещё раз` };
}
