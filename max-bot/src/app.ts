import { timingSafeEqual } from "node:crypto";
import { getDeadline } from "@vercel/functions";
import { setupCommands, handleUpdate } from "./bot/handler.js";
import type { Deps } from "./bot/deps.js";
import { raspisonProfile } from "./bot/profile.js";
import { loadConfig, PROVIDERS, type Config } from "./config.js";
import { createDb, getPool } from "./db/pool.js";
import { ensureSchema } from "./db/schema.js";
import { createStore, type Store } from "./db/store.js";
import { createRouter } from "./llm/router.js";
import { errorText, log } from "./log.js";
import { createMaxClient, type MaxClient } from "./max/client.js";
import type { Update, UpdateType } from "./max/types.js";

export const UPDATE_TYPES: UpdateType[] = ["message_created", "message_callback", "bot_started"];

export type App = { config: Config; store: Store; max: MaxClient; deps: (deadline?: number) => Deps };

let cached: { key: string; app: App } | null = null;

/** Сборка зависимостей; на тёплом экземпляре переиспользуется (пул соединений, клиенты). */
export function getApp(env: Record<string, string | undefined> = process.env): App {
  const config = loadConfig(env);
  const key = `${config.databaseUrl}|${config.maxToken}`;
  if (cached?.key === key) return { ...cached.app, config };
  const db = createDb(getPool(config.databaseUrl));
  const store = createStore(db);
  const max = createMaxClient({ token: config.maxToken, baseUrl: config.maxApiUrl });
  const app: App = {
    config,
    store,
    max,
    deps: (deadline) => {
      const cfg = loadConfig(env);
      return {
        config: cfg,
        max,
        store,
        router: createRouter({ config: cfg, store }),
        fetch: globalThis.fetch,
        now: () => new Date(),
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        deadline: deadline ?? Date.now() + 280_000,
      };
    },
  };
  cached = { key, app };
  return app;
}

export function secretMatches(given: string | null, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Сколько времени осталось у функции Vercel (с запасом на запись в базу и логи). */
export function invocationDeadline(): number {
  const d = getDeadline();
  const fallback = Date.now() + 295_000;
  return (d ? d.getTime() : fallback) - 8_000;
}

export async function processUpdate(app: App, update: Update, deadline: number): Promise<void> {
  const started = Date.now();
  try {
    await ensureSchema(app.store.db);
    await handleUpdate(app.deps(deadline), update);
  } catch (err) {
    log("error", "process_update_failed", { type: update.update_type, error: errorText(err) });
  } finally {
    log("info", "update_done", { type: update.update_type, ms: Date.now() - started });
  }
}

export type WebhookState = "ok" | "registered" | "skipped" | "error";

/**
 * Регистрирует вебхук на production-адрес. Повторная подписка того же URL в MAX перезаписывает параметры,
 * поэтому подписываемся всегда — так секрет точно совпадает с текущим токеном. Чужие подписки снимаем:
 * MAX шлёт события на все, и старый адрес получал бы копии.
 */
export async function ensureWebhook(app: App): Promise<{ state: WebhookState; url: string | null; error?: string }> {
  const { config, max } = app;
  if (!config.publicUrl || !config.maxToken) return { state: "skipped", url: null };
  const url = `${config.publicUrl}/api/webhook`;
  try {
    const subs = await max.getSubscriptions();
    for (const s of subs) if (s.url !== url) await max.unsubscribe(s.url);
    const had = subs.some((s) => s.url === url);
    await max.subscribe(url, config.webhookSecret, UPDATE_TYPES);
    await app.store.setState("webhook", { url, at: new Date().toISOString() }).catch(() => {});
    return { state: had ? "ok" : "registered", url };
  } catch (err) {
    log("error", "webhook_register_failed", { error: errorText(err) });
    return { state: "error", url, error: errorText(err) };
  }
}

export async function health(app: App, opts: { ensure: boolean }) {
  const { config } = app;
  const out: Record<string, unknown> = {
    version: config.version,
    env: config.vercelEnv,
    region: process.env.VERCEL_REGION ?? null,
    providers: Object.fromEntries(PROVIDERS.map((p) => [p, Boolean(config.keys[p])])),
    raspison: Boolean(config.raspison),
  };
  let ok = true;
  if (!config.databaseUrl) {
    out.db = "missing DATABASE_URL";
    ok = false;
  } else {
    try {
      await ensureSchema(app.store.db);
      out.db = "ok";
      const owner = config.ownerId ? "env" : (await app.store.getState("owner")) ? "claimed" : "unclaimed";
      out.owner = owner;
    } catch (err) {
      out.db = `error: ${errorText(err)}`;
      ok = false;
    }
  }
  if (!config.maxToken) {
    out.max = "missing MAX_BOT_TOKEN";
    ok = false;
  } else {
    try {
      const me = await app.max.getMe();
      out.bot = { id: me.user_id, username: me.username ?? null, name: me.first_name ?? me.name ?? null };
      if (opts.ensure) {
        const wh = await ensureWebhook(app);
        out.webhook = wh;
        if (wh.state === "error") ok = false;
        if (wh.state !== "error" && out.db === "ok") await setupCommands(app.deps()).catch(() => {});
      }
    } catch (err) {
      out.max = `error: ${errorText(err)}`;
      ok = false;
    }
  }
  if (!Object.values(config.keys).some(Boolean)) {
    out.models = "нет ни одного ключа модели (GEMINI_API_KEY и др.)";
    ok = false;
  }
  return { ok, ...out };
}

export async function dailyMaintenance(app: App) {
  const result: Record<string, unknown> = {};
  await ensureSchema(app.store.db);
  result.webhook = await ensureWebhook(app);
  await app.store.cleanup();
  result.cleanup = "ok";
  if (app.config.raspison) result.raspison = Boolean(await raspisonProfile(app.deps(), true));
  return result;
}
