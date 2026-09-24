import "server-only";
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  assistantAccess,
  assistantConversations,
  assistantMessages,
  assistantQuota,
  attachments,
  type AssistantAccessRow,
  type AssistantConversation,
  type AssistantMessage,
  type Group,
} from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";
import { mondayIso, todayIso } from "@/lib/tz";
import { accessStatus, isAccessActive } from "./access";
import { BUDGET_WINDOW_DAYS, budgetKopecks, canSend, limitsView, type LimitCounts } from "./limits";
import { withDefaults } from "./settings";
import type { AssistantSettings, AssistantState, ChatAttachment, ChatMessage, ConversationInfo } from "./types";

/**
 * Доступ к данным помощника поверх Drizzle: всё, что нужно и server actions, и стрим-роуту, лежит здесь,
 * чтобы правила (кто видит файл, как считается неделя, как резервируется лимит) были в одном месте.
 */

/** Настройки группы с умолчаниями. Группа уже есть в сессии (user.group), лишнего запроса не нужно. */
export const getSettings = (group: Pick<Group, "assistantSettings">): AssistantSettings => withDefaults(group.assistantSettings);

export async function getAccessRow(userId: string): Promise<AssistantAccessRow | null> {
  const [row] = await db.select().from(assistantAccess).where(eq(assistantAccess.userId, userId));
  return row ?? null;
}

/**
 * Потрачено за сегодня и за неделю одним запросом: неделя — сумма строк с day >= понедельника, день — та же
 * выборка с фильтром в sum. Понедельник и сегодня приходят снаружи (todayIso/mondayIso), чтобы стрим-роут
 * считал квоту и лимиты по одному и тому же дню.
 */
export async function getLimitCounts(userId: string, today: string, monday: string): Promise<LimitCounts> {
  const [[row], costKopecks30d] = await Promise.all([
    db
      .select({
        day: sql<number>`coalesce(sum(case when ${assistantQuota.day} = ${today}::date then ${assistantQuota.count} else 0 end), 0)`.mapWith(Number),
        weekTotal: sql<number>`coalesce(sum(${assistantQuota.count}), 0)`.mapWith(Number),
        strongWeek: sql<number>`coalesce(sum(${assistantQuota.strongCount}), 0)`.mapWith(Number),
      })
      .from(assistantQuota)
      .where(and(eq(assistantQuota.userId, userId), gte(assistantQuota.day, monday))),
    spentKopecks(userId),
  ]);
  return { day: row?.day ?? 0, weekTotal: row?.weekTotal ?? 0, strongWeek: row?.strongWeek ?? 0, costKopecks30d };
}

/**
 * Себестоимость ответов человека за последние BUDGET_WINDOW_DAYS дней. Скользящее окно, а не календарный месяц:
 * у каждого свой «+30 дней», и календарный сброс 1-го числа позволил бы выбрать ресурс дважды на стыке месяцев.
 * Индекс (user_id, created_at) есть.
 */
async function spentKopecks(userId: string): Promise<number> {
  const since = new Date(Date.now() - BUDGET_WINDOW_DAYS * 86_400_000);
  const [cost] = await db
    .select({ kopecks: sql<number>`coalesce(sum(${assistantMessages.costKopecks}), 0)`.mapWith(Number) })
    .from(assistantMessages)
    .where(and(eq(assistantMessages.userId, userId), gt(assistantMessages.createdAt, since)));
  return cost?.kopecks ?? 0;
}

/**
 * Счётчики «до этого сообщения» сразу после reserveQuota — для canSend в стрим-роуте. Прошлые дни недели — суммой
 * (они уже не меняются), сегодня — номер из строки резерва: upsert атомарен, и у каждой из параллельных отправок
 * свой номер. Сумма за неделю вместе с сегодняшней строкой включала бы и чужие резервы: при 44 из 45 две вкладки
 * разом видели бы по 45 и обе получали отказ, хотя одно сообщение ещё положено (то же с сильными 2 из 3).
 */
export async function getCountsBefore(
  userId: string,
  today: string,
  monday: string,
  reserved: { count: number; strongCount: number },
  strong: boolean,
): Promise<LimitCounts> {
  const [[past], costKopecks30d] = await Promise.all([
    db
      .select({
        week: sql<number>`coalesce(sum(${assistantQuota.count}), 0)`.mapWith(Number),
        strong: sql<number>`coalesce(sum(${assistantQuota.strongCount}), 0)`.mapWith(Number),
      })
      .from(assistantQuota)
      .where(and(eq(assistantQuota.userId, userId), gte(assistantQuota.day, monday), lt(assistantQuota.day, today))),
    spentKopecks(userId),
  ]);
  const day = Math.max(0, reserved.count - 1);
  const strongToday = Math.max(0, reserved.strongCount - (strong ? 1 : 0));
  return { day, weekTotal: (past?.week ?? 0) + day, strongWeek: (past?.strong ?? 0) + strongToday, costKopecks30d };
}

/**
 * Резерв лимита до похода к модели: атомарный upsert как у anon_quota, чтобы параллельные отправки с двух вкладок
 * не проскочили мимо лимита. Возвращает счётчики уже с учётом этого сообщения — превышение проверяет вызывающий
 * (canSend по недельной сумме) и при отказе возвращает резерв releaseQuota.
 */
export async function reserveQuota(userId: string, today: string, strong: boolean): Promise<{ count: number; strongCount: number }> {
  const [row] = await db
    .insert(assistantQuota)
    .values({ userId, day: today, count: 1, strongCount: strong ? 1 : 0 })
    .onConflictDoUpdate({
      target: [assistantQuota.userId, assistantQuota.day],
      set: strong
        ? { count: sql`${assistantQuota.count} + 1`, strongCount: sql`${assistantQuota.strongCount} + 1` }
        : { count: sql`${assistantQuota.count} + 1` },
    })
    .returning({ count: assistantQuota.count, strongCount: assistantQuota.strongCount });
  return row;
}

