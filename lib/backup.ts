import "server-only";
import { gzipSync } from "node:zlib";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db, schema } from "@/lib/db";
import { BACKUP_TABLES, type BackupTable } from "@/lib/backup-tables";
import { todayIso } from "@/lib/tz";

/** Имя таблицы в дампе → объект Drizzle. Состав и порядок — BACKUP_TABLES (общие с restore и тестом полноты). */
const BY_NAME: Record<BackupTable, PgTable> = {
  groups: schema.groups,
  users: schema.users,
  push_subscriptions: schema.pushSubscriptions,
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
  assistant_access: schema.assistantAccess,
  assistant_payments: schema.assistantPayments,
  assistant_conversations: schema.assistantConversations,
  assistant_messages: schema.assistantMessages,
};

/**
 * Полный JSON-дамп базы, gzip. Один формат для ежедневного cron-бэкапа и ручного скачивания из админки;
 * восстанавливается scripts/restore.ts. pin_hash не выгружаем: 4-значный PIN перебирается офлайн за секунды.
 *
 * Все таблицы читаются в одной транзакции repeatable read: иначе каждая шла бы своим autocommit-запросом, и дамп,
 * снятый днём кнопкой «Скачать сейчас», мог содержать дополнение без записи — а restore на нарушении FK
 * откатывается целиком.
 */
export async function buildBackup(): Promise<{ key: string; payload: Buffer; tables: number }> {
  const dump: Record<string, unknown[]> = {};
  await db.transaction(
    async (tx) => {
      for (const name of BACKUP_TABLES) {
        if (name === "users") {
          const { pinHash: _omit, ...cols } = getTableColumns(schema.users);
          void _omit;
          dump[name] = await tx.select(cols).from(schema.users);
        } else {
          dump[name] = await tx.select().from(BY_NAME[name]);
        }
      }
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  const payload = gzipSync(Buffer.from(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: dump })));
  return { key: `backups/${todayIso()}.json.gz`, payload, tables: BACKUP_TABLES.length };
}
