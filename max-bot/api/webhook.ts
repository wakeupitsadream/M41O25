import { waitUntil } from "@vercel/functions";
import { getApp, invocationDeadline, processUpdate, secretMatches } from "../src/app.js";
import { log } from "../src/log.js";
import type { Update } from "../src/max/types.js";

/**
 * Вход событий MAX. Отвечаем 200 сразу, а думаем в фоне (waitUntil, до 300 с на Hobby с Fluid compute):
 * иначе MAX повторит событие, не дождавшись ответа, и пользователь получит два ответа.
 */
export async function POST(request: Request): Promise<Response> {
  const app = getApp();
  if (!app.config.maxToken || !app.config.databaseUrl) return new Response("not configured", { status: 503 });
  if (!secretMatches(request.headers.get("x-max-bot-api-secret"), app.config.webhookSecret)) {
    log("warn", "webhook_bad_secret");
    return new Response("forbidden", { status: 403 });
  }
  let update: Update;
  try {
    update = (await request.json()) as Update;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (!update || typeof update.update_type !== "string") return new Response("bad update", { status: 400 });
  waitUntil(processUpdate(app, update, invocationDeadline()));
  return new Response("ok");
}

export function GET(): Response {
  return new Response("MAX webhook: ожидаю POST от MAX", { headers: { "content-type": "text/plain; charset=utf-8" } });
}
