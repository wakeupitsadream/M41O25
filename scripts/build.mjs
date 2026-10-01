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
const production = process.env.VERCEL_ENV === "production";

// Пустой секрет рядом с базой — это подписанные пустым ключом cookie и ссылки на файлы и cron, который навсегда
// отвечает 401. Правило простое: у сборки есть DATABASE_URL (production всегда, preview — если дали намеренно) →
// секреты обязаны быть. Production без DATABASE_URL раньше собирался молча («миграции пропущены») и выкатывался
// с 500 на каждом запросе — теперь это ошибка сборки.
if (onVercel && (production || hasDb)) {
  const required = ["AUTH_SECRET", "ANON_PEPPER", "CRON_SECRET", ...(production ? ["DATABASE_URL"] : [])];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[build] Не заданы переменные: ${missing.join(", ")}. Добавь их в Vercel → Settings → Environment Variables (секреты — openssl rand -base64 32).`);
    process.exit(1);
  }
}

// Ключи VAPID проверяем здесь, а не в момент первой рассылки: пара из разных генераций проходит по формату, но каждый
// пуш получает 400/403 от Apple/Google, и ночной cron за восемь новостей молча удалил бы все подписки группы.
const vapid = ["NEXT_PUBLIC_VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
if (vapid.some((k) => process.env[k])) {
  const missing = vapid.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[build] Web Push настроен наполовину: нет ${missing.join(", ")}. Нужны все три переменные или ни одной.`);
    process.exit(1);
  }
  try {
    const { default: webpush } = await import("web-push");
    webpush.setVapidDetails(process.env.VAPID_SUBJECT, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  } catch (e) {
    console.error(`[build] Ключи VAPID не принимаются web-push: ${e instanceof Error ? e.message : e}. Сгенерируй пару заново: npx web-push generate-vapid-keys`);
    process.exit(1);
  }
}
// Мигрируем только ту базу, которую сборке дали намеренно: production-сборка, либо preview
// с явным MIGRATE_ON_BUILD=1 (пока код деплоится из ветки). Иначе preview любой ветки трогал бы прод.
const allowed = production || process.env.MIGRATE_ON_BUILD === "1";

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

run("npx", ["next", "build", "--webpack"]);
