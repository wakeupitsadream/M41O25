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
    tpm: null,
    imageTokens: 1500,
    mediaResolution: false,
    extraBody: null,
    ...spec,
  };
}

/** Gemini 3.x Flash: зрение (в т. ч. HEIC с iPhone), звук, JSON, thinkingLevel low/medium/high. */
const flash = (id: string, spec: Spec) =>
  model("gemini", id, {
    vision: true,
    audio: true,
    json: true,
    thinking: "level",
    thinks: true,
    maxImages: 16,
    maxImageBytes: 15 * MB,
    imageMimes: GEMINI_IMAGES,
    maxOutputTokens: 32_768,
    mediaResolution: true,
    timeoutMs: 150_000,
    ...spec,
  });

/** Gemma 4 через тот же ключ Gemini: квоты больше, системной роли и управления размышлениями нет. */
const gemma = (id: string, label: string) =>
  model("gemini", id, { label, vision: true, maxImages: 8, maxImageBytes: 15 * MB, imageMimes: GEMINI_IMAGES, systemRole: false, timeoutMs: 90_000 });

/**
 * Бесплатные модели на октябрь 2026 (подробности, лимиты и как получить ключи — docs/MODELS.md).
 * Gemini 2.5 закрыт для новых проектов, GitHub Models закрыт 30.07.2026, Cerebras больше не бесплатен —
 * их здесь нет. У Gemini квота своя у каждой модели (~20 запросов в сутки у Flash), поэтому четыре Flash подряд
 * дают ~80 сильных ответов в день. Роутер пропускает модели без ключа, без зрения (для фото) и на паузе.
 */
const MODELS: ModelInfo[] = [
  flash("gemini-3.8-flash", { label: "Gemini 3.8 Flash", tier: 1 }),
  flash("gemini-3.7-flash", { label: "Gemini 3.7 Flash", tier: 1 }),
  flash("gemini-3.6-flash", { label: "Gemini 3.6 Flash", tier: 1 }),
  flash("gemini-3.5-flash", { label: "Gemini 3.5 Flash", tier: 1 }),
  flash("gemini-3.5-flash-lite", { label: "Gemini 3.5 Flash-Lite", tier: 2, timeoutMs: 90_000 }),
  flash("gemini-3.1-flash-lite", { label: "Gemini 3.1 Flash-Lite", tier: 3, timeoutMs: 90_000 }),
  gemma("gemma-4-31b-it", "Gemma 4 31B"),
  gemma("gemma-4-26b-a4b-it", "Gemma 4 26B"),

  // Groq: 30 запросов в минуту, ~1000 в сутки, но всего 8 000 токенов в минуту — запрос подгоняется под лимит.
  model("groq", "openai/gpt-oss-120b", {
    label: "GPT-OSS 120B (Groq)",
    thinking: "effort",
    thinks: true,
    tier: 2,
    json: true,
    timeoutMs: 90_000,
    maxOutputTokens: 32_768,
    tpm: 8000,
  }),
  model("groq", "qwen/qwen3.8-27b", {
    label: "Qwen 3.8 27B (Groq)",
    vision: true,
    maxImages: 3,
    maxImageBytes: 3 * MB,
    imageTokens: 2048,
    tier: 2,
    timeoutMs: 90_000,
    tpm: 8000,
    // Размышления Qwen не нужны в тексте ответа и съедали бы лимит токенов.
    extraBody: { reasoning_format: "hidden" },
  }),
  model("groq", "openai/gpt-oss-20b", { label: "GPT-OSS 20B (Groq)", thinking: "effort", thinks: true, json: true, maxOutputTokens: 32_768, tpm: 8000 }),
  model("groq", "whisper-large-v3-turbo", { label: "Whisper turbo (Groq)", audio: true }),
  model("groq", "whisper-large-v3", { label: "Whisper (Groq)", audio: true }),

  // Cloudflare Workers AI: 10 000 «нейронов» в сутки (~150 запросов с фото к Gemma 4).
  model("cloudflare", "@cf/google/gemma-4-26b-a4b-it", { label: "Gemma 4 26B (Cloudflare)", vision: true, maxImages: 4, maxImageBytes: 5 * MB, tier: 3, timeoutMs: 90_000 }),
  model("cloudflare", "@cf/meta/llama-4-scout-17b-16e-instruct", { label: "Llama 4 Scout (Cloudflare)", vision: true, maxImages: 4, maxImageBytes: 5 * MB }),
  model("cloudflare", "@cf/openai/whisper-large-v3-turbo", { label: "Whisper (Cloudflare)", audio: true }),

  // Z.ai: бесплатные GLM Flash, без блокировки России, но по одному запросу за раз.
  model("zai", "glm-4.6v-flash", { label: "GLM-4.6V Flash (Z.ai)", vision: true, maxImages: 4, maxImageBytes: 5 * MB, timeoutMs: 90_000 }),
  model("zai", "glm-4.7-flash", { label: "GLM-4.7 Flash (Z.ai)", timeoutMs: 90_000 }),

  // OpenRouter: 50 бесплатных запросов в сутки на аккаунт (пополнить из России нельзя).
  model("openrouter", "google/gemma-4-31b-it:free", { label: "Gemma 4 31B (OpenRouter)", vision: true, maxImages: 4, maxImageBytes: 5 * MB }),
  model("openrouter", "openrouter/free", { label: "OpenRouter Free", vision: true, maxImages: 4, maxImageBytes: 5 * MB }),

  // Mistral — бесплатный тариф с подтверждением по SMS.
  model("mistral", "mistral-medium-latest", { label: "Mistral Medium", vision: true, maxImages: 8, maxImageBytes: 10 * MB, tier: 2, json: true, timeoutMs: 90_000 }),
  model("mistral", "mistral-small-latest", { label: "Mistral Small", vision: true, maxImages: 8, maxImageBytes: 10 * MB, json: true }),
];

