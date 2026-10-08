import { PROVIDERS, type ProviderId, type Task } from "../config.js";
import type { ModelInfo, ThinkingControl } from "./types.js";

const MB = 1024 * 1024;
const COMMON_IMAGES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
const GEMINI_IMAGES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

type Spec = Partial<Omit<ModelInfo, "key" | "provider" | "id">> & { label: string };

function model(provider: ProviderId, id: string, spec: Spec): ModelInfo {
  return {
    key: `${provider}:${id}`,
    provider,
    id,
    vision: false,
    audio: false,
    thinking: "none",
    thinks: false,
    tier: 3,
    timeoutMs: 60_000,
    maxOutputTokens: 8192,
    maxImages: 0,
    maxImageBytes: 0,
    imageMimes: COMMON_IMAGES,
    json: false,
    systemRole: true,
    ...spec,
  };
}

const gemini = (id: string, spec: Spec) =>
  model("gemini", id, {
    vision: true,
    audio: true,
    json: true,
    maxImages: 16,
    maxImageBytes: 15 * MB,
    imageMimes: GEMINI_IMAGES,
    maxOutputTokens: 32_768,
    ...spec,
  });

/**
 * Модели бесплатных тарифов (октябрь 2026, см. docs/MODELS.md). Порядок в цепочках — от сильной к запасным;
 * роутер сам пропускает модели без ключа, без зрения (для фото) и стоящие на паузе после лимита.
 */
const MODELS: ModelInfo[] = [
  // Google AI Studio — основной провайдер: лучшее зрение и русский, но маленькие дневные квоты.
  gemini("gemini-3.5-flash", { label: "Gemini 3.5 Flash", thinking: "level", thinks: true, tier: 1, timeoutMs: 150_000 }),
  gemini("gemini-2.5-pro", { label: "Gemini 2.5 Pro", thinking: "budget", thinks: true, tier: 1, timeoutMs: 150_000 }),
  gemini("gemini-2.5-flash", { label: "Gemini 2.5 Flash", thinking: "budget", thinks: true, tier: 2, timeoutMs: 120_000 }),
  gemini("gemini-3.5-flash-lite", { label: "Gemini 3.5 Flash-Lite", thinking: "level", thinks: true, tier: 2, timeoutMs: 90_000 }),
  gemini("gemini-2.5-flash-lite", { label: "Gemini 2.5 Flash-Lite", thinking: "budget", tier: 3, timeoutMs: 60_000 }),
  // Gemma через тот же ключ: квоты большие, системной роли нет.
  gemini("gemma-3-27b-it", { label: "Gemma 3 27B", audio: false, json: false, systemRole: false, maxOutputTokens: 8192, tier: 3, timeoutMs: 90_000 }),

  // Groq — быстро и щедро по запросам; зрение у Llama 4, рассуждения у gpt-oss.
  model("groq", "openai/gpt-oss-120b", { label: "GPT-OSS 120B (Groq)", thinking: "effort", thinks: true, tier: 2, timeoutMs: 90_000, json: true, maxOutputTokens: 32_768 }),
  model("groq", "meta-llama/llama-4-maverick-17b-128e-instruct", {
    label: "Llama 4 Maverick (Groq)",
    vision: true,
    maxImages: 5,
    maxImageBytes: 3 * MB,
    tier: 2,
    json: true,
  }),
  model("groq", "meta-llama/llama-4-scout-17b-16e-instruct", { label: "Llama 4 Scout (Groq)", vision: true, maxImages: 5, maxImageBytes: 3 * MB, json: true }),
  model("groq", "moonshotai/kimi-k2-instruct-0905", { label: "Kimi K2 (Groq)", tier: 2, json: true }),
  model("groq", "whisper-large-v3-turbo", { label: "Whisper (Groq)", audio: true, timeoutMs: 60_000 }),

  // Cerebras — очень быстрый текст.
  model("cerebras", "gpt-oss-120b", { label: "GPT-OSS 120B (Cerebras)", thinking: "effort", thinks: true, tier: 2, timeoutMs: 90_000, maxOutputTokens: 32_768 }),
  model("cerebras", "qwen-3-235b-a22b-instruct-2507", { label: "Qwen3 235B (Cerebras)", tier: 2 }),

  // Mistral — бесплатный тариф Experiment, зрение у Medium/Small.
  model("mistral", "mistral-medium-latest", { label: "Mistral Medium", vision: true, maxImages: 8, maxImageBytes: 10 * MB, tier: 2, json: true, timeoutMs: 90_000 }),
  model("mistral", "mistral-small-latest", { label: "Mistral Small", vision: true, maxImages: 8, maxImageBytes: 10 * MB, json: true }),

  // GitHub Models — бесплатно с аккаунтом GitHub, жёсткие дневные лимиты.
  model("github", "openai/gpt-4.1", { label: "GPT-4.1 (GitHub)", vision: true, maxImages: 5, maxImageBytes: 8 * MB, tier: 2, json: true, maxOutputTokens: 4000 }),
  model("github", "openai/gpt-4.1-mini", { label: "GPT-4.1 mini (GitHub)", vision: true, maxImages: 5, maxImageBytes: 8 * MB, json: true, maxOutputTokens: 4000 }),

  // OpenRouter — бесплатные модели с суффиксом :free (50 запросов в сутки на аккаунт).
  model("openrouter", "openrouter/free", { label: "OpenRouter Free", vision: true, maxImages: 4, maxImageBytes: 5 * MB }),

  // Cloudflare Workers AI — 10 000 «нейронов» в сутки.
  model("cloudflare", "@cf/meta/llama-4-scout-17b-16e-instruct", {
    label: "Llama 4 Scout (Cloudflare)",
    vision: true,
    maxImages: 1,
    maxImageBytes: 4 * MB,
  }),
  model("cloudflare", "@cf/openai/whisper-large-v3-turbo", { label: "Whisper (Cloudflare)", audio: true }),
];

