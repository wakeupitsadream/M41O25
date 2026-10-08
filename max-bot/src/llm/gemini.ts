import { LlmError, classifyThrown, parseDuration } from "./errors.js";
import type { GenerateRequest, LlmMessage, ModelInfo, Reasoning } from "./types.js";

/**
 * Gemini через родной REST (generateContent), а не через OpenAI-совместимый слой: только здесь ошибка 429
 * говорит, какая квота кончилась (дневная или минутная) и через сколько повторять, и только здесь звук
 * принимается в любом из форматов Gemini. Ключ — в заголовке x-goog-api-key, чтобы не светиться в URL и логах.
 */

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Форматы звука, которые Gemini принимает inline. */
export const GEMINI_AUDIO = new Set(["audio/wav", "audio/mpeg", "audio/mp3", "audio/aiff", "audio/aac", "audio/ogg", "audio/flac"]);

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

function toContents(messages: LlmMessage[]) {
  const contents: { role: "user" | "model"; parts: GeminiPart[] }[] = [];
  for (const m of messages) {
    const parts: GeminiPart[] = m.parts.map((p) =>
      p.type === "text" ? { text: p.text } : { inlineData: { mimeType: p.mime, data: p.data.toString("base64") } },
    );
    if (!parts.length) continue;
    const role = m.role === "assistant" ? "model" : "user";
    const prev = contents[contents.length - 1];
    // Gemini требует чередования ролей: подряд идущие реплики одной роли склеиваем.
    if (prev && prev.role === role) prev.parts.push(...parts);
    else contents.push({ role, parts });
  }
  if (contents[0]?.role === "model") contents.unshift({ role: "user", parts: [{ text: "(начало диалога)" }] });
  return contents;
}

const BUDGET: Record<Reasoning, number> = { off: 0, low: 1024, medium: 4096, high: 12288 };
const LEVEL: Record<Reasoning, string> = { off: "low", low: "low", medium: "medium", high: "high" };
/** Сколько токенов размышлений добавить к лимиту ответа: мысли считаются в maxOutputTokens. */
const LEVEL_ALLOWANCE: Record<Reasoning, number> = { off: 2048, low: 2048, medium: 8192, high: 16384 };

export function thinkingAllowance(model: ModelInfo, reasoning: Reasoning | undefined): number {
  if (model.thinking === "budget") return reasoning ? BUDGET[reasoning] : 8192;
  if (model.thinking === "level") return LEVEL_ALLOWANCE[reasoning ?? "medium"];
  return 0;
}

export function thinkingConfig(model: ModelInfo, reasoning: Reasoning | undefined): Record<string, unknown> | undefined {
  if (!reasoning) return undefined;
  if (model.thinking === "budget") return { thinkingBudget: BUDGET[reasoning] };
  if (model.thinking === "level") return { thinkingLevel: LEVEL[reasoning] };
  return undefined;
}

const SAFETY = ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"].map(
  (category) => ({ category, threshold: "BLOCK_ONLY_HIGH" }),
);

type GeminiError = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      "@type"?: string;
      retryDelay?: string;
      reason?: string;
      violations?: Array<{ quotaId?: string; quotaMetric?: string; quotaValue?: string }>;
    }>;
  };
};

export function classifyGemini(status: number, body: GeminiError): LlmError {
  const err = body.error ?? {};
  const message = (err.message ?? `HTTP ${status}`).slice(0, 400);
  const details = err.details ?? [];
  const retry = details.find((d) => d["@type"]?.endsWith("google.rpc.RetryInfo"));
  const retryAfterMs = parseDuration(retry?.retryDelay);
  const quotaIds = details.flatMap((d) => (d.violations ?? []).map((v) => `${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`));
  const reasons = details.map((d) => d.reason ?? "").join(" ");

  if (status === 429 || err.status === "RESOURCE_EXHAUSTED") {
    const daily = quotaIds.some((q) => /PerDay/i.test(q)) || /per day|daily/i.test(message);
    return new LlmError(daily ? "quota_day" : "rate_limit", message, { status, retryAfterMs });
  }
  if (/API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED|leaked/i.test(`${reasons} ${message}`)) {
    return new LlmError("auth", message, { status });
  }
  if (/location is not supported|not available in your country|FAILED_PRECONDITION/i.test(`${message} ${err.status ?? ""}`)) {
    return new LlmError("region", message, { status });
  }
  if (status === 401 || status === 403) return new LlmError("auth", message, { status });
  if (status === 404) return new LlmError("not_found", message, { status });
  if (status === 413 || /payload size|request.*too large|exceeds the maximum/i.test(message)) {
    return new LlmError("too_large", message, { status });
  }
  if (status === 400) return new LlmError("bad_request", message, { status });
  if (status === 504) return new LlmError("timeout", message, { status });
  if (status >= 500) return new LlmError("overloaded", message, { status, retryAfterMs });
  return new LlmError("bad_request", message, { status });
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
};

export async function callGemini(
  model: ModelInfo,
  req: GenerateRequest,
  key: string,
  opts: { fetch: typeof fetch; signal: AbortSignal },
): Promise<{ text: string; finishReason: string | null; usage: { input: number; output: number } | null }> {
  const system = typeof req.system === "function" ? req.system(model) : req.system;
  // Размышления Gemini расходуют тот же лимит, что и ответ: без запаса трудная задача кончается пустым MAX_TOKENS.
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: Math.min(req.maxOutputTokens + thinkingAllowance(model, req.reasoning), model.maxOutputTokens),
  };
  if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
  if (req.json && model.json) generationConfig.responseMimeType = "application/json";
  const thinking = thinkingConfig(model, req.reasoning);
  if (thinking) generationConfig.thinkingConfig = thinking;

  const contents = toContents(req.messages);
  if (!model.systemRole) contents[0]?.parts.unshift({ text: `Инструкции:\n${system}\n\n---\n` });
  const body: Record<string, unknown> & { generationConfig: Record<string, unknown> } = {
    ...(model.systemRole ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig,
    safetySettings: SAFETY,
  };

  const send = async (payload: Record<string, unknown>) => {
    let res: Response;
    try {
      res = await opts.fetch(`${GEMINI_BASE}/models/${encodeURIComponent(model.id)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(payload),
        signal: opts.signal,
      });
    } catch (err) {
      throw classifyThrown(err);
    }
    const text = await res.text().catch(() => "");
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw classifyGemini(res.status, (json ?? { error: { message: text.slice(0, 300) } }) as GeminiError);
    return json as GeminiResponse;
  };

  let data: GeminiResponse;
  try {
    data = await send(body);
  } catch (err) {
    // Модель не знает этот вид настройки размышления — повторяем без неё, а не теряем модель.
    if (err instanceof LlmError && err.kind === "bad_request" && thinking && /thinking/i.test(err.message)) {
      const { thinkingConfig: _drop, ...rest } = generationConfig;
      data = await send({ ...body, generationConfig: rest });
    } else throw err;
  }

  if (data.promptFeedback?.blockReason) throw new LlmError("safety", `запрос заблокирован: ${data.promptFeedback.blockReason}`);
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("")
    .trim();
  const finishReason = cand?.finishReason ?? null;
  if (!text) {
    if (finishReason && /SAFETY|PROHIBITED|BLOCKLIST|SPII|RECITATION/.test(finishReason)) {
      throw new LlmError("safety", `ответ заблокирован: ${finishReason}`);
    }
    throw new LlmError("empty", `пустой ответ (${finishReason ?? "нет кандидатов"})`);
  }
  const u = data.usageMetadata;
  return {
    text,
    finishReason,
    usage: u ? { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } : null,
  };
}
