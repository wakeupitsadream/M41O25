import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../config.js";
import type { ModelState } from "../db/store.js";
import { CATALOG, modelFromKey } from "./catalog.js";
import { LlmError, classifyHttp, parseDuration } from "./errors.js";
import { callGemini, classifyGemini } from "./gemini.js";
import { callOpenAI } from "./openai.js";
import { AllModelsFailed, cooldownUntil, createRouter, describeFailure, fitForModel } from "./router.js";
import type { GenerateRequest } from "./types.js";

type Seen = { url: string; headers: Record<string, string>; body: any };

function fakeFetch(handler: (s: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fn = (async (input: URL | string, init?: RequestInit) => {
    const s: Seen = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    };
    seen.push(s);
    return handler(s);
  }) as typeof fetch;
  return { fn, seen };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const gemini38 = CATALOG["gemini:gemini-3.8-flash"]!;
const req: GenerateRequest = {
  system: (m) => `system for ${m.id}`,
  messages: [
    { role: "assistant", parts: [{ type: "text", text: "раньше" }] },
    { role: "user", parts: [{ type: "image", mime: "image/jpeg", data: Buffer.from([1, 2, 3]) }, { type: "text", text: "реши" }] },
  ],
  maxOutputTokens: 1000,
  temperature: 0.2,
  reasoning: "high",
};

test("parseDuration", () => {
  assert.equal(parseDuration("33s"), 33_000);
  assert.equal(parseDuration("1.5s"), 1_500);
  assert.equal(parseDuration("2m59.56s"), 179_560);
  assert.equal(parseDuration("120"), 120_000);
  assert.equal(parseDuration("250ms"), 250);
  assert.equal(parseDuration(""), undefined);
});

test("Gemini: ключ в заголовке, мысли отброшены, системная инструкция, роли чередуются", async () => {
  const { fn, seen } = fakeFetch(() =>
    json(200, {
      candidates: [{ content: { parts: [{ text: "думаю…", thought: true }, { text: "**Ответ:** 4" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 50 },
    }),
  );
  const r = await callGemini(gemini38, req, "KEY", { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(r.text, "**Ответ:** 4");
  assert.deepEqual(r.usage, { input: 10, output: 55 });
  const s = seen[0]!;
  assert.match(s.url, /models\/gemini-3\.8-flash:generateContent$/);
  assert.equal(s.headers["x-goog-api-key"], "KEY");
  assert.ok(!s.url.includes("KEY"), "ключ не в URL");
  assert.equal(s.body.systemInstruction.parts[0].text, "system for gemini-3.8-flash");
  assert.equal(s.body.contents[0].role, "user", "диалог начинается с user");
  assert.deepEqual(s.body.contents.map((c: any) => c.role), ["user", "model", "user"]);
  assert.equal(s.body.contents[2].parts[0].inlineData.mimeType, "image/jpeg");
  assert.equal(s.body.generationConfig.thinkingConfig.thinkingLevel, "high");
});

test("Gemini: 400 про thinking — повтор без настройки размышлений", async () => {
  let n = 0;
  const { fn, seen } = fakeFetch(() =>
    n++ === 0
      ? json(400, { error: { code: 400, status: "INVALID_ARGUMENT", message: "thinking_level is not supported for this model" } })
      : json(200, { candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }] }),
  );
  const r = await callGemini(gemini38, req, "K", { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(r.text, "ok");
  assert.equal(seen[1]!.body.generationConfig.thinkingConfig, undefined);
});

test("Gemini: Gemma без системной роли получает инструкции в первом сообщении", async () => {
  const { fn, seen } = fakeFetch(() => json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
  await callGemini(CATALOG["gemini:gemma-4-31b-it"]!, req, "K", { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(seen[0]!.body.systemInstruction, undefined);
  assert.match(seen[0]!.body.contents[0].parts[0].text, /^Инструкции:\nsystem for gemma/);
});

test("Gemini: классификация ошибок — дневная и минутная квота, ключ, регион, перегрузка", () => {
  const day = classifyGemini(429, {
    error: {
      status: "RESOURCE_EXHAUSTED",
      message: "You exceeded your current quota",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "40s" },
      ],
    },
  });
  assert.equal(day.kind, "quota_day");
  const minute = classifyGemini(429, {
    error: {
      status: "RESOURCE_EXHAUSTED",
      message: "quota",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "17s" },
      ],
    },
  });
  assert.equal(minute.kind, "rate_limit");
  assert.equal(minute.opts.retryAfterMs, 17_000);
  assert.equal(
    classifyGemini(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }).kind,
    "auth",
  );
  assert.equal(classifyGemini(400, { error: { status: "FAILED_PRECONDITION", message: "User location is not supported for the API use." } }).kind, "region");
  assert.equal(classifyGemini(503, { error: { status: "UNAVAILABLE", message: "The model is overloaded." } }).kind, "overloaded");
  assert.equal(classifyGemini(404, { error: { status: "NOT_FOUND", message: "models/x is not found" } }).kind, "not_found");
});

test("Gemini: пустой ответ из-за фильтра — safety, просто пустой — empty", async () => {
  const blocked = fakeFetch(() => json(200, { candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }] }));
  await assert.rejects(callGemini(gemini38, req, "K", { fetch: blocked.fn, signal: AbortSignal.timeout(5000) }), (e: unknown) => (e as LlmError).kind === "safety");
  const empty = fakeFetch(() => json(200, { candidates: [] }));
  await assert.rejects(callGemini(gemini38, req, "K", { fetch: empty.fn, signal: AbortSignal.timeout(5000) }), (e: unknown) => (e as LlmError).kind === "empty");
});

test("OpenAI-совместимый: картинки data-URL, system, <think> вырезается, лишние параметры убираются по жалобе", async () => {
  let n = 0;
  const { fn, seen } = fakeFetch(() => {
    n++;
    if (n === 1) return json(400, { error: { message: "Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead." } });
    if (n === 2) return json(400, { error: { message: "Unsupported value: 'temperature' does not support 0.2" } });
    return json(200, { choices: [{ message: { content: "<think>хм</think>Ответ: 4" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
  });
  const r = await callOpenAI(CATALOG["mistral:mistral-medium-latest"]!, req, { base: "https://api.mistral.ai/v1", key: "TOK" }, { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(r.text, "Ответ: 4");
  assert.equal(seen[0]!.headers.authorization, "Bearer TOK");
  assert.equal(seen[0]!.body.messages[0].role, "system");
  const user = seen[0]!.body.messages[2];
  assert.equal(user.content[0].type, "image_url");
  assert.match(user.content[0].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(seen[2]!.body.max_completion_tokens, 1000);
  assert.equal(seen[2]!.body.max_tokens, undefined);
  assert.equal(seen[2]!.body.temperature, undefined);
});

test("OpenAI-совместимый: классификация 429 — дневной лимит и минутный", () => {
  assert.equal(classifyHttp(429, "Rate limit exceeded: free-models-per-day", new Headers()).kind, "quota_day");
  assert.equal(classifyHttp(429, "Rate limit reached for model on requests per day (RPD): Limit 1000", new Headers()).kind, "quota_day");
  assert.equal(classifyHttp(429, "Rate limit of 50 per 86400s exceeded for UserByModelByDay", new Headers({ "retry-after": "3600" })).kind, "quota_day");
  const minute = classifyHttp(429, "tokens per minute (TPM): Limit 6000", new Headers({ "retry-after": "7" }));
  assert.equal(minute.kind, "rate_limit");
  assert.equal(minute.opts.retryAfterMs, 7000);
  assert.equal(classifyHttp(401, "Invalid API Key", new Headers()).kind, "auth");
  assert.equal(classifyHttp(403, "Groq is not available in your country", new Headers()).kind, "region");
  assert.equal(classifyHttp(413, "too big", new Headers()).kind, "too_large");
});

test("cooldownUntil: Gemini ждёт полуночи по LA, остальные — UTC или retry-after", () => {
  const now = new Date("2026-10-08T10:00:00Z");
  assert.equal(cooldownUntil(gemini38, new LlmError("quota_day", "x"), now, false)?.toISOString(), "2026-10-09T07:00:00.000Z");
  const groq = CATALOG["groq:openai/gpt-oss-120b"]!;
  assert.equal(cooldownUntil(groq, new LlmError("quota_day", "x"), now, false)?.toISOString(), "2026-10-09T00:00:00.000Z");
  assert.equal(cooldownUntil(groq, new LlmError("quota_day", "x", { retryAfterMs: 3_600_000 }), now, false)?.toISOString(), "2026-10-08T11:00:00.000Z");
  assert.equal(cooldownUntil(groq, new LlmError("rate_limit", "x", { retryAfterMs: 1000 }), now, false)?.toISOString(), "2026-10-08T10:00:05.000Z");
  assert.equal(cooldownUntil(groq, new LlmError("bad_request", "x"), now, false), null);
  assert.equal(cooldownUntil(groq, new LlmError("timeout", "x"), now, false), null, "свой короткий таймаут — не вина модели");
});

test("modelFromKey: своя модель из env с флагами", () => {
  const m = modelFromKey("openrouter:qwen/qwen2.5-vl-72b-instruct:free#vision")!;
  assert.equal(m.provider, "openrouter");
  assert.equal(m.id, "qwen/qwen2.5-vl-72b-instruct:free");
  assert.equal(m.vision, true);
  assert.equal(modelFromKey("unknown:x"), null);
  assert.equal(modelFromKey("gemini:gemini-3.5-flash")!.label, "Gemini 3.5 Flash");
});

function memoryStates() {
  const states = new Map<string, ModelState>();
  return {
    states,
    store: {
      modelStates: async () => new Map(states),
      recordModel: async (model: string, day: string, r: { ok: true } | { ok: false; cooldownUntil: Date | null; reason: string; error: string }) => {
        const prev = states.get(model);
        states.set(model, {
          model,
          day,
          cooldownUntil: r.ok ? null : r.cooldownUntil,
          reason: r.ok ? null : r.reason,
          lastError: r.ok ? (prev?.lastError ?? null) : r.error,
          lastOkAt: r.ok ? new Date() : (prev?.lastOkAt ?? null),
          okCount: (prev?.okCount ?? 0) + (r.ok ? 1 : 0),
          failCount: (prev?.failCount ?? 0) + (r.ok ? 0 : 1),
        });
      },
    },
  };
}

test("роутер: пропускает модели без ключа и без зрения, при дневной квоте ставит паузу и идёт дальше", async () => {
  const config = loadConfig({
    GEMINI_API_KEY: "g",
    GROQ_API_KEY: "q",
    CHAIN_SOLVE: "gemini:gemini-3.8-flash,groq:openai/gpt-oss-120b,mistral:mistral-medium-latest,gemini:gemini-3.6-flash",
  });
  const mem = memoryStates();
  const { fn, seen } = fakeFetch((s) => {
    if (s.url.includes("gemini-3.8-flash")) {
      return json(429, {
        error: {
          status: "RESOURCE_EXHAUSTED",
          message: "quota",
          details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }],
        },
      });
    }
    return json(200, { candidates: [{ content: { parts: [{ text: "решено" }] }, finishReason: "STOP" }] });
  });
  const router = createRouter({ config, store: mem.store, fetch: fn, now: () => new Date("2026-10-08T10:00:00Z") });
  const r = await router.generate("solve", req, { deadline: Date.now() + 60_000 });
  assert.equal(r.model.key, "gemini:gemini-3.6-flash", "gpt-oss без зрения и mistral без ключа пропущены");
  assert.equal(seen.length, 2);
  const st = mem.states.get("gemini:gemini-3.8-flash")!;
  assert.equal(st.reason, "quota_day");
  assert.equal(st.cooldownUntil?.toISOString(), "2026-10-09T07:00:00.000Z");

  // Второй запрос не тратит время на модель на паузе.
  const r2 = await router.generate("solve", req, { deadline: Date.now() + 60_000 });
  assert.equal(r2.model.key, "gemini:gemini-3.6-flash");
  assert.equal(seen.length, 3);
});

test("роутер: все упали — AllModelsFailed с причинами и понятным текстом", async () => {
  const config = loadConfig({ GEMINI_API_KEY: "g", CHAIN_CHAT: "gemini:gemini-3.5-flash-lite,groq:moonshotai/kimi-k2-instruct-0905" });
  const mem = memoryStates();
  const { fn } = fakeFetch(() => json(503, { error: { status: "UNAVAILABLE", message: "The model is overloaded." } }));
  const router = createRouter({ config, store: mem.store, fetch: fn, now: () => new Date("2026-10-08T10:00:00Z") });
  const textReq: GenerateRequest = { system: "s", messages: [{ role: "user", parts: [{ type: "text", text: "привет" }] }], maxOutputTokens: 100 };
  await assert.rejects(router.generate("chat", textReq, { deadline: Date.now() + 60_000 }), (e: unknown) => {
    assert.ok(e instanceof AllModelsFailed);
    assert.equal(e.attempts.length, 1);
    assert.equal(e.attempts[0]!.kind, "overloaded");
    const text = describeFailure(e, new Date("2026-10-08T10:00:00Z"), "Asia/Yekaterinburg");
    assert.match(text, /Gemini 3\.5 Flash-Lite: перегружена/);
    assert.match(text, /без ключа: groq/);
    return true;
  });
});

test("роутер: пауза из-за ключа снимается, когда ключ в env поменяли", async () => {
  const mem = memoryStates();
  const { fn } = fakeFetch(() => json(400, { error: { status: "INVALID_ARGUMENT", message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] } }));
  const chain = { CHAIN_LIGHT: "gemini:gemini-3.5-flash-lite" };
  const textReq: GenerateRequest = { system: "s", messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxOutputTokens: 100 };
  const r1 = createRouter({ config: loadConfig({ GEMINI_API_KEY: "old", ...chain }), store: mem.store, fetch: fn });
  await assert.rejects(r1.generate("light", textReq, { deadline: Date.now() + 60_000 }));
  assert.match(mem.states.get("gemini:gemini-3.5-flash-lite")!.reason!, /^auth:/);

  const ok = fakeFetch(() => json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
  const same = createRouter({ config: loadConfig({ GEMINI_API_KEY: "old", ...chain }), store: mem.store, fetch: ok.fn });
  await assert.rejects(same.generate("light", textReq, { deadline: Date.now() + 60_000 }), "тот же ключ — пауза держится");
  const fresh = createRouter({ config: loadConfig({ GEMINI_API_KEY: "new", ...chain }), store: mem.store, fetch: ok.fn });
  const r = await fresh.generate("light", textReq, { deadline: Date.now() + 60_000 });
  assert.equal(r.text, "ok");
});

test("роутер: голос — Groq Whisper multipart с расширением файла, при сбое — Gemini", async () => {
  const config = loadConfig({ GEMINI_API_KEY: "g", GROQ_API_KEY: "q" });
  const mem = memoryStates();
  const { fn, seen } = fakeFetch(async (s) => {
    if (s.url.includes("groq.com")) {
      const form = s.body as FormData;
      const file = form.get("file") as File;
      assert.equal(file.name, "voice.ogg");
      assert.equal(form.get("language"), "ru");
      return json(500, { error: { message: "internal" } });
    }
    return json(200, { candidates: [{ content: { parts: [{ text: "привет, реши задачу" }] } }] });
  });
  const router = createRouter({ config, store: mem.store, fetch: fn });
  const r = await router.transcribe({ data: Buffer.from("OggS"), mime: "audio/ogg" }, { deadline: Date.now() + 60_000 });
  assert.equal(r.text, "привет, реши задачу");
  assert.equal(r.model.key, "gemini:gemini-3.5-flash-lite");
  assert.equal(seen.filter((s) => s.url.includes("groq.com")).length, 2, "обе модели Whisper у Groq");
  assert.equal(seen.at(-1)!.body.contents[0].parts[0].inlineData.mimeType, "audio/ogg");
});

test("роутер: m4a не уходит в Gemini (формат не поддерживается) — только Whisper", async () => {
  const config = loadConfig({ GEMINI_API_KEY: "g" });
  const mem = memoryStates();
  const { fn, seen } = fakeFetch(() => json(200, {}));
  const router = createRouter({ config, store: mem.store, fetch: fn });
  await assert.rejects(router.transcribe({ data: Buffer.from("x"), mime: "audio/mp4" }, { deadline: Date.now() + 60_000 }), AllModelsFailed);
  assert.equal(seen.length, 0);
});

test("регрессия: Gemini получает запас токенов на размышления сверх длины ответа и высокое разрешение фото", async () => {
  const { fn, seen } = fakeFetch(() => json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] }));
  await callGemini(gemini38, { ...req, maxOutputTokens: 9000, reasoning: "high" }, "K", { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(seen[0]!.body.generationConfig.thinkingConfig.thinkingLevel, "high");
  assert.equal(seen[0]!.body.generationConfig.maxOutputTokens, 9000 + 16384);
  assert.equal(seen[0]!.body.generationConfig.mediaResolution, "MEDIA_RESOLUTION_HIGH");
  await callGemini(gemini38, { ...req, maxOutputTokens: 30000, reasoning: "high" }, "K", { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(seen[1]!.body.generationConfig.maxOutputTokens, 32768, "не больше потолка модели");
  const textOnly: GenerateRequest = { system: "s", messages: [{ role: "user", parts: [{ type: "text", text: "x" }] }], maxOutputTokens: 100 };
  await callGemini(gemini38, textOnly, "K", { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(seen[2]!.body.generationConfig.mediaResolution, undefined, "без фото разрешение не задаём");
});

test("Gemini: 400 про разрешение — повтор без mediaResolution", async () => {
  let n = 0;
  const { fn, seen } = fakeFetch(() =>
    n++ === 0
      ? json(400, { error: { status: "INVALID_ARGUMENT", message: "media_resolution is not supported for this model" } })
      : json(200, { candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
  );
  assert.equal((await callGemini(gemini38, req, "K", { fetch: fn, signal: AbortSignal.timeout(5000) })).text, "ok");
  assert.equal(seen[1]!.body.generationConfig.mediaResolution, undefined);
  assert.ok(seen[1]!.body.generationConfig.thinkingConfig, "размышления остались");
});

test("Groq (8K токенов в минуту): старая история подрезается, max_tokens — по остатку, огромный вопрос — пропуск", async () => {
  const groq = CATALOG["groq:openai/gpt-oss-120b"]!;
  const long = "очень длинное сообщение ".repeat(400);
  const history: GenerateRequest["messages"] = Array.from({ length: 10 }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    parts: [{ type: "text", text: long }],
  }));
  const r = fitForModel(groq, { system: "s", messages: [...history, { role: "user", parts: [{ type: "text", text: "вопрос" }] }], maxOutputTokens: 9000, reasoning: "high" })!;
  assert.ok(r.messages.length < 11 && r.messages.at(-1)!.parts[0]!.type === "text");
  assert.equal(r.messages[0]!.role, "user");
  assert.ok(r.outputCap! >= 512 && r.outputCap! <= 8000);
  assert.equal(fitForModel(groq, { system: "s", messages: [{ role: "user", parts: [{ type: "text", text: long.repeat(5) }] }], maxOutputTokens: 100 }), null);

  const { fn, seen } = fakeFetch(() => json(200, { choices: [{ message: { content: "ok" } }] }));
  await callOpenAI(groq, { ...r, maxOutputTokens: 9000, reasoning: "high" }, { base: "https://api.groq.com/openai/v1", key: "k" }, { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(seen[0]!.body.max_tokens, r.outputCap);
  assert.equal(seen[0]!.body.reasoning_effort, "high");
  assert.equal(fitForModel(CATALOG["gemini:gemini-3.8-flash"]!, r), r, "без tpm запрос не трогаем");
});

test("Groq Qwen: reasoning_format=hidden, а если не принят — повтор без него", async () => {
  let n = 0;
  const { fn, seen } = fakeFetch(() =>
    n++ === 0 ? json(400, { error: { message: "'reasoning_format' is not supported with this model" } }) : json(200, { choices: [{ message: { content: "ok" } }] }),
  );
  const qwen = CATALOG["groq:qwen/qwen3.8-27b"]!;
  await callOpenAI(qwen, req, { base: "https://api.groq.com/openai/v1", key: "k" }, { fetch: fn, signal: AbortSignal.timeout(5000) });
  assert.equal(seen[0]!.body.reasoning_format, "hidden");
  assert.equal(seen[1]!.body.reasoning_format, undefined);
});
