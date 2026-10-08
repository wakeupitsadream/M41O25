import { createHmac } from "node:crypto";

/**
 * Единственный читатель process.env в боте (как lib/env.ts в Raspison). Конфиг собирается на каждый вызов из
 * переданного env: тесты подставляют свой объект, а смена переменных в Vercel вступает в силу после Redeploy.
 */

export const PROVIDERS = [
  "gemini",
  "groq",
  "openrouter",
  "mistral",
  "github",
  "cerebras",
  "cloudflare",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];

/** Виды работы для моделей: у каждого своя цепочка (src/llm/catalog.ts). */
export const TASKS = ["solve", "chat", "vision", "light", "transcribe"] as const;
export type Task = (typeof TASKS)[number];

export type Config = {
  maxToken: string;
  maxApiUrl: string;
  /** Секрет вебхука: MAX присылает его в заголовке X-Max-Bot-Api-Secret. */
  webhookSecret: string;
  /** Владелец из env имеет приоритет над привязкой в базе. */
  ownerId: number | null;
  databaseUrl: string;
  /** Адрес, на который регистрируется вебхук; null — не регистрировать (preview, локальный запуск без PUBLIC_URL). */
  publicUrl: string | null;
  vercelEnv: string | null;
  tz: string;
  cronSecret: string;
  keys: Partial<Record<ProviderId, string>>;
  cloudflareAccountId: string;
  /** Переопределения цепочек: CHAIN_SOLVE="gemini:gemini-3.5-flash,groq:…". */
  chains: Partial<Record<Task, string[]>>;
  raspison: { url: string; key: string; group: string } | null;
  /** Год поступления — из него считается курс в профиле. */
  studyStartYear: number;
  version: string;
};

type Env = Record<string, string | undefined>;

const str = (env: Env, name: string) => (env[name] ?? "").trim();

/** Секрет вебхука выводится из токена: отдельную переменную заводить не нужно, а смена токена меняет и секрет. */
export function deriveWebhookSecret(token: string): string {
  return createHmac("sha256", token).update("max-bot:webhook").digest("base64url").slice(0, 43);
}

function parseChain(raw: string): string[] | undefined {
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

function parseOwner(raw: string): number | null {
  if (!/^\d{1,18}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function publicUrl(env: Env): string | null {
  const explicit = str(env, "PUBLIC_URL").replace(/\/+$/, "");
  if (explicit) return /^https:\/\//.test(explicit) ? explicit : `https://${explicit}`;
  // Вебхук регистрируется только из production: preview-сборка не должна перехватывать события боевого бота.
  if (str(env, "VERCEL_ENV") !== "production") return null;
  const host = str(env, "VERCEL_PROJECT_PRODUCTION_URL");
  return host ? `https://${host}` : null;
}

export function loadConfig(env: Env = process.env): Config {
  const maxToken = str(env, "MAX_BOT_TOKEN");
  const keys: Partial<Record<ProviderId, string>> = {};
  const keyVars: Record<ProviderId, string> = {
    gemini: "GEMINI_API_KEY",
    groq: "GROQ_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
    mistral: "MISTRAL_API_KEY",
    github: "GITHUB_MODELS_TOKEN",
    cerebras: "CEREBRAS_API_KEY",
    cloudflare: "CLOUDFLARE_API_TOKEN",
  };
  for (const p of PROVIDERS) {
    const v = str(env, keyVars[p]);
    if (v) keys[p] = v;
  }
  const cloudflareAccountId = str(env, "CLOUDFLARE_ACCOUNT_ID");
  // Без id аккаунта токен Cloudflare бесполезен: адрес API строится из него.
  if (!cloudflareAccountId) delete keys.cloudflare;

  const chains: Partial<Record<Task, string[]>> = {};
  for (const t of TASKS) {
    const c = parseChain(str(env, `CHAIN_${t.toUpperCase()}`));
    if (c) chains[t] = c;
  }

  const raspisonUrl = str(env, "RASPISON_URL").replace(/\/+$/, "");
  const raspisonKey = str(env, "RASPISON_BOT_KEY");
  const startYear = Number(str(env, "STUDY_START_YEAR"));

  return {
    maxToken,
    maxApiUrl: str(env, "MAX_API_URL") || "https://platform-api2.max.ru",
    webhookSecret: str(env, "MAX_WEBHOOK_SECRET") || (maxToken ? deriveWebhookSecret(maxToken) : ""),
    ownerId: parseOwner(str(env, "MAX_OWNER_ID")),
    databaseUrl: str(env, "DATABASE_URL") || str(env, "POSTGRES_URL"),
    publicUrl: publicUrl(env),
    vercelEnv: str(env, "VERCEL_ENV") || null,
    tz: str(env, "APP_TZ") || "Asia/Yekaterinburg",
    cronSecret: str(env, "CRON_SECRET"),
    keys,
    cloudflareAccountId,
    chains,
    raspison: raspisonUrl && raspisonKey ? { url: raspisonUrl, key: raspisonKey, group: str(env, "RASPISON_GROUP") } : null,
    studyStartYear: Number.isInteger(startYear) && startYear > 2000 ? startYear : 2025,
    version: str(env, "VERCEL_GIT_COMMIT_SHA").slice(0, 7) || "dev",
  };
}
