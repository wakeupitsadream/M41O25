import type { ProviderId } from "../config.js";
import { LlmError, classifyHttp, classifyThrown } from "./errors.js";
import type { GenerateRequest, LlmMessage, ModelInfo } from "./types.js";

/** OpenAI-совместимые провайдеры: один клиент, разные адреса. */
export function providerBase(provider: ProviderId, cloudflareAccountId: string): string | null {
  switch (provider) {
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "mistral":
      return "https://api.mistral.ai/v1";
    case "github":
      return "https://models.github.ai/inference";
    case "cerebras":
      return "https://api.cerebras.ai/v1";
    case "cloudflare":
      return cloudflareAccountId ? `https://api.cloudflare.com/client/v4/accounts/${cloudflareAccountId}/ai/v1` : null;
    default:
      return null;
  }
}

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

function toMessages(system: string, messages: LlmMessage[], systemRole: boolean) {
  const out: Array<{ role: string; content: string | ContentPart[] }> = systemRole ? [{ role: "system", content: system }] : [];
  for (const m of messages) {
    const parts: ContentPart[] = [];
    for (const p of m.parts) {
      if (p.type === "text") parts.push({ type: "text", text: p.text });
      else if (p.type === "image") parts.push({ type: "image_url", image_url: { url: `data:${p.mime};base64,${p.data.toString("base64")}` } });
      // Звук сюда не попадает: роутер выбирает для него только модели с audio=true (Gemini).
    }
    if (!parts.length) continue;
    // Текстовые реплики — строкой: часть провайдеров не принимает массив у роли assistant.
    const content = parts.every((p) => p.type === "text") ? parts.map((p) => (p as { text: string }).text).join("\n\n") : parts;
    out.push({ role: m.role, content });
  }
  if (!systemRole) {
    const first = out.find((m) => m.role === "user");
    const prefix = `Инструкции:\n${system}\n\n---\n`;
    if (first) first.content = typeof first.content === "string" ? prefix + first.content : [{ type: "text", text: prefix }, ...first.content];
  }
  return out;
}

type ChatResponse = {
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

const stripThinking = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

export async function callOpenAI(
  model: ModelInfo,
  req: GenerateRequest,
  conn: { base: string; key: string },
  opts: { fetch: typeof fetch; signal: AbortSignal },
): Promise<{ text: string; finishReason: string | null; usage: { input: number; output: number } | null }> {
  const system = typeof req.system === "function" ? req.system(model) : req.system;
  const body: Record<string, unknown> = {
    model: model.id,
    messages: toMessages(system, req.messages, model.systemRole),
    // У рассуждающих моделей (gpt-oss) размышления тоже входят в max_tokens.
    max_tokens: Math.min(
      req.maxOutputTokens + (model.thinking === "effort" && req.reasoning && req.reasoning !== "off" ? { low: 2048, medium: 6144, high: 12288 }[req.reasoning] : 0),
      model.maxOutputTokens,
    ),
    stream: false,
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.json && model.json) body.response_format = { type: "json_object" };
  if (model.thinking === "effort" && req.reasoning && req.reasoning !== "off") {
    if (model.provider === "openrouter") body.reasoning = { effort: req.reasoning };
    else body.reasoning_effort = req.reasoning;
  }
  const headers: Record<string, string> = { "content-type": "application/json", authorization: `Bearer ${conn.key}` };
  if (model.provider === "openrouter") headers["x-title"] = "MAX study bot";

  // Модели отличаются набором параметров: на явную жалобу убираем лишнее и повторяем (не больше трёх раз).
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await opts.fetch(`${conn.base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      throw classifyThrown(err);
    }
    const raw = await res.text().catch(() => "");
    let data: ChatResponse | null = null;
    try {
      data = raw ? (JSON.parse(raw) as ChatResponse) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const message = data?.error?.message ?? raw.slice(0, 300);
      if ((res.status === 400 || res.status === 422) && attempt < 3) {
        if (/max_completion_tokens/i.test(message) && "max_tokens" in body) {
          body.max_completion_tokens = body.max_tokens;
          delete body.max_tokens;
          continue;
        }
        if (/temperature/i.test(message) && "temperature" in body) {
          delete body.temperature;
          continue;
        }
        if (/reasoning/i.test(message) && ("reasoning_effort" in body || "reasoning" in body)) {
          delete body.reasoning_effort;
          delete body.reasoning;
          continue;
        }
        if (/response_format|json/i.test(message) && "response_format" in body) {
          delete body.response_format;
          continue;
        }
      }
      throw classifyHttp(res.status, message, res.headers);
    }
    const choice = data?.choices?.[0];
    const content = choice?.message?.content;
    const text = stripThinking(
      typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text ?? "").join("") : "",
    );
    const finishReason = choice?.finish_reason ?? null;
    if (!text) {
      if (finishReason === "content_filter") throw new LlmError("safety", "ответ заблокирован фильтром провайдера");
      throw new LlmError("empty", `пустой ответ (${finishReason ?? "нет choices"})`);
    }
    const u = data?.usage;
    return {
      text,
      finishReason,
      usage: u ? { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0 } : null,
    };
  }
}