export const CATALOG: Record<string, ModelInfo> = Object.fromEntries(MODELS.map((m) => [m.key, m]));

const FLASH = ["gemini:gemini-3.8-flash", "gemini:gemini-3.7-flash", "gemini:gemini-3.6-flash", "gemini:gemini-3.5-flash"];

export const DEFAULT_CHAINS: Record<Task, string[]> = {
  // Задачи, проверка решений, билеты, репетитор. Для фото текстовые модели (gpt-oss) пропускаются сами.
  solve: [
    ...FLASH,
    "groq:openai/gpt-oss-120b",
    "groq:qwen/qwen3.8-27b",
    "gemini:gemini-3.5-flash-lite",
    "mistral:mistral-medium-latest",
    "gemini:gemma-4-31b-it",
    "cloudflare:@cf/google/gemma-4-26b-a4b-it",
    "openrouter:google/gemma-4-31b-it:free",
    "zai:glm-4.6v-flash",
    "gemini:gemini-3.1-flash-lite",
    "zai:glm-4.7-flash",
  ],
  // Распознавание заданий, конспект, текст с фото: точная читка, а не глубокие рассуждения.
  vision: [
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
    "gemini:gemma-4-31b-it",
    "groq:qwen/qwen3.8-27b",
    "mistral:mistral-medium-latest",
    "cloudflare:@cf/google/gemma-4-26b-a4b-it",
    "zai:glm-4.6v-flash",
    "openrouter:google/gemma-4-31b-it:free",
    "gemini:gemini-3.6-flash",
  ],
  // Болталка: быстро и с запасом по квотам; модели со зрением — для «Обсудить фото».
  chat: [
    "gemini:gemini-3.5-flash-lite",
    "groq:openai/gpt-oss-120b",
    "groq:qwen/qwen3.8-27b",
    "gemini:gemma-4-31b-it",
    "cloudflare:@cf/google/gemma-4-26b-a4b-it",
    "zai:glm-4.7-flash",
    "mistral:mistral-small-latest",
    "gemini:gemini-3.1-flash-lite",
    "openrouter:google/gemma-4-31b-it:free",
  ],
  // Короче/проще, вопросы для самопроверки, резюме истории.
  light: [
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
    "groq:openai/gpt-oss-120b",
    "groq:openai/gpt-oss-20b",
    "gemini:gemma-4-31b-it",
    "cloudflare:@cf/google/gemma-4-26b-a4b-it",
    "zai:glm-4.7-flash",
    "mistral:mistral-small-latest",
    "openrouter:openrouter/free",
  ],
  transcribe: [
    "groq:whisper-large-v3-turbo",
    "groq:whisper-large-v3",
    "cloudflare:@cf/openai/whisper-large-v3-turbo",
    "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-3.1-flash-lite",
  ],
};

/**
 * Модель из переменной CHAIN_*, которой нет в каталоге: «provider:id#vision,think». Флаги после # —
 * vision (принимает фото), think (рассуждающая), audio (Gemini, inline-звук).
 */
export function modelFromKey(key: string): ModelInfo | null {
  const [main = "", flagsRaw = ""] = key.split("#");
  const idx = main.indexOf(":");
  if (idx <= 0) return null;
  const provider = main.slice(0, idx) as ProviderId;
  const id = main.slice(idx + 1);
  if (!(PROVIDERS as readonly string[]).includes(provider) || !id) return null;
  const known = CATALOG[`${provider}:${id}`];
  const flags = new Set(
    flagsRaw
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean),
  );
  const base = known ?? (provider === "gemini" && /^gemini-/.test(id) ? flash(id, { label: id }) : model(provider, id, { label: id }));
  const thinking: ThinkingControl = flags.has("think") ? (provider === "gemini" ? "level" : "effort") : base.thinking;
  return {
    ...base,
    vision: base.vision || flags.has("vision"),
    maxImages: base.maxImages || (flags.has("vision") ? 4 : 0),
    maxImageBytes: base.maxImageBytes || (flags.has("vision") ? 5 * MB : 0),
    audio: base.audio || flags.has("audio"),
    thinking,
    thinks: base.thinks || flags.has("think"),
  };
}
