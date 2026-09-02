import { config } from "dotenv";
config({ path: [".env.local", ".env"] });
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("[migrate] готово");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
