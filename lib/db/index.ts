import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { __raspisonPool?: Pool };

function createPool() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  return new Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
}

// В dev горячая перезагрузка пересоздаёт модули — пул кешируем в globalThis.
export const pool = globalForDb.__raspisonPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__raspisonPool = pool;

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });
export { schema };
