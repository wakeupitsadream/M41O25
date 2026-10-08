import pg from "pg";
import { createDb, getPool, type Db } from "./pool.js";
import { ensureSchema, resetSchemaCache } from "./schema.js";
import { createStore, type Store } from "./store.js";

/** Тестовая база: отдельная схема на файл тестов, чтобы файлы не мешали друг другу при параллельном запуске. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/maxbot_test";

export async function testStore(): Promise<{ db: Db; store: Store; close: () => Promise<void> }> {
  const schema = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const pool = getPool(TEST_DATABASE_URL, { searchPath: schema });
  const db = createDb(pool);
  resetSchemaCache();
  await ensureSchema(db);
  return {
    db,
    store: createStore(db),
    close: async () => {
      await pool.query(`DROP SCHEMA ${schema} CASCADE`);
      await pool.end();
    },
  };
}
