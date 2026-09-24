import "server-only";
import { and, eq, gte, lt, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assistantMessages, assistantPayments, users } from "@/lib/db/schema";
import { addDaysIso, startOfDayTz } from "@/lib/tz";
import type { MonthSummaryInput } from "./finance";

/**
 * Первое число календарного месяца группы. Берётся из todayIso(), а не из new Date(): в первые пять часов суток
 * по Оренбургу сервер Vercel (UTC) живёт ещё во вчерашнем — и 1-го числа показал бы прошлый месяц.
 */
export const monthStartIso = (today: string) => `${today.slice(0, 7)}-01`;

/**
 * Сырые цифры для карточки «Помощник за месяц» (docs/AI-CHAT.md §9); проценты и цвет — monthSummary из finance.ts.
 *
 * Выручка — платежи с начала суток monthStart до конца суток today в поясе группы: created_at — timestamptz, граница
 * «1-е число» считается в Оренбурге, а не в UTC, и сравнение идёт по индексу (group_id, created_at).
 * Расход и активность — по assistant_messages.day (сутки группы на момент отправки): у сообщений нет group_id,
 * группу даёт автор, а индекс (user_id, day) отбирает месяц. Сообщения считаем студенческие — это то, что человек
 * видит в своих лимитах; расход — по ответам, у них и лежит cost_kopecks.
 */
export async function monthFinance(groupId: string, monthStart: string, today: string): Promise<MonthSummaryInput> {
  const [[pay], [msg]] = await Promise.all([
    db
      .select({ revenue: sql<number>`coalesce(sum(${assistantPayments.amountRub}), 0)`.mapWith(Number) })
      .from(assistantPayments)
      .where(
        and(
          eq(assistantPayments.groupId, groupId),
          gte(assistantPayments.createdAt, startOfDayTz(monthStart)),
          lt(assistantPayments.createdAt, startOfDayTz(addDaysIso(today, 1))),
        ),
      ),
    db
      .select({
        cost: sql<number>`coalesce(sum(${assistantMessages.costKopecks}) filter (where ${assistantMessages.role} = 'assistant'), 0)`.mapWith(Number),
        messages: sql<number>`count(*) filter (where ${assistantMessages.role} = 'user')`.mapWith(Number),
        activeUsers: sql<number>`count(distinct ${assistantMessages.userId})`.mapWith(Number),
      })
      .from(assistantMessages)
      .innerJoin(users, eq(users.id, assistantMessages.userId))
      .where(and(eq(users.groupId, groupId), gte(assistantMessages.day, monthStart), lte(assistantMessages.day, today))),
  ]);
  return { revenueRub: pay?.revenue ?? 0, costKopecks: msg?.cost ?? 0, messages: msg?.messages ?? 0, activeUsers: msg?.activeUsers ?? 0 };
}
