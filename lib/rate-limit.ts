import "server-only";
import { and, count, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { activity } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";

export const CREATE_EVENTS = ["hw_added", "hw_updated", "hw_edit_added", "comment_added", "poll_created", "news_added", "task_added"] as const;

const LIMIT_PER_HOUR = 15;

/**
 * 15 создающих действий в час на человека (ДЗ, правки, комментарии, опросы). Считается прямо в Postgres по ленте
 * activity — без Redis. Админ и староста без лимита: им приходится массово наполнять.
 *
 * Известная дыра, которую этот счётчик НЕ закрывает: hw_updated считается по строкам ленты, а правки одной записи
 * за сутки сливаются в ОДНО событие (app/(app)/hw/actions.ts, updateHomework). Поэтому «подвинул дедлайн туда-сюда
 * у одной и той же записи» — самый шумный сценарий, по одному пушу на каждое движение — для счётчика выглядит как
 * одна правка и в лимит почти не упирается. Ограничен тут только разброс правок по РАЗНЫМ записям. Честно закрыть
 * это можно, только храня историю разосланных уведомлений — отдельная работа, её здесь нет.
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
