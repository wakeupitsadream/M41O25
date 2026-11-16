import { LlmError, classifyHttp, classifyThrown } from "./errors.js";
import { audioExtension } from "../max/media.js";
import type { GenerateRequest, ModelInfo } from "./types.js";

type Gemini = (
  model: ModelInfo,
  req: GenerateRequest,
  signal: AbortSignal,
) => Promise<{ text: string; finishReason: string | null; usage: { input: number; output: number } | null }>;

type Ctx = {
  key: string;
  cloudflareAccountId: string;
  fetch: typeof fetch;
  signal: AbortSignal;
  gemini: Gemini;
};

const TRANSCRIBE_PROMPT =
  "Ты — система распознавания речи. Запиши дословно, что сказано в аудио, на языке оригинала (обычно русский). " +
  "Без комментариев, без кавычек, без пометок о шуме. Расставь знаки препинания. Если речи нет — верни пустую строку.";

async function readError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } | string; errors?: Array<{ message?: string }> };
    if (typeof j.error === "string") return j.error;
    return j.error?.message ?? j.errors?.[0]?.message ?? raw.slice(0, 300);
  } catch {
    return raw.slice(0, 300);
  }
}

/** Whisper у Groq: multipart, расширение файла обязательно — по нему определяется формат. */
async function groqWhisper(model: ModelInfo, audio: { data: Buffer; mime: string }, ctx: Ctx): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio.data)], { type: audio.mime }), `voice.${audioExtension(audio.mime)}`);
  form.append("model", model.id);
  form.append("language", "ru");
  form.append("response_format", "json");
  form.append("temperature", "0");
  let res: Response;
  try {
    res = await ctx.fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.key}` },
      body: form,
      signal: ctx.signal,
    });
  } catch (err) {
    throw classifyThrown(err);
  }
  if (!res.ok) throw classifyHttp(res.status, await readError(res), res.headers);
  const json = (await res.json()) as { text?: string };
  return (json.text ?? "").trim();
}

/** Whisper в Cloudflare Workers AI: звук base64 в JSON. */
async function cloudflareWhisper(model: ModelInfo, audio: { data: Buffer; mime: string }, ctx: Ctx): Promise<string> {
  if (!ctx.cloudflareAccountId) throw new LlmError("auth", "нет CLOUDFLARE_ACCOUNT_ID");
  let res: Response;
  try {
    res = await ctx.fetch(`https://api.cloudflare.com/client/v4/accounts/${ctx.cloudflareAccountId}/ai/run/${model.id}`, {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.key}`, "content-type": "application/json" },
      body: JSON.stringify({ audio: audio.data.toString("base64"), language: "ru" }),
      signal: ctx.signal,
    });
  } catch (err) {
    throw classifyThrown(err);
  }
  if (!res.ok) throw classifyHttp(res.status, await readError(res), res.headers);
  const json = (await res.json()) as { result?: { text?: string } };
  return (json.result?.text ?? "").trim();
}

export async function transcribeWith(model: ModelInfo, audio: { data: Buffer; mime: string }, ctx: Ctx): Promise<string> {
  let text: string;
  if (model.provider === "groq") text = await groqWhisper(model, audio, ctx);
  else if (model.provider === "cloudflare") text = await cloudflareWhisper(model, audio, ctx);
  else if (model.provider === "gemini") {
    const r = await ctx.gemini(
      model,
      {
        system: TRANSCRIBE_PROMPT,
        messages: [{ role: "user", parts: [{ type: "audio", mime: audio.mime, data: audio.data }, { type: "text", text: "Транскрипция:" }] }],
        maxOutputTokens: 4096,
        temperature: 0,
        reasoning: "off",
      },
      ctx.signal,
    );
    text = r.text.trim();
  } else throw new LlmError("bad_request", `${model.provider} не умеет распознавать речь`);
  if (!text) throw new LlmError("empty", "в голосовом не распознано речи");
  return text;
}
