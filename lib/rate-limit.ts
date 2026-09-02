import "server-only";
import { and, count, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { activity } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";

export const CREATE_EVENTS = ["hw_added", "hw_edit_added", "comment_added", "poll_created", "news_added", "task_added"] as const;

const LIMIT_PER_HOUR = 15;

/**
 * 15 создающих действий в час на человека (ДЗ, правки, комментарии, опросы). Считается прямо в Postgres по ленте
 * activity — без Redis. Админ и староста без лимита: им приходится массово наполнять.
 */
export async function assertRate(user: SessionUser) {
  if (user.role !== "student") return;
  const since = new Date(Date.now() - 60 * 60_000);
  const [{ n }] = await db
    .select({ n: count() })
    .from(activity)
    .where(and(eq(activity.actorId, user.id), gt(activity.createdAt, since), inArray(activity.eventType, [...CREATE_EVENTS])));
  if (n >= LIMIT_PER_HOUR) throw new Error("Слишком много записей за час. Остынь минутку — лимит снимется сам.");
}
