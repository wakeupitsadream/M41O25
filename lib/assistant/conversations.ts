import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assistantConversations } from "@/lib/db/schema";
import { findOwnConversation, loadMessages, toConversationInfo } from "./store";
import type { ChatMessage, ConversationInfo, ConversationListItem } from "./types";

/*
 * Список бесед и беседа целиком — единственное место этих выборок: их берут серверные страницы раздела, server
 * actions (actions.ts) и GET-роуты клиента чата. Раньше копий было три, и порядок сообщений в них уже разошёлся.
 * Правила: только свои беседы своей группы, ≤ 50, превью — последнее сообщение одной строкой.
 */

const MAX_CONVERSATIONS = 50;
const PREVIEW_CHARS = 120;
const UNTITLED = "Без названия";

type Owner = { id: string; groupId: string };

/** Неархивные беседы, свежие сверху. */
export async function listConversationsFor(user: Owner): Promise<ConversationListItem[]> {
  // Коррелированный подзапрос вместо join с group by: бесед ≤ 50, а сообщений у каждой — сотни. Внешняя таблица —
  // квалифицированно: голый "id" внутри подзапроса разрешился бы в m.id, и превью всегда было бы пустым.
  // Порядок (created_at, id) — как MESSAGE_ORDER в store.ts: у ответа created_at = вопрос + 1 мс, и при равенстве
  // времени последним должен оказаться тот же, что и в ленте.
  const preview = sql<string | null>`(
    select left(regexp_replace(m.content, '[[:space:]]+', ' ', 'g'), ${PREVIEW_CHARS})
    from assistant_messages m
    where m.conversation_id = ${assistantConversations}."id"
    order by m.created_at desc, m.id desc
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

/** Беседа с сообщениями по порядку; чужая или несуществующая — null (отдаём 404, не раскрывая, что id есть). */
export async function loadConversationFor(id: string, user: Owner): Promise<{ conversation: ConversationInfo; messages: ChatMessage[] } | null> {
  const c = await findOwnConversation(id, user);
  if (!c) return null;
  return { conversation: toConversationInfo(c), messages: await loadMessages(c.id, user.id) };
}
