import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { normalizeDatabaseUrl } from "../lib/db/url";
import { invitePrefix } from "../lib/invite";
import { generateInviteSuffix } from "../lib/utils";

/**
 * Восстановление из JSON-дампа (cron-бэкап или «Скачать сейчас» в админке):
 *   npm run db:restore -- path/to/2026-09-03.json.gz [--truncate] [--keep-code]
 *
 * Всё в одной транзакции: при любой ошибке база остаётся как была. Порядок таблиц важен (внешние ключи).
 * --truncate   очистить таблицы перед восстановлением (иначе восстанавливай в пустую базу после db:migrate;
 *              конфликтующие строки пропускаются).
 * В дампе нет pin_hash — после восстановления все профили свободны, и первым войти должен админ. Поэтому
 * инвайт-код меняется на новый и печатается; --keep-code оставляет код из дампа.
 */
const ORDER = [
  "groups", "users", "semesters", "subjects", "weeks", "lessons", "schedule_imports", "homework", "hw_edits", "hw_done",
  "comments", "attachments", "news", "tasks", "task_checks", "polls", "poll_options", "poll_votes", "contacts", "anon_questions", "reactions", "activity",
];

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

/** Колонки-массивы Postgres (text[]): их pg сериализует сам, а JSON.stringify дал бы `["a"]` вместо `{a}`. Остальные объекты — jsonb. */
const ARRAY_COLUMNS = new Set(["subjects.aliases"]);

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const truncate = args.includes("--truncate");
  const keepCode = args.includes("--keep-code");
  if (!file) throw new Error("Укажи путь к .json.gz");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const raw = readFileSync(file);
  const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString()) as {
    createdAt?: string;
    tables: Record<string, Record<string, unknown>[]>;
  };
  console.log(`[restore] дамп от ${json.createdAt ?? "?"}, таблиц: ${Object.keys(json.tables).length}`);

  const pool = new Pool({ connectionString: normalizeDatabaseUrl(url), max: 1 });
  const client = await pool.connect();
  let total = 0;
  try {
    await client.query("begin");
    if (truncate) {
      await client.query(`truncate ${[...ORDER].reverse().map((t) => `"${t}"`).join(", ")}, "device_sessions", "auth_attempts", "anon_quota" cascade`);
      console.log("[restore] таблицы очищены");
    }
    for (const table of ORDER) {
      const rows = json.tables[table] ?? [];
      for (const row of rows) {
        const cols = Object.keys(row);
        const values = cols.map((c) => {
          const v = row[c];
          if (Array.isArray(v) && ARRAY_COLUMNS.has(`${table}.${c}`)) return v;
          return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
        });
        const sql = `insert into "${table}" (${cols.map((c) => `"${camelToSnake(c)}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing`;
        const res = await client.query(sql, values);
        total += res.rowCount ?? 0;
      }
      console.log(`[restore] ${table}: ${rows.length}`);
    }
    if (!keepCode) {
      const groups = await client.query<{ id: string; short_name: string }>('select id, short_name from "groups"');
      for (const g of groups.rows) {
        const code = `${invitePrefix(g.short_name)}-${generateInviteSuffix()}`;
        await client.query('update "groups" set invite_code = $1 where id = $2', [code, g.id]);
        console.log(`[restore] новый инвайт-код группы ${g.short_name}: ${code} — войди первым и задай PIN`);
      }
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(`[restore] готово, вставлено строк: ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
