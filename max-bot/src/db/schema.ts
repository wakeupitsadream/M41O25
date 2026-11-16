import type { Db } from "./pool.js";

/**
 * Схема создаётся сама при первом запросе экземпляра: миграций нет, только идемпотентные CREATE … IF NOT EXISTS
 * и ADD COLUMN IF NOT EXISTS. Новая версия схемы — новый номер SCHEMA_VERSION и новые строки в конце STATEMENTS.
 */
export const SCHEMA_VERSION = 1;

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS bot_state (
     key text PRIMARY KEY,
     value jsonb NOT NULL,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS processed_updates (
     key text PRIMARY KEY,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS chats (
     chat_id bigint PRIMARY KEY,
     user_id bigint NOT NULL,
     mode text NOT NULL DEFAULT 'solve',
     topic integer NOT NULL DEFAULT 1,
     summary text,
     summary_upto bigint,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id bigserial PRIMARY KEY,
     chat_id bigint NOT NULL,
     topic integer NOT NULL,
     role text NOT NULL CHECK (role IN ('user', 'assistant')),
     content text NOT NULL,
     meta jsonb NOT NULL DEFAULT '{}'::jsonb,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS messages_chat_topic_idx ON messages (chat_id, topic, id)`,
  `CREATE TABLE IF NOT EXISTS items (
     id text PRIMARY KEY,
     chat_id bigint NOT NULL,
     kind text NOT NULL,
     data jsonb NOT NULL,
     expires_at timestamptz NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS items_chat_kind_idx ON items (chat_id, kind)`,
  `CREATE INDEX IF NOT EXISTS items_expires_idx ON items (expires_at)`,
  `CREATE TABLE IF NOT EXISTS model_state (
     model text PRIMARY KEY,
     cooldown_until timestamptz,
     reason text,
     last_error text,
     last_ok_at timestamptz,
     day date,
     ok_count integer NOT NULL DEFAULT 0,
     fail_count integer NOT NULL DEFAULT 0,
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
];

let ready: Promise<void> | null = null;

async function migrate(db: Db): Promise<void> {
  try {
    const { rows } = await db.query<{ value: number }>(`SELECT value FROM bot_state WHERE key = 'schema_version'`);
    if (rows[0]?.value === SCHEMA_VERSION) return;
  } catch (err) {
    // 42P01 — таблицы ещё нет: первая установка.
    if ((err as { code?: string }).code !== "42P01") throw err;
  }
  await db.tx(async (q) => {
    // Два холодных старта одновременно: без блокировки параллельный CREATE TABLE IF NOT EXISTS ловит гонку в pg_type.
    await q.query(`SELECT pg_advisory_xact_lock(8217003)`);
    for (const sql of STATEMENTS) await q.query(sql);
    await q.query(
      `INSERT INTO bot_state (key, value) VALUES ('schema_version', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify(SCHEMA_VERSION)],
    );
  });
}

/** Один раз на экземпляр; неудача не кэшируется — следующий запрос попробует снова. */
export function ensureSchema(db: Db): Promise<void> {
  if (!ready) {
    ready = migrate(db).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

/** Для тестов: каждая тестовая схема начинает с чистого листа. */
export function resetSchemaCache(): void {
  ready = null;
}
