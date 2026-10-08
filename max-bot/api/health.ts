import { getApp, health } from "../src/app.js";

/**
 * Проверка без секретов: настроены ли токен, база, ключи моделей. Заодно (раз в минуту на экземпляр)
 * регистрирует вебхук — после первого деплоя достаточно открыть /api/health.
 */
let lastEnsure = 0;

export async function GET(): Promise<Response> {
  const app = getApp();
  const ensure = Date.now() - lastEnsure > 60_000;
  if (ensure) lastEnsure = Date.now();
  const result = await health(app, { ensure });
  return Response.json(result, {
    status: result.ok ? 200 : 503,
    headers: { "cache-control": "no-store" },
  });
}
