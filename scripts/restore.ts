import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { Pool } from "pg";

/**
 * Восстановление из JSON-дампа cron-бэкапа: npm run db:restore -- path/to/2026-09-02.json.gz
 * Порядок таблиц важен (внешние ключи). Существующие данные НЕ удаляются — восстанавливай в пустую базу
 * (после `npm run db:migrate`). Конфликтующие строки пропускаются.
 */
const ORDER = [
  "groups", "users", "semesters", "subjects", "weeks", "lessons", "schedule_imports", "homework", "hw_edits", "hw_done",
  "comments", "attachments", "news", "tasks", "task_checks", "polls", "poll_options", "poll_votes", "contacts", "anon_questions", "reactions", "activity",
];

const camelToSnake = (s: string) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Укажи путь к .json.gz");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const raw = readFileSync(file);
  const json = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString()) as { tables: Record<string, Record<string, unknown>[]> };
  const pool = new Pool({ connectionString: url, max: 1 });
  let total = 0;
  for (const table of ORDER) {
    const rows = json.tables[table] ?? [];
    for (const row of rows) {
      const cols = Object.keys(row);
      const values = cols.map((c) => {
        const v = row[c];
        return v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v;
      });
      const sql = `insert into "${table}" (${cols.map((c) => `"${camelToSnake(c)}"`).join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing`;
      await pool.query(sql, values);
      total++;
    }
    console.log(`[restore] ${table}: ${rows.length}`);
  }
  await pool.end();
  console.log(`[restore] готово, строк: ${total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
