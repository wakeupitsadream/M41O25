// Сборка для Vercel: миграции применяются к базе из DATABASE_URL в production-сборке
// (или в preview с MIGRATE_ON_BUILD=1), затем при заданном SEED_ADMIN_NAME создаётся группа и админ (идемпотентно), затем обычная
// сборка Next.js (webpack — нужен для Serwist).
import { spawnSync } from "node:child_process";

const run = (cmd, args) => {
  const res = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (res.status !== 0) process.exit(res.status ?? 1);
};

const onVercel = Boolean(process.env.VERCEL);
const hasDb = Boolean(process.env.DATABASE_URL);
// Мигрируем только ту базу, которую сборке дали намеренно: production-сборка, либо preview
// с явным MIGRATE_ON_BUILD=1 (пока код деплоится из ветки). Иначе preview любой ветки трогал бы прод.
const allowed = process.env.VERCEL_ENV === "production" || process.env.MIGRATE_ON_BUILD === "1";

if (onVercel && hasDb && allowed) {
  console.log(`[build] Vercel (${process.env.VERCEL_ENV}) + DATABASE_URL → применяю миграции`);
  run("npx", ["tsx", "scripts/migrate.ts"]);
  if (process.env.SEED_ADMIN_NAME) {
    console.log("[build] SEED_ADMIN_NAME задан → создаю группу и админа, если их ещё нет");
    run("npx", ["tsx", "scripts/seed.ts"]);
  }
} else {
  console.log(
    `[build] миграции пропущены (VERCEL=${onVercel ? "да" : "нет"}, DATABASE_URL=${hasDb ? "есть" : "нет"}, VERCEL_ENV=${process.env.VERCEL_ENV ?? "-"}, MIGRATE_ON_BUILD=${process.env.MIGRATE_ON_BUILD ?? "-"})`,
  );
}

run("npx", ["next", "build"]);
