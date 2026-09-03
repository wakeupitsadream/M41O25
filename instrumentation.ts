/**
 * Next.js вызывает onRequestError для необработанных ошибок RSC, роутов и server actions.
 * Пишем их в app_errors: логи Vercel Hobby живут около часа, а сводка нужна в админке через день.
 * Импорт базы — только внутри if по NEXT_RUNTIME: так webpack не тянет pg в edge-сборку.
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (!process.env.DATABASE_URL) return;
    try {
      const { logAppError } = await import("./lib/errors");
      const e = err as { message?: string; digest?: string };
      await logAppError({
        route: `${request.method} ${context.routePath || request.path}`,
        message: typeof e?.message === "string" ? e.message : String(err),
        digest: typeof e?.digest === "string" ? e.digest : null,
        kind: context.routeType,
      });
    } catch {}
  }
}
