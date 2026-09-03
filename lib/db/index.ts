import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

type Db = NodePgDatabase<typeof schema>;
type Conn = { pool: Pool; db: Db };

const globalForDb = globalThis as unknown as { __raspisonDb?: Conn };

function connect(): Conn {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан — база не подключена");
  const pool = new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

// Подключение создаётся при первом запросе, а не при импорте: Next импортирует роуты на этапе
// сборки («Collecting page data»), и без DATABASE_URL сборка не должна падать.
// В dev горячая перезагрузка пересоздаёт модули — соединение кешируем в globalThis.
let conn: Conn | undefined = globalForDb.__raspisonDb;
function getConn(): Conn {
  if (!conn) {
    conn = connect();
    if (process.env.NODE_ENV !== "production") globalForDb.__raspisonDb = conn;
  }
  return conn;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getConn().db as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(real) : value;
  },
});

export const getPool = () => getConn().pool;
export { schema };