/** Откат резерва (лимит превышен, модель не ответила ни словом). Не ниже нуля: двойной откат не подарит лишнее сообщение. */
export async function releaseQuota(userId: string, today: string, strong: boolean): Promise<void> {
  await db
    .update(assistantQuota)
    .set({
      count: sql`greatest(${assistantQuota.count} - 1, 0)`,
      ...(strong ? { strongCount: sql`greatest(${assistantQuota.strongCount} - 1, 0)` } : {}),
    })
    .where(and(eq(assistantQuota.userId, userId), eq(assistantQuota.day, today)));
}

/** Всё состояние раздела для клиента: включён ли, доступ, остатки, что показать в «Как оплатить». */
export async function buildState(user: SessionUser): Promise<AssistantState> {
  const settings = getSettings(user.group);
  const today = todayIso();
  const monday = mondayIso();
  const [row, counts] = await Promise.all([getAccessRow(user.id), getLimitCounts(user.id, today, monday)]);
  const access = accessStatus(today, row);
  const limits = limitsView(settings, counts, today, monday, budgetKopecks(settings, access));
  return {
    enabled: settings.enabled,
    access,
    limits,
    settings: { priceRub: settings.priceRub, paymentNote: settings.paymentNote, trialDays: settings.trialDays },
    // Ровно та же проверка, что сделает стрим-роут: чип «Сильный» не должен обещать то, от чего сервер откажет.
    strongAvailable: isAccessActive(access) && canSend(limits, true).ok,
  };
}

/**
 * Привязка загруженных файлов к сообщению — в той же транзакции, что и вставка сообщения (по образцу claimUploads
 * из app/(app)/hw/actions.ts). Берём только свои, ничейные и именно 'assistant': чужой или уже использованный id
 * просто не привяжется. Возвращает привязанные id, чтобы вызывающий мог сравнить с запрошенными и отказать.
 */
export const claimAssistantUploads = (tx: Pick<typeof db, "update">, ids: string[], userId: string, messageId: string): Promise<{ id: string }[]> =>
  ids.length
    ? tx
        .update(attachments)
        .set({ entityId: messageId })
        .where(and(inArray(attachments.id, ids), eq(attachments.uploadedBy, userId), isNull(attachments.entityId), eq(attachments.entityType, "assistant")))
        .returning({ id: attachments.id })
    : Promise.resolve([]);

/** url без подписи: cookie есть, PWA на своём домене; подписанные ссылки для 'assistant' роут файлов всё равно не принимает. */
export const chatAttachmentUrl = (id: string) => `/api/files/${id}`;

/**
 * Вложения для ChatMessage по id из attachment_ids — только свои и только помощника: если в базу попал чужой id,
 * он молча выпадает из ответа, а не утекает именем файла.
 */
export async function loadChatAttachments(ids: string[], userId: string): Promise<Map<string, ChatAttachment>> {
  const unique = [...new Set(ids)];
  const map = new Map<string, ChatAttachment>();
  if (unique.length === 0) return map;
  const rows = await db
    .select({ id: attachments.id, name: attachments.fileName, mime: attachments.mime })
    .from(attachments)
    .where(and(inArray(attachments.id, unique), eq(attachments.uploadedBy, userId), eq(attachments.entityType, "assistant")));
  for (const r of rows) map.set(r.id, { id: r.id, name: r.name, mime: r.mime, url: chatAttachmentUrl(r.id) });
  return map;
}

/** Строка assistant_messages → ChatMessage для клиента; вложения — из карты loadChatAttachments, в порядке attachment_ids. */
export function toChatMessage(row: AssistantMessage, atts: Map<string, ChatAttachment>): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    attachments: row.attachmentIds.map((id) => atts.get(id)).filter((a): a is ChatAttachment => a !== undefined),
    strong: row.strong,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Порядок сообщений беседы везде один: created_at, потом id. Ответ пишется с created_at вопроса + 1 мс (стрим-роут),
 * поэтому пара вопрос–ответ стоит рядом, даже если ответ дописался после следующего вопроса («Стоп» → «Повторить»);
 * id — детерминированный порядок на случай равных created_at у двух вкладок.
 */
export const MESSAGE_ORDER = [asc(assistantMessages.createdAt), asc(assistantMessages.id)] as const;

/** Сообщения беседы для клиента по порядку MESSAGE_ORDER, с вложениями (только свои — см. loadChatAttachments). */
export async function loadMessages(conversationId: string, userId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(assistantMessages)
    .where(eq(assistantMessages.conversationId, conversationId))
    .orderBy(...MESSAGE_ORDER);
  const atts = await loadChatAttachments(
    rows.flatMap((r) => r.attachmentIds),
    userId,
  );
  return rows.map((r) => toChatMessage(r, atts));
}

const UNTITLED = "Без названия";

export const toConversationInfo = (c: AssistantConversation): ConversationInfo => ({
  id: c.id,
  title: c.title?.trim() || UNTITLED,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
  archivedAt: c.archivedAt?.toISOString() ?? null,
});

/** Своя беседа своей группы (архивная тоже — это своя история, а не удалённая); чужая и несуществующая — null. */
export async function findOwnConversation(id: string, user: { id: string; groupId: string }): Promise<AssistantConversation | null> {
  const [c] = await db
    .select()
    .from(assistantConversations)
    .where(and(eq(assistantConversations.id, id), eq(assistantConversations.userId, user.id), eq(assistantConversations.groupId, user.groupId)));
  return c ?? null;
}
