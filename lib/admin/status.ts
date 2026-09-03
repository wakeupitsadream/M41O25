import "server-only";
import { count, desc, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { appErrors, cronRuns } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";

/** Остаток на PolzaAI в рублях (если ключ задан). Ошибки глушим — админка не должна падать из-за внешнего API. */
export async function polzaBalance(): Promise<{ balance: number | null; error?: string }> {
  if (env.polza.mock) return { balance: null, error: "тестовый режим (OCR_MOCK=1)" };
  if (!env.polza.apiKey) return { balance: null, error: "ключ не задан" };
  try {
    const res = await fetch(`${env.polza.baseUrl.replace(/\/$/, "")}/balance`, {
      headers: { Authorization: `Bearer ${env.polza.apiKey}` },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return { balance: null, error: `HTTP ${res.status}` };
    const json = (await res.json()) as Record<string, unknown>;
    const raw = json.balance ?? json.data ?? json.amount;
    const num = typeof raw === "object" && raw !== null ? Number((raw as Record<string, unknown>).balance ?? (raw as Record<string, unknown>).amount) : Number(raw);
    return Number.isFinite(num) ? { balance: num } : { balance: null, error: "неожиданный ответ" };
  } catch (e) {
    return { balance: null, error: e instanceof Error ? e.message : "недоступно" };
  }
}

/** Последний бэкап по ключам в хранилище (backups/YYYY-MM-DD.json.gz). */
export async function lastBackup(): Promise<string | null> {
  try {
    const keys = await storage.list("backups/");
    const last = keys.sort().at(-1);
    return last ? last.replace(/^backups\//, "").replace(/\.json\.gz$/, "") : null;
  } catch {
    return null;
  }
}

/** Есть ли заданные модели в каталоге Polza (GET /models). null — каталог недоступен или ключа нет. */
export async function polzaModels(): Promise<{ missing: string[] } | { error: string } | null> {
  if (env.polza.mock || !env.polza.apiKey) return null;
  try {
    const res = await fetch(`${env.polza.baseUrl.replace(/\/$/, "")}/models`, { headers: { Authorization: `Bearer ${env.polza.apiKey}` }, cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = (await res.json()) as { data?: Array<{ id?: string }> } | Array<{ id?: string }>;
    const list = Array.isArray(json) ? json : json.data ?? [];
    const ids = new Set(list.map((m) => m.id).filter(Boolean));
    if (ids.size === 0) return { error: "каталог пустой или другой формат" };
    return { missing: [env.polza.model, env.polza.strongModel].filter((m) => !ids.has(m)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "недоступно" };
  }
}

export type Diagnostics = Awaited<ReturnType<typeof diagnostics>>;

/** Живая сводка для админа: база, хранилище, Polza, cron, ошибки за сутки, наличие env. Ничего не бросает. */
export async function diagnostics() {
  const t0 = Date.now();
  let dbMs: number | null = null;
  let dbError: string | null = null;
  let dbMb: number | null = null;
  try {
    const r = await db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`);
    dbMs = Date.now() - t0;
    const bytes = Number(r.rows?.[0]?.bytes ?? 0);
    dbMb = bytes ? Math.round((bytes / 1024 / 1024) * 10) / 10 : null;
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }

  let storageLine: string;
  let storageOk = true;
  if (storage.kind === "local") {
    storageOk = !process.env.VERCEL;
    storageLine = process.env.VERCEL ? "R2 не подключён — файлы и бэкапы выключены" : "локальная папка .data/uploads";
  } else {
    try {
      const keys = await storage.list("backups/");
      storageLine = `R2 отвечает · бэкапов: ${keys.length}`;
    } catch (e) {
      storageOk = false;
      storageLine = `R2 ошибка: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  const since = new Date(Date.now() - 24 * 3600_000);
  const [[errCount], lastErrors, [lastCron], models] = await Promise.all([
    db.select({ n: count() }).from(appErrors).where(gt(appErrors.createdAt, since)).catch(() => [{ n: -1 }]),
    db.select({ route: appErrors.route, message: appErrors.message, createdAt: appErrors.createdAt }).from(appErrors).orderBy(desc(appErrors.createdAt)).limit(3).catch(() => []),
    db.select().from(cronRuns).orderBy(desc(cronRuns.ranAt)).limit(1).catch(() => []),
    polzaModels(),
  ]);

  const missingEnv = [
    ["AUTH_SECRET", env.authSecret],
    ["ANON_PEPPER", env.anonPepper],
    ["CRON_SECRET", env.cronSecret],
    ["POLZA_API_KEY", env.polza.apiKey],
    ["R2_*", env.r2.configured ? "x" : ""],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    db: { ms: dbMs, error: dbError, mb: dbMb },
    storage: { ok: storageOk, line: storageLine },
    errors24h: errCount?.n ?? -1,
    lastErrors,
    lastCron: lastCron ?? null,
    models,
    missingEnv,
    healthcheck: Boolean(env.healthcheckUrl),
  };
}
