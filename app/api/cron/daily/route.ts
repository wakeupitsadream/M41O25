import { NextResponse } from "next/server";
import { gzipSync } from "node:zlib";
import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { attachments } from "@/lib/db/schema";
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
  for (const [name, table] of Object.entries(TABLES)) dump[name] = await db.select().from(table);
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

  return NextResponse.json({ ok: true, backup: key, bytes: payload.length, removedBackups: stale.length, removedScans: oldScans.length });
}
