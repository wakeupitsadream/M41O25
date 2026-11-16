import { dailyMaintenance, getApp, secretMatches } from "../src/app.js";
import { errorText, log } from "../src/log.js";

/** Ежедневно (vercel.json → crons): переподписать вебхук, почистить старое, обновить предметы из Raspison. */
export async function GET(request: Request): Promise<Response> {
  const app = getApp();
  const secret = app.config.cronSecret;
  if (secret && !secretMatches(request.headers.get("authorization"), `Bearer ${secret}`)) {
    return new Response("forbidden", { status: 403 });
  }
  if (!app.config.databaseUrl || !app.config.maxToken) return new Response("not configured", { status: 503 });
  try {
    const result = await dailyMaintenance(app);
    log("info", "cron_done", result);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    log("error", "cron_failed", { error: errorText(err) });
    return Response.json({ ok: false, error: errorText(err) }, { status: 500 });
  }
}
