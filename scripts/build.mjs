// Сборка для Vercel: миграции применяются только к продовой базе (preview-деплои из веток
// не должны трогать прод), затем обычная сборка Next.js (webpack — нужен для Serwist).
import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

const isProd = process.env.VERCEL_ENV === "production";
const hasDb = Boolean(process.env.DATABASE_URL);

if (isProd && hasDb) {
  console.log("[build] VERCEL_ENV=production → применяю миграции");
  run("npx", ["tsx", "scripts/migrate.ts"]);
} else {
  console.log(`[build] миграции пропущены (VERCEL_ENV=${process.env.VERCEL_ENV ?? "local"}, DATABASE_URL=${hasDb ? "есть" : "нет"})`);
}

run("npx", ["next", "build"]);
