import "server-only";
import { gzipSync } from "node:zlib";
import { getTableColumns } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { todayIso } from "@/lib/tz";

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
 * Полный JSON-дамп базы, gzip. Один формат для ежедневного cron-бэкапа и ручного скачивания из админки;
 * восстанавливается scripts/restore.ts. pin_hash не выгружаем: 4-значный PIN перебирается офлайн за секунды.
 */
export async function buildBackup(): Promise<{ key: string; payload: Buffer; tables: number }> {
  const dump: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    if (name === "users") {
      const { pinHash: _omit, ...cols } = getTableColumns(schema.users);
      void _omit;
      dump[name] = await db.select(cols).from(schema.users);
    } else {
      dump[name] = await db.select().from(table);
    }
  }
  const payload = gzipSync(Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: dump })));
  return { key: `backups/${todayIso()}.json.gz`, payload, tables: Object.keys(TABLES).length };
}
