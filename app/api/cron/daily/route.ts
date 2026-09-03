import { NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { anonQuota, attachments, authAttempts, deviceSessions, users } from "@/lib/db/schema";
import { getTableColumns } from "drizzle-orm";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { todayIso } from "@/lib/tz";

export const runtime = "nodejs";
export const maxDuration = 60;

const TABLES = {
  groups: schema.groups,
  users: schema.users,
  semesters: schema.semesters,
  subjects: schema.subjects,
  weeks: schema.weeks,
  lessons: schema.lessons,
  schedule_imports: schema.scheduleImports,
  homework: schema.homework,
  hw_edits: schema.hwEdits,
  hw_done: schema.hwDone,
  comments: schema.comments,
  attachments: schema.attachments,
  news: schema.news,
  tasks: schema.tasks,
  task_checks: schema.taskChecks,
  polls: schema.polls,
  poll_options: schema.pollOptions,
  poll_votes: schema.pollVotes,
  contacts: schema.contacts,
  anon_questions: schema.anonQuestions,
  reactions: schema.reactions,
  activity: schema.activity,
} as const;

/**
 * Ежедневное обслуживание (Vercel Cron, один роут — на Hobby их всего два):
 * 1) JSON-дамп всех таблиц в хранилище (backups/YYYY-MM-DD.json.gz), храним 30 штук;
 * 2) удаление сканов расписания старше 30 дней — внутренний документ вуза не должен лежать вечно.
 * Файлы-вложения не бэкапим: риск принят.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!env.cronSecret || auth !== `Bearer ${env.cronSecret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dump: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    if (name === "users") {
      // pin_hash в бэкап не кладём: 4-значный PIN перебирается офлайн за секунды. После восстановления PIN задаются заново.
      const { pinHash: _omit, ...cols } = getTableColumns(users);
      void _omit;
      dump[name] = await db.select(cols).from(users);
    } else {
      dump[name] = await db.select().from(table);
    }
  }
  const payload = gzipSync(Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: dump })));
  const key = `backups/${todayIso()}.json.gz`;
  await storage.put(key, payload, "application/gzip");

  const keys = await storage.list("backups/");
  const stale = keys.sort().slice(0, Math.max(0, keys.length - 30));
  for (const k of stale) await storage.delete(k);

  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  const oldScans = await db.select().from(attachments).where(and(eq(attachments.entityType, "scan"), lt(attachments.createdAt, cutoff)));
  for (const s of oldScans) {
    await storage.delete(s.fileKey).catch(() => {});
    await db.delete(attachments).where(eq(attachments.id, s.id));
  }

  // Гигиена: квоты анонимных вопросов за прошлые дни (сужает окно деанонимизации), попытки входа, мёртвые сессии, сироты-вложения.
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

  return NextResponse.json({ ok: true, backup: key, bytes: payload.length, removedBackups: stale.length, removedScans: oldScans.length, removedOrphans: orphans.length });
}
