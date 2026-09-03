import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { anonQuota, appErrors, attachments, authAttempts, cronRuns, deviceSessions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { buildBackup } from "@/lib/backup";
import { todayIso } from "@/lib/tz";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ежедневное обслуживание (Vercel Cron, один роут — на Hobby их всего два):
 * 1) JSON-дамп всех таблиц в хранилище (backups/YYYY-MM-DD.json.gz), храним 30 штук;
 * 2) удаление сканов расписания старше 30 дней — внутренний документ вуза не должен лежать вечно;
 * 3) гигиена служебных таблиц.
 * Файлы-вложения не бэкапим: риск принят.
 */
async function dumpToStorage() {
  const { key, payload } = await buildBackup();
  await storage.put(key, payload, "application/gzip");
  const keys = await storage.list("backups/");
  const stale = keys.sort().slice(0, Math.max(0, keys.length - 30));
  for (const k of stale) await storage.delete(k);
  return { key, bytes: payload.length, removedBackups: stale.length };
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();

  // 1) Бэкап. На Vercel без R2 постоянного диска нет — бэкап пропускаем, чистку ниже делаем всё равно.
  let backup: Awaited<ReturnType<typeof dumpToStorage>> | null = null;
  let backupSkipped: string | null = null;
  let backupError: string | null = null;
  if (storage.kind === "local" && process.env.VERCEL) {
    backupSkipped = "R2 не подключён — на Vercel бэкап складывать некуда";
    console.warn(`[cron] ${backupSkipped}`);
  } else {
    try {
      backup = await dumpToStorage();
    } catch (e) {
      backupError = e instanceof Error ? e.message : String(e);
      console.error("[cron] бэкап не удался:", backupError);
    }
  }

  // 2) Сканы старше 30 дней.
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const oldScans = await db.select().from(attachments).where(and(eq(attachments.entityType, "scan"), lt(attachments.createdAt, cutoff)));
  for (const s of oldScans) {
    await storage.delete(s.fileKey).catch(() => {});
    await db.delete(attachments).where(eq(attachments.id, s.id));
  }

  // 3) Гигиена: квоты анонимных вопросов за прошлые дни (сужает окно деанонимизации), попытки входа, мёртвые сессии, сироты-вложения.
  const today = todayIso();
  await db.delete(anonQuota).where(lt(anonQuota.day, today));
  await db.delete(authAttempts).where(lt(authAttempts.createdAt, new Date(Date.now() - 24 * 3600_000)));
  await db.delete(deviceSessions).where(or(lt(deviceSessions.createdAt, new Date(Date.now() - 366 * 86_400_000)), sql`${deviceSessions.revokedAt} < now() - interval '7 days'`));
  const orphans = await db
    .select()
    .from(attachments)
    .where(and(isNull(attachments.entityId), sql`${attachments.entityType} <> 'scan'`, lt(attachments.createdAt, new Date(Date.now() - 24 * 3600_000))));
  for (const o of orphans) {
    await storage.delete(o.fileKey).catch(() => {});
    await db.delete(attachments).where(eq(attachments.id, o.id));
  }

  // 4) Журнал ошибок приложения: старше 30 дней не нужен.
  await db.delete(appErrors).where(lt(appErrors.createdAt, new Date(Date.now() - 30 * 86_400_000)));

  const body = { ok: !backupError, backup, backupSkipped, backupError, removedScans: oldScans.length, removedOrphans: orphans.length };
  const durationMs = Date.now() - started;
  await db.insert(cronRuns).values({ ok: body.ok, durationMs, error: backupError, details: body }).catch((e) => console.error("[cron] журнал:", e));
  // Сторож: healthchecks.io ждёт пинг раз в сутки; молчание или /fail — письмо админу.
  if (env.healthcheckUrl) {
    await fetch(body.ok ? env.healthcheckUrl : `${env.healthcheckUrl.replace(/\/$/, "")}/fail`, {
      method: "POST",
      body: JSON.stringify({ durationMs, ...body }).slice(0, 10_000),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
  return NextResponse.json(body, { status: backupError ? 500 : 200 });
}
