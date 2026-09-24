"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { assistantAccess, assistantConversations } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { wrapAction } from "@/lib/actions";
import { todayIso } from "@/lib/tz";
import { asUuid, fail, ok, type ActionResult } from "@/lib/utils";
import { accessStatus, trialUntil } from "@/lib/assistant/access";
import { buildState, getAccessRow, getSettings } from "@/lib/assistant/store";
import { listConversationsFor, loadConversationFor } from "@/lib/assistant/conversations";
import type { AssistantState, ChatMessage, ConversationInfo, ConversationListItem } from "@/lib/assistant/types";

/**
 * Server actions раздела «Помощник» (docs/AI-CHAT.md §7). Отправка сообщений — не здесь, а в стрим-роуте
 * POST /api/assistant/chat. Все выборки — только свои беседы (user_id) и только своей группы.
 */

const SECTION = "/group/assistant";
const TITLE_MAX = 80;

const titleSchema = z.string().trim().min(1, "Название пустое").max(TITLE_MAX, `Название — не длиннее ${TITLE_MAX} символов`);

const own = (conversationId: string, user: { id: string; groupId: string }) =>
  and(eq(assistantConversations.id, conversationId), eq(assistantConversations.userId, user.id), eq(assistantConversations.groupId, user.groupId));

/**
 * Старт пробного периода — явной кнопкой, чтобы человек знал, что отсчёт пошёл. Только из состояния none:
 * строка assistant_access появляется один раз и больше не удаляется, второго триала не бывает.
 */
export async function startTrial(): Promise<ActionResult<{ until: string }>> {
  return wrapAction(async () => {
    const user = await actionUser();
    const settings = getSettings(user.group);
    if (!settings.enabled) return fail("Помощник пока выключен — спроси у старосты");
    if (settings.trialDays <= 0) return fail("Пробного периода нет — доступ включает админ после оплаты");
    const today = todayIso();
    const status = accessStatus(today, await getAccessRow(user.id));
    if (status.kind === "expired") return fail("Пробный период уже был — дальше по оплате");
    if (status.kind !== "none") return fail("Доступ уже есть");
    // on conflict do nothing: двойной тап или два устройства разом — второй строки не будет, вернётся отказ.
    const [row] = await db
      .insert(assistantAccess)
      .values({ userId: user.id, trialUntil: trialUntil(today, settings.trialDays), updatedBy: user.id })
      .onConflictDoNothing()
      .returning({ trialUntil: assistantAccess.trialUntil });
    if (!row?.trialUntil) return fail("Пробный период уже начат");
    revalidatePath("/group");
    revalidatePath(SECTION);
    return ok({ until: row.trialUntil });
  });
}

/** Неархивные беседы, свежие сверху, ≤ 50 (lib/assistant/conversations.ts — единственное место выборки). */
export async function listConversations(): Promise<ActionResult<{ items: ConversationListItem[] }>> {
  return wrapAction(async () => {
    const user = await actionUser();
    return ok({ items: await listConversationsFor(user) });
  });
}

/** Беседа с сообщениями. Архивная тоже открывается — это своя история, а не удалённая. */
export async function getConversation(id: string): Promise<ActionResult<{ conversation: ConversationInfo; messages: ChatMessage[] }>> {
  return wrapAction(async () => {
    const user = await actionUser();
    const cid = asUuid(id);
    const found = cid ? await loadConversationFor(cid, user) : null;
    return found ? ok(found) : fail("Беседа не найдена");
  });
}

/** Переименование не трогает updated_at: список сортируется по последнему сообщению, а не по правке заголовка. */
export async function renameConversation(id: string, title: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const cid = asUuid(id);
    if (!cid) return fail("Беседа не найдена");
    const parsed = titleSchema.safeParse(title);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const rows = await db.update(assistantConversations).set({ title: parsed.data }).where(own(cid, user)).returning({ id: assistantConversations.id });
    if (rows.length === 0) return fail("Беседа не найдена");
    revalidatePath(SECTION);
    return ok();
  });
}

/** Архив вместо удаления: сообщения, их вложения и статистика расходов остаются. Повторный вызов — не ошибка. */
export async function archiveConversation(id: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const cid = asUuid(id);
    if (!cid) return fail("Беседа не найдена");
    const rows = await db
      .update(assistantConversations)
      .set({ archivedAt: sql`coalesce(${assistantConversations.archivedAt}, now())` })
      .where(own(cid, user))
      .returning({ id: assistantConversations.id });
    if (rows.length === 0) return fail("Беседа не найдена");
    revalidatePath(SECTION);
    return ok();
  });
}

export async function getAssistantState(): Promise<ActionResult<AssistantState>> {
  return wrapAction(async () => {
    const user = await actionUser();
    return ok(await buildState(user));
  });
}
