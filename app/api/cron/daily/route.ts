import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  anonQuota,
  appErrors,
  assistantMessages,
  assistantQuota,
  attachments,
  authAttempts,
  cronRuns,
  deviceSessions,
  homework,
  hwEdits,
  news,
  pushSubscriptions,
  tasks,
} from "@/lib/db/schema";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { buildBackup } from "@/lib/backup";
import { ASSISTANT_CONTENT_RETENTION_DAYS, orphanCutoffs, planBackup, rotateBackups, summarizeCronRun } from "@/lib/ops/health";
import { MAX_PUSH_FAILURES } from "@/lib/push/errors";
import { addDaysIso, todayIso } from "@/lib/tz";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Ежедневное обслуживание (Vercel Cron, один роут — на Hobby их всего два):
 * 1) JSON-дамп всех таблиц в хранилище (backups/YYYY-MM-DD.json.gz), храним 30 штук;
 * 2) удаление сканов расписания старше 30 дней — внутренний документ вуза не должен лежать вечно;
 * 3) гигиена служебных таблиц, вложения удалённых записей, старые тексты бесед помощника.
 * Файлы-вложения не бэкапим: риск принят.
 *
 * Каждый шаг изолирован: упавший запрос записывается в журнал как ошибка шага, а остальные шаги идут дальше.
 * Строка cron_runs и пинг сторожа уходят всегда, даже если упало всё, — иначе админка неделями показывала бы
 * «Cron прошёл» с датой последнего удачного прогона, а сторож молчал бы ни об успехе, ни о провале.
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

/**
 * Файл и его строка: строку убираем только после удалённого файла — иначе файл теряет единственный указатель
 * на себя и зависает в бакете навсегда, а завтрашний прогон про него уже не узнает.
 */
async function deleteAttachments(rows: { id: string; fileKey: string }[], what: string): Promise<{ removed: number; failed: number }> {
  let removed = 0;
  let failed = 0;
  for (const a of rows) {
    if (await deleteFile(a.fileKey, what)) {
      await db.delete(attachments).where(eq(attachments.id, a.id));
      removed += 1;
    } else failed += 1;
  }
  return { removed, failed };
}

async function dumpToStorage() {
  const { key, payload } = await buildBackup();
  await storage.put(key, payload, "application/gzip");
  // Дамп за сегодня уже лежит: дальше только уборка старых, и её неудача — не «бэкап не удался» (lib/ops/health.ts).
  const rotated = await rotateBackups(await storage.list("backups/"), (k) => deleteFile(k, "старый бэкап"));
  return { key, bytes: payload.length, removedBackups: rotated.removed, failedBackupDeletes: rotated.failed };
}

/** Сравнение секрета без утечки по времени: хеши одинаковой длины, timingSafeEqual. */
function authorized(header: string | null): boolean {
  if (!env.cronSecret || !header) return false;
  const given = createHash("sha256").update(header).digest();
  const want = createHash("sha256").update(`Bearer ${env.cronSecret}`).digest();
  return timingSafeEqual(given, want);
}

