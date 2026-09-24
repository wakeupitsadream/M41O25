import { estimateTokens } from "./pricing";
import type { AssistantUsage, ChatEvent } from "./types";

/*
 * Чистая механика стрима помощника (docs/AI-CHAT.md §6–7): без server-only и без SDK, чтобы гоняться под node:test
 * и чтобы клиент мог взять отсюда же разбор NDJSON — формат строки описан в одном месте для обеих сторон.
 */

// ---------- Склейка tool-call дельт ----------

/**
 * Фрагмент tool_calls из чанка OpenAI-совместимого стрима. Поля опциональны намеренно: по спецификации id и имя
 * приходят в первом фрагменте, дальше только куски arguments; а шлюзы бывают небрежны — у Gemini через совместимый
 * слой index иногда отсутствует, а имя повторяется в каждом фрагменте.
 */
export type ToolCallDelta = {
  index?: number | null;
  id?: string | null;
  type?: string | null;
  function?: { name?: string | null; arguments?: string | null } | null;
};

export type AssembledToolCall = { index: number; id: string; name: string; arguments: string };

export type ToolCallAccumulator = {
  push(deltas: readonly ToolCallDelta[] | null | undefined): void;
  /** Вызовы по возрастанию index; без имени — выброшены (модель оборвалась на полуслове, выполнять нечего). */
  list(round?: number): AssembledToolCall[];
  readonly size: number;
};

/**
 * Накопитель tool-call дельт по index. id и имя берутся из первого фрагмента, где они есть, и дальше не
 * перезаписываются (повтор имени в каждом фрагменте не превращается в «get_scheduleget_schedule»), arguments
 * склеиваются в порядке прихода внутри своего index — фрагменты разных вызовов могут чередоваться как угодно.
 */
export function createToolCallAccumulator(): ToolCallAccumulator {
  const slots = new Map<number, { id: string; name: string; arguments: string }>();
  let last: number | null = null;

  const slotFor = (d: ToolCallDelta): number => {
    if (typeof d.index === "number") return d.index;
    // Без index: знакомый id — тот же вызов; новый id — новый слот; ни того ни другого — продолжение последнего.
    if (d.id) {
      for (const [i, s] of slots) if (s.id === d.id) return i;
      return slots.size === 0 ? 0 : Math.max(...slots.keys()) + 1;
    }
    return last ?? 0;
  };

  return {
    push(deltas) {
      for (const d of deltas ?? []) {
        const i = slotFor(d);
        const slot = slots.get(i) ?? { id: "", name: "", arguments: "" };
        if (!slot.id && d.id) slot.id = d.id;
        if (!slot.name && d.function?.name) slot.name = d.function.name;
        if (d.function?.arguments) slot.arguments += d.function.arguments;
        slots.set(i, slot);
        last = i;
      }
    },
    list(round = 0) {
      return [...slots.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, s]) => s.name)
        // Провайдер без id (бывает у Gemini) — придумываем свой: role:"tool" без tool_call_id шлюз отвергнет.
        .map(([index, s]) => ({ index, id: s.id || `call_${round}_${index}`, name: s.name, arguments: s.arguments }));
    },
    get size() {
      return slots.size;
    },
  };
}

/** Аргументы вызова: пустая строка — «без аргументов», битый JSON или не объект — null (вызывающий вернёт модели ошибку). */
export function parseToolArguments(raw: string): Record<string, unknown> | null {
  const s = raw.trim();
  if (s === "") return {};
  try {
    const v: unknown = JSON.parse(s);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ---------- NDJSON событий ----------

/** Событие → одна строка NDJSON с переводом строки. JSON.stringify экранирует \n внутри текста, так что строка всегда одна. */
export const encodeEvent = (e: ChatEvent): string => `${JSON.stringify(e)}\n`;

const EVENT_TYPES = new Set<ChatEvent["t"]>(["start", "delta", "tool", "done", "error"]);

const isChatEvent = (v: unknown): v is ChatEvent =>
  v !== null && typeof v === "object" && EVENT_TYPES.has((v as { t?: unknown }).t as ChatEvent["t"]);

/**
 * Разбор накопленного буфера: полные строки → события, хвост без \n → rest (его нужно приклеить к следующему куску).
 * Сеть режет поток где угодно, в том числе посреди JSON и посреди многобайтной буквы — последнее решает
 * TextDecoder со stream: true на стороне читателя, здесь уже строки. Пустые и нечитаемые строки пропускаются:
 * одна битая строка не должна ронять весь ответ.
 */
export function decodeLines(buffer: string): { events: ChatEvent[]; rest: string } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    try {
      const v: unknown = JSON.parse(s);
      if (isChatEvent(v)) events.push(v);
    } catch {
      // пропускаем
    }
  }
  return { events, rest };
}

// ---------- Usage ----------

export const ZERO_USAGE: AssistantUsage = { prompt: 0, completion: 0, cached: 0 };

export const addUsage = (a: AssistantUsage, b: AssistantUsage): AssistantUsage => ({
  prompt: a.prompt + b.prompt,
  completion: a.completion + b.completion,
  cached: a.cached + b.cached,
});

/** usage из последнего чанка (include_usage) → наш формат; cached — подмножество prompt, как у OpenAI. */
export function usageFromProvider(u: unknown): AssistantUsage | null {
  if (!u || typeof u !== "object") return null;
  const r = u as { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } | null };
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
  if (r.prompt_tokens === undefined && r.completion_tokens === undefined) return null;
  return { prompt: n(r.prompt_tokens), completion: n(r.completion_tokens), cached: n(r.prompt_tokens_details?.cached_tokens) };
}

/** Картинка во входе: ≈ 1100 токенов (профиль сообщения, docs/AI-CHAT.md §1) — точнее без ответа провайдера не узнать. */
export const IMAGE_TOKENS_ESTIMATE = 1100;

/**
 * Оценка usage круга, когда стрим оборвался без последнего чанка: вход — по длине текста всех сообщений плюс
 * картинки, выход — по тому, что успело прийти. Для себестоимости лучше завышенная оценка, чем ноль.
 */
export function estimateRoundUsage(input: { promptText: string; images: number; completionText: string }): AssistantUsage {
  return {
    prompt: estimateTokens(input.promptText) + input.images * IMAGE_TOKENS_ESTIMATE,
    completion: estimateTokens(input.completionText),
    cached: 0,
  };
}
