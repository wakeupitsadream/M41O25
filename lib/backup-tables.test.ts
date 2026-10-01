import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { BACKUP_ARRAY_COLUMNS, BACKUP_EXCLUDED, BACKUP_TABLES } from "./backup-tables";

// Из модуля схемы берём только таблицы (там ещё enum-ы, relations и типы); is() — штатная проверка Drizzle.
const schemaTables: string[] = (Object.values(schema) as unknown[])
  .filter((v) => is(v, PgTable))
  .map((t) => getTableName(t as PgTable))
  .sort();

test("бэкап: каждая таблица схемы либо в дампе, либо исключена с причиной", () => {
  const covered = new Set<string>([...BACKUP_TABLES, ...Object.keys(BACKUP_EXCLUDED)]);
  const missing = schemaTables.filter((t) => !covered.has(t));
  assert.deepEqual(missing, [], `таблицы без решения о бэкапе: ${missing.join(", ")}`);
  // И наоборот: в списках нет таблиц, которых уже нет в схеме.
  const unknown = [...covered].filter((t) => !schemaTables.includes(t));
  assert.deepEqual(unknown, []);
  const twice = BACKUP_TABLES.filter((t) => t in BACKUP_EXCLUDED);
  assert.deepEqual(twice, []);
});

test("бэкап: порядок восстановления — родители раньше детей (users до push_subscriptions, polls до poll_votes)", () => {
  const idx = (t: string) => BACKUP_TABLES.indexOf(t as (typeof BACKUP_TABLES)[number]);
  assert.ok(idx("groups") < idx("users"));
  assert.ok(idx("users") < idx("push_subscriptions"));
  assert.ok(idx("weeks") < idx("lessons"));
  assert.ok(idx("homework") < idx("hw_edits") && idx("hw_edits") < idx("attachments"));
  assert.ok(idx("polls") < idx("poll_options") && idx("poll_options") < idx("poll_votes"));
  assert.ok(idx("assistant_conversations") < idx("assistant_messages"));
});

test("бэкап: массивные колонки указаны по существующим таблицам", () => {
  for (const col of BACKUP_ARRAY_COLUMNS) {
    const [table] = col.split(".");
    assert.ok((BACKUP_TABLES as readonly string[]).includes(table), col);
  }
});