export async function GET(req: Request) {
  if (!authorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const stepErrors: string[] = [];
  /** Шаг прогона: ошибка не роняет остальные, а попадает в журнал под своим именем. */
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[cron] шаг «${name}» упал:`, msg);
      stepErrors.push(`${name}: ${msg}`);
      return null;
    }
  };

  // 1) Бэкап. На Vercel без R2 складывать его некуда — это не «пропустили», а потеря данных: прогон красный.
  const plan = planBackup({ storageKind: storage.kind, onVercel: env.onVercel });
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

  const today = todayIso();
  const now = Date.now();

  // 2) Сканы старше 30 дней.
  const scans = await step("сканы", async () => {
    const old = await db
      .select({ id: attachments.id, fileKey: attachments.fileKey })
      .from(attachments)
      .where(and(eq(attachments.entityType, "scan"), lt(attachments.createdAt, new Date(now - 30 * 86_400_000))));
    return deleteAttachments(old, "скан");
  });

  // 3) Гигиена: квоты анонимных вопросов за прошлые дни (сужает окно деанонимизации), попытки входа, мёртвые сессии.
  await step("квоты и попытки входа", async () => {
    await db.delete(anonQuota).where(lt(anonQuota.day, today));
    // Квоты помощника: неделя считается по строкам с day >= понедельника, так что старше 14 дней они никому не нужны.
    await db.delete(assistantQuota).where(lt(assistantQuota.day, addDaysIso(today, -14)));
    await db.delete(authAttempts).where(lt(authAttempts.createdAt, new Date(now - 24 * 3600_000)));
  });
  await step("сессии", async () => {
    await db.delete(deviceSessions).where(or(lt(deviceSessions.createdAt, new Date(now - 366 * 86_400_000)), sql`${deviceSessions.revokedAt} < now() - interval '7 days'`));
  });

  // 4) Сироты-вложения. Сканы чистит шаг 2 (свои 30 дней). У домашки окно длиннее: пока запись лежит в офлайн-очереди,
  // её вложения ничейные — привязывает их только успешная отправка (claimUploads). Окно = срок жизни очереди плюс сутки,
  // считает orphanCutoffs; правите его — проверьте QUEUE_TTL_MS, иначе «отправлю вместе с фото» окажется враньём.
  // Вложения помощника ('assistant') идут по общей ветке в сутки: файл привязывается к сообщению при отправке в той же
  // транзакции, а ничейный через сутки — это брошенный композер, не очередь (docs/AI-CHAT.md §5).
  const orphans = await step("сироты", async () => {
    const cut = orphanCutoffs(now);
    const rows = await db
      .select({ id: attachments.id, fileKey: attachments.fileKey })
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
    return deleteAttachments(rows, "сирота");
  });

  // 5) Вложения мягко удалённых записей: сама запись помечена deleted_at и в интерфейсе не видна, а её файлы
  // продолжали лежать в хранилище и открываться по ссылке. «Снять удаление» в приложении нет, поэтому ждать нечего.
  const deletedEntities = await step("вложения удалённых записей", async () => {
    const deletedHw = db.select({ id: homework.id }).from(homework).where(sql`${homework.deletedAt} is not null`);
    const deletedEdits = db
      .select({ id: hwEdits.id })
      .from(hwEdits)
      .innerJoin(homework, eq(homework.id, hwEdits.homeworkId))
      .where(or(sql`${hwEdits.deletedAt} is not null`, sql`${homework.deletedAt} is not null`));
    const deletedNews = db.select({ id: news.id }).from(news).where(sql`${news.deletedAt} is not null`);
    const deletedTasks = db.select({ id: tasks.id }).from(tasks).where(sql`${tasks.deletedAt} is not null`);
    const rows = await db
      .select({ id: attachments.id, fileKey: attachments.fileKey })
      .from(attachments)
      .where(
        or(
          and(eq(attachments.entityType, "homework"), or(inArray(attachments.entityId, deletedHw), inArray(attachments.entityId, deletedEdits))),
          and(eq(attachments.entityType, "news"), inArray(attachments.entityId, deletedNews)),
          and(eq(attachments.entityType, "task"), inArray(attachments.entityId, deletedTasks)),
        ),
      );
    return deleteAttachments(rows, "вложение удалённой записи");
  });

  // 6) Беседы помощника: единственная таблица, растущая текстом (до 8 КБ на пару вопрос-ответ). Старше
  // ASSISTANT_CONTENT_RETENTION_DAYS текст стираем, строки оставляем — статистика расходов и ресурс считаются
  // по cost_kopecks/day, им текст не нужен. Вложения таких сообщений — в хранилище тоже незачем.
  const assistantTrim = await step("старые тексты помощника", async () => {
    const cutoff = new Date(now - ASSISTANT_CONTENT_RETENTION_DAYS * 86_400_000);
    const files = await db
      .select({ id: attachments.id, fileKey: attachments.fileKey })
      .from(attachments)
      .where(and(eq(attachments.entityType, "assistant"), sql`${attachments.entityId} is not null`, lt(attachments.createdAt, cutoff)));
    const removedFiles = await deleteAttachments(files, "вложение старой беседы");
    const trimmed = await db
      .update(assistantMessages)
      .set({ content: "", attachmentIds: [] })
      .where(and(lt(assistantMessages.createdAt, cutoff), ne(assistantMessages.content, "")))
      .returning({ id: assistantMessages.id });
    return { messages: trimmed.length, ...removedFiles };
  });

  // 7) Журнал ошибок приложения: старше 30 дней не нужен.
  await step("журнал ошибок", async () => {
    await db.delete(appErrors).where(lt(appErrors.createdAt, new Date(now - 30 * 86_400_000)));
  });

  // 8) Подписки на пуши. Мёртвые (404/410) удаляет сама отправка; сюда попадают те, что стабильно отвечают ошибкой:
  // push-сервис их не принимает, а строка мешает — при каждой новости мы честно стучимся в стену.
  const deadPush = await step("подписки на пуши", async () => {
    const rows = await db.delete(pushSubscriptions).where(gte(pushSubscriptions.failCount, MAX_PUSH_FAILURES)).returning({ id: pushSubscriptions.id });
    return rows.length;
  });

  const failedFileDeletes = (scans?.failed ?? 0) + (orphans?.failed ?? 0) + (deletedEntities?.failed ?? 0) + (assistantTrim?.failed ?? 0);
  const summary = summarizeCronRun({ plan, backupError, failedScanDeletes: scans?.failed ?? 0, failedOrphanDeletes: failedFileDeletes - (scans?.failed ?? 0), stepErrors });
  const body = {
    ok: summary.ok,
    error: summary.error,
    warnings: summary.warnings,
    backup,
    backupSkipped: plan.run ? null : plan.reason,
    backupError,
    removedScans: scans?.removed ?? 0,
    removedOrphans: orphans?.removed ?? 0,
    removedDeletedEntityFiles: deletedEntities?.removed ?? 0,
    trimmedAssistantMessages: assistantTrim?.messages ?? 0,
    removedPushSubscriptions: deadPush ?? 0,
    failedFileDeletes,
    stepErrors,
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
