import "server-only";
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
