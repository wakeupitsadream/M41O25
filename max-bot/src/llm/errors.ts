/**
 * Классификация сбоев провайдеров. От вида зависит, что делает роутер: переходит к следующей модели сразу
 * (bad_request, safety, too_large, empty) или ещё и ставит модель на паузу (квота, авторизация, перегрузка).
 */
export type ErrorKind =
  | "quota_day" // дневной/месячный лимит бесплатного тарифа
  | "rate_limit" // минутный лимит
  | "auth" // ключ неверный или отозван
  | "region" // провайдер не обслуживает регион сервера
  | "not_found" // модели нет (переименовали, убрали из бесплатных)
  | "bad_request" // запрос не подошёл этой модели (формат картинки, параметр)
  | "too_large" // слишком большой запрос
  | "overloaded" // 5xx, «model is overloaded»
  | "timeout"
  | "network"
  | "safety" // ответ заблокирован фильтром
  | "empty"; // пустой ответ

export class LlmError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly opts: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "LlmError";
  }
}

/** «33s», «1.5s», «2m59.56s», «120» → миллисекунды. */
export function parseDuration(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  let ms = 0;
  let matched = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    const v = Number(m[1]);
    ms += m[2] === "h" ? v * 3_600_000 : m[2] === "m" ? v * 60_000 : m[2] === "s" ? v * 1000 : v;
  }
  return matched ? Math.round(ms) : undefined;
}

const DAY_HINT = /per[ _-]?day|perday|daily|RPD|TPD|ByDay|86400|free-models-per-day|per month|monthly|quota exceeded for (?:the )?day/i;

/** Ошибка OpenAI-совместимого API → вид. */
export function classifyHttp(status: number, message: string, headers: Headers): LlmError {
  const retryAfterMs =
    parseDuration(headers.get("retry-after")) ??
    parseDuration(headers.get("x-ratelimit-reset-requests")) ??
    parseDuration(headers.get("x-ratelimit-reset-tokens"));
  const text = message.slice(0, 400);
  if (status === 429) {
    const day = DAY_HINT.test(message) || (retryAfterMs !== undefined && retryAfterMs > 15 * 60_000);
    return new LlmError(day ? "quota_day" : "rate_limit", text, { status, retryAfterMs });
  }
  if (status === 401 || status === 403) {
    if (/location|region|country|not available in your/i.test(message)) return new LlmError("region", text, { status });
    return new LlmError("auth", text, { status });
  }
  if (status === 402) return new LlmError("quota_day", text, { status, retryAfterMs });
  if (status === 404) return new LlmError("not_found", text, { status });
  if (status === 413) return new LlmError("too_large", text, { status });
  if (status === 400 || status === 422) {
    if (/context|too long|too large|maximum.*tokens|payload/i.test(message)) return new LlmError("too_large", text, { status });
    if (/location|region|country/i.test(message)) return new LlmError("region", text, { status });
    return new LlmError("bad_request", text, { status });
  }
  if (status === 408 || status === 504) return new LlmError("timeout", text, { status });
  if (status >= 500) return new LlmError("overloaded", text, { status, retryAfterMs });
  return new LlmError("bad_request", text, { status });
}

/** Ошибка fetch (таймаут/сеть) → вид. */
export function classifyThrown(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  const e = err as { name?: string; message?: string };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return new LlmError("timeout", "таймаут ответа модели");
  return new LlmError("network", e?.message ?? String(err));
}