export const CATALOG: Record<string, ModelInfo> = Object.fromEntries(MODELS.map((m) => [m.key, m]));

export const DEFAULT_CHAINS: Record<Task, string[]> = {
  // Задачи, проверка решений, билеты, репетитор. Для фото текстовые модели пропускаются автоматически.
  solve: [
    "gemini:gemini-3.5-flash",
    "gemini:gemini-2.5-pro",
    "gemini:gemini-2.5-flash",
    "groq:openai/gpt-oss-120b",
    "cerebras:gpt-oss-120b",
    "gemini:gemini-3.5-flash-lite",
    "mistral:mistral-medium-latest",
    "github:openai/gpt-4.1",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "gemini:gemini-2.5-flash-lite",
    "gemini:gemma-3-27b-it",
    "openrouter:openrouter/free",
    "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct",
  ],
  // Распознавание заданий, конспект, текст с фото: нужна точная читка, а не глубокие рассуждения.
  vision: [
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-2.5-flash",
    "gemini:gemini-2.5-flash-lite",
    "mistral:mistral-medium-latest",
    "github:openai/gpt-4.1-mini",
    "gemini:gemma-3-27b-it",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "openrouter:openrouter/free",
    "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct",
  ],
  // Болталка: быстро и с запасом по квотам; модели со зрением — для «Обсудить фото».
  chat: [
    "gemini:gemini-3.5-flash-lite",
    "groq:moonshotai/kimi-k2-instruct-0905",
    "gemini:gemini-2.5-flash",
    "cerebras:qwen-3-235b-a22b-instruct-2507",
    "mistral:mistral-small-latest",
    "github:openai/gpt-4.1-mini",
    "groq:meta-llama/llama-4-maverick-17b-128e-instruct",
    "gemini:gemini-2.5-flash-lite",
    "openrouter:openrouter/free",
  ],
  // Короче/проще, вопросы для самопроверки, резюме истории.
  light: [
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-2.5-flash-lite",
    "groq:moonshotai/kimi-k2-instruct-0905",
    "cerebras:qwen-3-235b-a22b-instruct-2507",
    "groq:openai/gpt-oss-120b",
    "mistral:mistral-small-latest",
    "github:openai/gpt-4.1-mini",
    "gemini:gemma-3-27b-it",
    "openrouter:openrouter/free",
  ],
  transcribe: [
    "groq:whisper-large-v3-turbo",
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-2.5-flash-lite",
    "gemini:gemini-2.5-flash",
    "cloudflare:@cf/openai/whisper-large-v3-turbo",
  ],
};

/**
 * Модель из переменной CHAIN_* , которой нет в каталоге: «provider:id#vision,think». Флаги после # —
 * vision (принимает фото), think (рассуждающая, reasoning_effort), audio (Gemini).
 */
export function modelFromKey(key: string): ModelInfo | null {
  const [main = "", flagsRaw = ""] = key.split("#");
  const idx = main.indexOf(":");
  if (idx <= 0) return null;
  const provider = main.slice(0, idx) as ProviderId;
  const id = main.slice(idx + 1);
  if (!(PROVIDERS as readonly string[]).includes(provider) || !id) return null;
  const known = CATALOG[`${provider}:${id}`];
  const flags = new Set(flagsRaw.split(",").map((f) => f.trim()).filter(Boolean));
  const thinking: ThinkingControl = flags.has("think") ? (provider === "gemini" ? "budget" : "effort") : "none";
  const base = known ?? (provider === "gemini" ? gemini(id, { label: id }) : model(provider, id, { label: id }));
  return {
    ...base,
    vision: base.vision || flags.has("vision"),
    maxImages: base.maxImages || (flags.has("vision") ? 4 : 0),
    maxImageBytes: base.maxImageBytes || (flags.has("vision") ? 5 * MB : 0),
    audio: base.audio || flags.has("audio"),
    thinking: flags.has("think") ? thinking : base.thinking,
    thinks: base.thinks || flags.has("think"),
  };
}
