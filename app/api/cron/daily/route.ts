import { NextResponse } from "next/server";
import { and, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { anonQuota, appErrors, attachments, authAttempts, cronRuns, deviceSessions, pushSubscriptions } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { buildBackup } from "@/lib/backup";
import { orphanCutoffs, planBackup, rotateBackups, summarizeCronRun } from "@/lib/ops/health";
import { MAX_PUSH_FAILURES } from "@/lib/push/errors";
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

/** Удаление файла из хранилища не должно ронять прогон, но и молчать о себе не должно — считаем неудачи. */
async function deleteFile(key: string, what: string): Promise<boolean> {
  try {
    await storage.delete(key);
    return true;
  } catch (e) {
    console.error(`[cron] не удалён файл (${what}) ${key}:`, e instanceof Error ? e.message : e);
    return false;
  }
}

async function dumpToStorage() {
  const { key, payload } = await buildBackup();
  await storage.put(key, payload, "application/gzip");
  // Дамп за сегодня уже лежит: дальше только уборка старых, и её неудача — не «бэкап не удался» (lib/ops/health.ts).
  const rotated = await rotateBackups(await storage.list("backups/"), (k) => deleteFile(k, "старый бэкап"));
  return { key, bytes: payload.length, removedBackups: rotated.removed, failedBackupDeletes: rotated.failed };
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();

  // 1) Бэкап. На Vercel без R2 складывать его некуда — это не «пропустили», а потеря данных: прогон красный.
  const plan = planBackup({ storageKind: storage.kind, onVercel: Boolean(process.env.VERCEL) });
  let backup: Awaited<ReturnType<typeof dumpToStorage>> | null = null;
  let backupError: string | null = null;
  if (!plan.run) {
    console.warn(`[cron] бэкап не сделан: ${plan.reason}`);
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
  let failedScanDeletes = 0;
  for (const s of oldScans) {
    if (!(await deleteFile(s.fileKey, "скан"))) failedScanDeletes += 1;
    await db.delete(attachments).where(eq(attachments.id, s.id));
  }

  // 3) Гигиена: квоты анонимных вопросов за прошлые дни (сужает окно деанонимизации), попытки входа, мёртвые сессии, сироты-вложения.
  const today = todayIso();
  await db.delete(anonQuota).where(lt(anonQuota.day, today));
  await db.delete(authAttempts).where(lt(authAttempts.createdAt, new Date(Date.now() - 24 * 3600_000)));
  await db.delete(deviceSessions).where(or(lt(deviceSessions.createdAt, new Date(Date.now() - 366 * 86_400_000)), sql`${deviceSessions.revokedAt} < now() - interval '7 days'`));
  // Сканы чистит шаг 2 (свои 30 дней). У домашки окно длиннее: пока запись лежит в офлайн-очереди, её вложения
  // ничейные — привязывает их только успешная отправка (claimUploads). Окно = срок жизни очереди плюс сутки,
  // считает orphanCutoffs; правите его — проверьте QUEUE_TTL_MS, иначе «отправлю вместе с фото» окажется враньём.
  const cut = orphanCutoffs(Date.now());
  const orphans = await db
    .select()
    .from(attachments)
    .where(
      and(
        isNull(attachments.entityId),
        ne(attachments.entityType, "scan"),
        or(
          and(ne(attachments.entityType, "homework"), lt(attachments.createdAt, cut.common)),
          and(eq(attachments.entityType, "homework"), lt(attachments.createdAt, cut.homework)),
        ),
      ),
    );
  let failedOrphanDeletes = 0;
  for (const o of orphans) {
    if (!(await deleteFile(o.fileKey, "сирота"))) failedOrphanDeletes += 1;
    await db.delete(attachments).where(eq(attachments.id, o.id));
  }

  // 4) Журнал ошибок приложения: старше 30 дней не нужен.
  await db.delete(appErrors).where(lt(appErrors.createdAt, new Date(Date.now() - 30 * 86_400_000)));

  // 5) Подписки на пуши. Мёртвые (404/410) удаляет сама отправка; сюда попадают те, что стабильно отвечают ошибкой:
  // push-сервис их не принимает, а строка мешает — при каждой новости мы честно стучимся в стену.
  const deadPush = await db
    .delete(pushSubscriptions)
    .where(gte(pushSubscriptions.failCount, MAX_PUSH_FAILURES))
    .returning({ id: pushSubscriptions.id });

  const summary = summarizeCronRun({ plan, backupError, failedScanDeletes, failedOrphanDeletes });
  const body = {
    ok: summary.ok,
    error: summary.error,
    warnings: summary.warnings,
    backup,
    backupSkipped: plan.run ? null : plan.reason,
    backupError,
    removedScans: oldScans.length,
    removedPushSubscriptions: deadPush.length,
    removedOrphans: orphans.length,
    failedScanDeletes,
    failedOrphanDeletes,
  };
  const durationMs = Date.now() - started;
  await db.insert(cronRuns).values({ ok: body.ok, durationMs, error: summary.error, details: body }).catch((e) => console.error("[cron] журнал:", e));
  // Сторож: healthchecks.io ждёт пинг раз в сутки; молчание или /fail — письмо админу.
  if (env.healthcheckUrl) {
    await fetch(body.ok ? env.healthcheckUrl : `${env.healthcheckUrl.replace(/\/$/, "")}/fail`, {
      method: "POST",
      body: JSON.stringify({ durationMs, ...body }).slice(0, 10_000),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
  return NextResponse.json(body, { status: body.ok ? 200 : 500 });
}
