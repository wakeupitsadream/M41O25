import "server-only";
import webpush from "web-push";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { pushSubscriptions, users } from "@/lib/db/schema";
import { env } from "@/lib/env";
import { classifyPushError, shortError } from "@/lib/push/errors";
import { buildNotification, topicOf, type PushEvent } from "@/lib/push/format";
import { pickTargets, type PushTarget } from "@/lib/push/targets";

/**
 * Отправка Web Push. Правило номер один: пуш никогда не роняет и не задерживает само действие — вызывать только
 * из after() и ловить всё. Ключей VAPID нет → функция молча ничего не делает, приложение работает как раньше.
 */

export const pushConfigured = () => env.push.configured;

let vapidReady: boolean | null = null;

function ensureVapid(): boolean {
  if (vapidReady !== null) return vapidReady;
  if (!env.push.configured) return (vapidReady = false);
  try {
    webpush.setVapidDetails(env.push.subject, env.push.publicKey, env.push.privateKey);
    vapidReady = true;
  } catch (e) {
    console.error("[push] некорректные ключи VAPID:", shortError(e));
    vapidReady = false;
  }
  return vapidReady;
}

export type NotifyResult = { sent: number; gone: number; failed: number; skipped?: string };

/**
 * Разослать событие группе. exceptUserId — автор действия, ему не шлём (у анонимного вопроса автора нет: null).
 * Мёртвые подписки (404/410) удаляются тут же, остальные ошибки копятся в fail_count — чистит ночной cron.
 */
export async function notifyGroup(event: PushEvent, opts: { groupId: string; exceptUserId?: string | null }): Promise<NotifyResult> {
  const empty: NotifyResult = { sent: 0, gone: 0, failed: 0 };
  if (!ensureVapid()) return { ...empty, skipped: "VAPID не настроен" };

  let targets: PushTarget[];
  try {
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        userId: pushSubscriptions.userId,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
        topics: pushSubscriptions.topics,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(users.id, pushSubscriptions.userId))
      .where(and(eq(users.groupId, opts.groupId), eq(users.status, "active")));
    targets = pickTargets(rows, { topic: topicOf(event.kind), exceptUserId: opts.exceptUserId ?? null });
  } catch (e) {
    console.error("[push] не прочитались подписки:", shortError(e));
    return { ...empty, skipped: "база недоступна" };
  }
  if (targets.length === 0) return empty;

  // tag делаем уникальным: с общим тегом вторая новость за день молча заменила бы первую на экране блокировки.
  const notification = buildNotification(event);
  const payload = JSON.stringify({ ...notification, tag: `${notification.tag}-${Date.now()}` });
  const okIds: string[] = [];
  const goneIds: string[] = [];
  const broken: { id: string; error: string }[] = [];

  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification({ endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } }, payload, {
        TTL: 24 * 3600,
        urgency: "normal",
      }),
    ),
  );

  results.forEach((r, i) => {
    const target = targets[i];
    if (r.status === "fulfilled") return okIds.push(target.id);
    const verdict = classifyPushError(r.reason);
    if (verdict === "gone") goneIds.push(target.id);
    else if (verdict === "broken") broken.push({ id: target.id, error: shortError(r.reason) });
    else console.warn("[push] push-сервис недоступен:", shortError(r.reason));
  });

  try {
    if (okIds.length) {
      await db
        .update(pushSubscriptions)
        .set({ lastSuccessAt: new Date(), failCount: 0, lastError: null })
        .where(inArray(pushSubscriptions.id, okIds));
    }
    if (goneIds.length) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, goneIds));
    for (const b of broken) {
      await db
        .update(pushSubscriptions)
        .set({ failCount: sql`${pushSubscriptions.failCount} + 1`, lastError: b.error })
        .where(eq(pushSubscriptions.id, b.id));
    }
  } catch (e) {
    console.error("[push] не записалось состояние подписок:", shortError(e));
  }

  return { sent: okIds.length, gone: goneIds.length, failed: broken.length + (results.length - okIds.length - goneIds.length - broken.length) };
}

/**
 * Обёртка для вызова из after(): ошибок наружу не выпускает вообще. Новость важнее пуша о ней —
 * если рассылка упала, запись всё равно создана и видна в приложении.
 */
export function notifyQuietly(event: PushEvent, opts: { groupId: string; exceptUserId?: string | null }): Promise<void> {
  return notifyGroup(event, opts).then(
    (r) => {
      if (r.skipped) console.warn(`[push] ${event.kind}: пропущено (${r.skipped})`);
      else console.log(`[push] ${event.kind}: отправлено ${r.sent}, мёртвых ${r.gone}, ошибок ${r.failed}`);
    },
    (e) => console.error(`[push] ${event.kind}: не отправлено:`, shortError(e)),
  );
}
