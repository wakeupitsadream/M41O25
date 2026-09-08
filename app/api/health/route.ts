import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Самая дешёвая проверка «сервер вообще жив»: без базы, без cookie, без секретов — иначе она врала бы
 * ровно тогда, когда нужна (упавшая база — самая частая поломка). Отвечает экрану ошибки и человеку с телефона.
 *
 * `env` и `branch` берём из переменных Vercel: по ним видно, что открыта preview-копия ветки, а не рабочее
 * приложение — тот случай, когда «у меня всё сломалось» лечится переустановкой ярлыка с raspison.vercel.app.
 * Ни то, ни другое не секрет: репозиторий публичный. Кеширование запрещено и заголовком, и узким SW (app/sw.ts).
 */
export function GET() {
  return NextResponse.json(
    {
      ok: true,
      env: process.env.VERCEL_ENV ?? "development",
      branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
      time: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
