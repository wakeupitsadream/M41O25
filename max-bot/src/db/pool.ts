import { attachDatabasePool } from "@vercel/functions";
import pg from "pg";

/** Узкий интерфейс поверх pg: хранилище не знает про пул, тесты подставляют свою схему через search_path. */
export type Db = {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  /** Транзакция на одном соединении; с пулером Neon (режим transaction) работают и pg_advisory_xact_lock. */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
};

// int8 (bigint) → number: id чатов и пользователей MAX укладываются в 2^53.
const INT8_OID = 20;
const types = {
  getTypeParser: (oid: number, format?: "text" | "binary") =>
    oid === INT8_OID ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format as "text"),
};

const pools = new Map<string, pg.Pool>();

/**
 * Neon выдаёт строку с sslmode=require; node-postgres трактует его как verify-full и пишет «SECURITY WARNING»
 * на каждом подключении. Переписываем режим явно — поведение то же, лог чистый (как lib/db/url.ts в Raspison).
 */
export function normalizeDatabaseUrl(url: string): string {
  if (/[?&]uselibpqcompat=/.test(url)) return url;
  return url.replace(/([?&])sslmode=(?:require|prefer|verify-ca)(?=&|$)/, "$1sslmode=verify-full");
}

export function getPool(url: string, options: { searchPath?: string } = {}): pg.Pool {
  const key = `${url}#${options.searchPath ?? ""}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new pg.Pool({
      connectionString: normalizeDatabaseUrl(url),
      max: 3,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      types,
      options: options.searchPath ? `-c search_path=${options.searchPath}` : undefined,
    });
    pool.on("error", () => {
      // Простаивающее соединение закрыл сервер (Neon засыпает) — пул сам откроет новое.
    });
    // Fluid compute: Vercel закрывает простаивающие соединения перед заморозкой экземпляра.
    if (process.env.VERCEL) attachDatabasePool(pool);
    pools.set(key, pool);
  }
  return pool;
}

function wrapClient(client: pg.PoolClient): Db {
  const db: Db = {
    query: async <T,>(text: string, params?: unknown[]) => {
      const res = await client.query(text, params);
      return { rows: res.rows as T[], rowCount: res.rowCount };
    },
    tx: (fn) => fn(db),
  };
  return db;
}

export function createDb(pool: pg.Pool): Db {
  return {
    query: async <T,>(text: string, params?: unknown[]) => {
      const res = await pool.query(text, params);
      return { rows: res.rows as T[], rowCount: res.rowCount };
    },
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrapClient(client));
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
