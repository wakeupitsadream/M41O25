import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assistantConversations, assistantMessages, type AssistantConversation } from "@/lib/db/schema";
import { loadChatAttachments, toChatMessage } from "./store";
import type { ChatMessage, ConversationInfo, ConversationListItem } from "./types";

/*
 * Выборки бесед для серверных страниц раздела (app/(app)/group/assistant/**). Server actions из RSC не вызываем:
 * у них своя обёртка ответа и своя авторизация, а странице нужны просто данные. Правила те же, что
 * в listConversations/getConversation (actions.ts): только свои беседы своей группы, ≤ 50, превью — последнее
 * сообщение одной строкой. Пока actions.ts не переведён на этот модуль, константы должны совпадать.
 */

const MAX_CONVERSATIONS = 50;
const PREVIEW_CHARS = 120;
const UNTITLED = "Без названия";

type Owner = { id: string; groupId: string };

const own = (conversationId: string, user: Owner) =>
  and(eq(assistantConversations.id, conversationId), eq(assistantConversations.userId, user.id), eq(assistantConversations.groupId, user.groupId));

const toInfo = (c: AssistantConversation): ConversationInfo => ({
  id: c.id,
  title: c.title?.trim() || UNTITLED,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
  archivedAt: c.archivedAt?.toISOString() ?? null,
});

/** Неархивные беседы, свежие сверху. */
export async function listConversationsFor(user: Owner): Promise<ConversationListItem[]> {
  // Коррелированный подзапрос вместо join с group by: бесед ≤ 50, а сообщений у каждой — сотни. Внешняя таблица —
  // квалифицированно: голый "id" внутри подзапроса разрешился бы в m.id, и превью всегда было бы пустым.
  const preview = sql<string | null>`(
    select left(regexp_replace(m.content, '[[:space:]]+', ' ', 'g'), ${PREVIEW_CHARS})
    from assistant_messages m
    where m.conversation_id = ${assistantConversations}."id"
    order by m.created_at desc
    limit 1
  )`;
  const rows = await db
    .select({ id: assistantConversations.id, title: assistantConversations.title, updatedAt: assistantConversations.updatedAt, preview })
    .from(assistantConversations)
    .where(and(eq(assistantConversations.userId, user.id), eq(assistantConversations.groupId, user.groupId), isNull(assistantConversations.archivedAt)))
    .orderBy(desc(assistantConversations.updatedAt))
    .limit(MAX_CONVERSATIONS);
  return rows.map((r) => ({ id: r.id, title: r.title?.trim() || UNTITLED, updatedAt: r.updatedAt.toISOString(), preview: r.preview?.trim() ?? "" }));
}

/** Беседа с сообщениями по порядку; чужая или несуществующая — null (страница отдаёт 404, не раскрывая, что id есть). */
export async function loadConversationFor(id: string, user: Owner): Promise<{ conversation: ConversationInfo; messages: ChatMessage[] } | null> {
  const [c] = await db.select().from(assistantConversations).where(own(id, user));
  if (!c) return null;
  const rows = await db.select().from(assistantMessages).where(eq(assistantMessages.conversationId, c.id)).orderBy(asc(assistantMessages.createdAt));
  const atts = await loadChatAttachments(
    rows.flatMap((r) => r.attachmentIds),
    user.id,
  );
  return { conversation: toInfo(c), messages: rows.map((r) => toChatMessage(r, atts)) };
}
