import { NextResponse, after } from "next/server";
import { and, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { assistantConversations, assistantMessages, attachments } from "@/lib/db/schema";
import { getSessionUser, type SessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { logAppError } from "@/lib/errors";
import { storage } from "@/lib/storage";
import { mondayIso, todayIso } from "@/lib/tz";
import { accessStatus, isAccessActive } from "@/lib/assistant/access";
import { budgetKopecks, canSend, limitsView } from "@/lib/assistant/limits";
import { runChat, summarizeHistory, type RunChatResult } from "@/lib/assistant/model";
import { costKopecks } from "@/lib/assistant/pricing";
import { claimAssistantUploads, getAccessRow, getLimitCounts, getSettings, loadChatAttachments, releaseQuota, reserveQuota, toChatMessage } from "@/lib/assistant/store";
import { encodeEvent } from "@/lib/assistant/stream";
import type { AssistantSettings, ChatEvent, ChatMessage } from "@/lib/assistant/types";

/*
 * POST /api/assistant/chat — сообщение помощнику и ответ NDJSON-стримом (docs/AI-CHAT.md §7).
 *
 * База и стрим разведены: всё, что пишет в базу до ответа (квота, беседа, сообщение, привязка файлов), делается
 * и коммитится до вызова модели; всё, что после, — отдельными запросами по окончании стрима. Пул — 3 соединения
 * на инстанс, и держать одно из них минуту, пока модель думает, нельзя. Во время стрима база нужна только
 * коротким чтениям контекста и инструментов.
 */

export const runtime = "nodejs";
// Hobby с Fluid Compute допускает до 300 с; 120 — два круга инструментов по минуте с запасом на сохранение.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const TEXT_MAX = 4000;
const ATTACHMENTS_MAX = 4;
const TITLE_CHARS = 60;
/** Сколько последних сообщений беседы поднимать для истории: бюджет 6000 токенов ≈ 21 000 символов — это с запасом. */
const HISTORY_ROWS = 60;
const ROUTE = "/api/assistant/chat";

const bodySchema = z.object({
  conversationId: z.uuid().nullable().default(null),
  text: z.string().max(TEXT_MAX),
  attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_MAX).default([]),
  strong: z.boolean().default(false),
});

const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "Cache-Control": "no-store",
  // Прокси с буферизацией (nginx и его родня) иначе копят ответ целиком — стрим превращается в ожидание.
  "X-Accel-Buffering": "no",
};

class AttachmentsTaken extends Error {}

type AttachmentRow = typeof attachments.$inferSelect;
type ConversationRef = { id: string; summary: string | null; summarizedThrough: string | null };

export async function POST(req: Request) {
  const started = Date.now();
  const user = await getSessionUser();
  if (!user) return json({ error: "Нужно войти заново" }, 401);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Неверный запрос" }, 400);
  const text = parsed.data.text.trim();
  const attachmentIds = [...new Set(parsed.data.attachmentIds)];
  const { strong } = parsed.data;
  if (!text && attachmentIds.length === 0) return json({ error: "Пустое сообщение" }, 400);

  const settings = getSettings(user.group);
  if (!settings.enabled) return json({ error: "Помощник выключен" }, 403);
  // Включить без ключа админка не даст, но ключ могли убрать из Vercel позже — честнее отказать сразу, чем списать лимит.
  if (!env.assistant.configured) return json({ error: "Помощник сейчас не настроен — админ уже знает" }, 403);

  // Одни «сегодня» и «понедельник» на весь запрос: квота, лимиты в done и day сообщений считаются по одному дню,
  // даже если ответ закончится после полуночи.
  const today = todayIso();
  const monday = mondayIso();
  const access = accessStatus(today, await getAccessRow(user.id));
  if (!isAccessActive(access)) {
    const error = access.kind === "none" ? "Сначала включи пробный период в разделе «Помощник»" : "Доступ к помощнику закончился — продли его в разделе «Помощник»";
    return json({ error, access }, 402);
  }

  // Беседа и файлы проверяются до резерва квоты: отказ по чужому id не должен даже временно съедать лимит.
  let conversation: ConversationRef | null = null;
  if (parsed.data.conversationId) {
    const [c] = await db
      .select({ id: assistantConversations.id, summary: assistantConversations.summary, summarizedThrough: assistantConversations.summarizedThrough })
      .from(assistantConversations)
      .where(and(eq(assistantConversations.id, parsed.data.conversationId), eq(assistantConversations.userId, user.id), eq(assistantConversations.groupId, user.groupId)));
    if (!c) return json({ error: "Беседа не найдена" }, 404);
    conversation = c;
  }
  const files = attachmentIds.length
    ? await db
        .select()
        .from(attachments)
        .where(and(inArray(attachments.id, attachmentIds), eq(attachments.uploadedBy, user.id), eq(attachments.entityType, "assistant"), isNull(attachments.entityId)))
    : [];
  if (files.length !== attachmentIds.length) return json({ error: "Файлы не найдены или уже отправлены — прикрепи их заново" }, 400);
  // Порядок — как прикрепил студент (верх и низ страницы), а не как вернула база.
  files.sort((a, b) => attachmentIds.indexOf(a.id) - attachmentIds.indexOf(b.id));

  // Квота: атомарный резерв, потом проверка по состоянию «до этого сообщения». День — из строки резерва (она
  // атомарна, две вкладки разом не проскочат), неделя и сильные — суммой, уже включающей резерв.
  const reserved = await reserveQuota(user.id, today, strong);
  let quotaHeld = true;
  const release = async () => {
    if (!quotaHeld) return;
    quotaHeld = false;
    await releaseQuota(user.id, today, strong).catch((e) => console.error("[assistant/chat] releaseQuota", e));
  };

  try {
    const counts = await getLimitCounts(user.id, today, monday);
    const before = limitsView(
      settings,
      {
        day: Math.max(0, reserved.count - 1),
        weekTotal: Math.max(0, counts.weekTotal - 1),
        strongWeek: Math.max(0, counts.strongWeek - (strong ? 1 : 0)),
        costKopecks30d: counts.costKopecks30d,
      },
      today,
      monday,
      budgetKopecks(settings, access),
    );
    const check = canSend(before, strong);
    if (!check.ok) {
      await release();
      return json({ error: check.message, limits: before }, 429);
    }

    const ids = await db.transaction(async (tx) => {
      let conversationId = conversation?.id ?? null;
      if (conversationId) {
        await tx.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, conversationId));
      } else {
        const title = (text || files[0]?.fileName || "Без названия").replace(/\s+/g, " ").slice(0, TITLE_CHARS).trim();
        const [c] = await tx.insert(assistantConversations).values({ groupId: user.groupId, userId: user.id, title }).returning({ id: assistantConversations.id });
        conversationId = c.id;
      }
      const [m] = await tx
        .insert(assistantMessages)
        .values({ conversationId, userId: user.id, role: "user", content: text, attachmentIds, strong, day: today })
        .returning({ id: assistantMessages.id });
      // Повторная проверка внутри транзакции: между выборкой выше и этой строкой файл могли привязать из другой вкладки.
      const claimed = await claimAssistantUploads(tx, attachmentIds, user.id, m.id);
      if (claimed.length !== attachmentIds.length) throw new AttachmentsTaken();
      return { conversationId, messageId: m.id };
    });

    const history = conversation ? await loadHistory(conversation, ids.messageId, user.id) : [];
    return streamAnswer({ req, user, settings, budgetLimit: budgetKopecks(settings, access), today, monday, strong, text, files, history, conversation, ids, started, release });
  } catch (e) {
    await release();
    if (e instanceof AttachmentsTaken) return json({ error: "Файлы уже отправлены — прикрепи их заново" }, 400);
    console.error("[assistant/chat]", e);
    await logAppError({ route: ROUTE, message: e instanceof Error ? e.message : String(e), digest: null, kind: "assistant" });
    return json({ error: "Не получилось отправить — повтори" }, 500);
  }
}

/**
 * История для модели: сообщения беседы после границы summary (summarized_through), без только что вставленного
 * вопроса, последние HISTORY_ROWS по порядку. Граница — по created_at сообщения-границы; если его нет (удалили
 * руками), coalesce с эпохой отдаёт всю беседу, а не пустую историю.
 */
async function loadHistory(conversation: ConversationRef, currentId: string, userId: string): Promise<ChatMessage[]> {
  const boundary = conversation.summarizedThrough
    ? gt(
        assistantMessages.createdAt,
        sql`coalesce((select m.created_at from assistant_messages m where m.id = ${conversation.summarizedThrough}), 'epoch'::timestamptz)`,
      )
    : undefined;
  const rows = await db
    .select()
    .from(assistantMessages)
    .where(and(eq(assistantMessages.conversationId, conversation.id), ne(assistantMessages.id, currentId), boundary))
    .orderBy(desc(assistantMessages.createdAt))
    .limit(HISTORY_ROWS);
  rows.reverse();
  const atts = await loadChatAttachments(
    rows.flatMap((r) => r.attachmentIds),
    userId,
  );
  return rows.map((r) => toChatMessage(r, atts));
}

type StreamInput = {
  req: Request;
  user: SessionUser;
  settings: AssistantSettings;
  /** Потолок ресурса на момент запроса — для лимитов в событии done (доступ за время ответа не меняется). */
  budgetLimit: number | null;
  today: string;
  monday: string;
  strong: boolean;
  text: string;
  files: AttachmentRow[];
  history: ChatMessage[];
  conversation: ConversationRef | null;
  ids: { conversationId: string; messageId: string };
  started: number;
  release: () => Promise<void>;
};

/** Что сжать в summary после ответа (через after): старший хвост истории, не вошедший в бюджет. */
type CompressJob = { conversation: ConversationRef; dropped: ChatMessage[]; assistantMessageId: string };

function streamAnswer(s: StreamInput): Response {
  // Обрыв клиента приходит двумя путями: req.signal (соединение закрыто) и cancel() потока (читатель ушёл).
  const abort = new AbortController();
  const onClientGone = () => abort.abort();
  s.req.signal.addEventListener("abort", onClientGone);
  const encoder = new TextEncoder();
  let closed = false;
  let finished: Promise<CompressJob | null> = Promise.resolve(null);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (e: ChatEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeEvent(e)));
        } catch {
          closed = true;
        }
      };
      // start() вызывается синхронно в конструкторе, поэтому finished задан до after() ниже. Не await: ответ
      // с заголовками должен уйти сразу, события идут по мере готовности.
      finished = answer(s, send, abort.signal)
        .catch((e) => {
          console.error("[assistant/chat] stream", e);
          return null;
        })
        .finally(() => {
          s.req.signal.removeEventListener("abort", onClientGone);
          if (!closed) {
            closed = true;
            try {
              controller.close();
            } catch {
              // клиент уже ушёл
            }
          }
        });
    },
    cancel() {
      closed = true;
      abort.abort();
    },
  });

  // after() держит функцию живой, пока сохраняется ответ (и после ухода клиента — иначе Vercel заморозил бы
  // инстанс до записи aborted), и потом сжимает историю отдельным дешёвым вызовом.
  after(async () => {
    const job = await finished;
    if (job) await compressHistory(job);
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}

async function answer(s: StreamInput, send: (e: ChatEvent) => void, signal: AbortSignal): Promise<CompressJob | null> {
  const { user, today, monday, strong, ids } = s;
  send({ t: "start", conversationId: ids.conversationId, messageId: ids.messageId });

  let sawDelta = false;
  let result: RunChatResult;
  try {
    const bodies = await Promise.all(
      s.files.map(async (att) => {
        const obj = await storage.get(att.fileKey);
        if (!obj) throw new Error(`Файл ${att.id} пропал из хранилища`);
        return { att, body: obj.body };
      }),
    );
    result = await runChat(
      { user, conversation: { id: ids.conversationId }, history: s.history, summary: s.conversation?.summary ?? null, text: s.text, attachments: bodies, strong },
      (e) => {
        if (e.t === "delta") sawDelta = true;
        send(e);
      },
      signal,
    );
  } catch (e) {
    // runChat сам не бросает; сюда попадает хранилище (R2 недоступен, файл удалён).
    console.error("[assistant/chat] вложения", e);
    const message = e instanceof Error ? e.message : String(e);
    result = { content: "", usage: null, model: strong ? env.assistant.strongModel : env.assistant.model, toolCalls: 0, status: "error", error: message, errorMessage: "Не получилось прочитать вложения — прикрепи их заново", dropped: [] };
  }

  const cost = result.usage ? costKopecks(result.model, result.usage, env.assistant.usdRub, env.assistant.polzaMarkup) : null;
  let assistantMessageId: string;
  try {
    const [row] = await db
      .insert(assistantMessages)
      .values({
        conversationId: ids.conversationId,
        userId: user.id,
        role: "assistant",
        content: result.content,
        strong,
        model: result.model,
        usage: result.usage,
        costKopecks: cost,
        status: result.status,
        error: result.error,
        durationMs: Date.now() - s.started,
        toolCalls: result.toolCalls,
        day: today,
      })
      .returning({ id: assistantMessages.id });
    assistantMessageId = row.id;
    await db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, ids.conversationId));
  } catch (e) {
    console.error("[assistant/chat] сохранение ответа", e);
    await logAppError({ route: ROUTE, message: `Ответ не сохранён: ${e instanceof Error ? e.message : String(e)}`, digest: null, kind: "assistant" });
    if (!sawDelta) await s.release();
    send({ t: "error", message: "Ответ не сохранился — повтори" });
    return null;
  }

  // Ни слова от модели — сообщение не состоялось, лимит возвращаем. Обрыв самим студентом (aborted) — не возвращаем:
  // запрос к модели уже оплачен, а «Стоп» сразу после отправки не должен быть бесплатным способом спамить.
  if (result.status === "error" && !sawDelta) await s.release();

  if (result.status === "done") {
    const limits = limitsView(s.settings, await getLimitCounts(user.id, today, monday), today, monday, s.budgetLimit);
    send({ t: "done", messageId: assistantMessageId, limits, usage: result.usage });
    return s.conversation && result.dropped.length ? { conversation: s.conversation, dropped: result.dropped, assistantMessageId } : null;
  }
  if (result.status === "error") send({ t: "error", message: result.errorMessage ?? "Помощник не смог ответить — повтори" });
  return null;
}

/**
 * Сжатие старшего хвоста в summary. Граница сдвигается условным update: если параллельный запрос успел сжать
 * раньше, его результат не перетираем. Стоимость сжатия добавляется к ответу, который его вызвал, — иначе расход
 * в админке был бы оптимистичнее счёта Polza.
 */
async function compressHistory(job: CompressJob): Promise<void> {
  try {
    const { summary, usage, model } = await summarizeHistory(job.conversation.summary, job.dropped);
    const through = job.dropped[job.dropped.length - 1].id;
    const updated = await db
      .update(assistantConversations)
      .set({ summary, summarizedThrough: through })
      .where(
        and(
          eq(assistantConversations.id, job.conversation.id),
          job.conversation.summarizedThrough ? eq(assistantConversations.summarizedThrough, job.conversation.summarizedThrough) : isNull(assistantConversations.summarizedThrough),
        ),
      )
      .returning({ id: assistantConversations.id });
    if (updated.length && usage) {
      const extra = costKopecks(model, usage, env.assistant.usdRub, env.assistant.polzaMarkup);
      await db
        .update(assistantMessages)
        .set({ costKopecks: sql`coalesce(${assistantMessages.costKopecks}, 0) + ${extra}` })
        .where(eq(assistantMessages.id, job.assistantMessageId));
    }
  } catch (e) {
    // Не сжалось — не беда: граница не сдвинулась, следующий ответ попробует снова.
    console.error("[assistant/chat] сжатие истории", e instanceof Error ? e.message : e);
  }
}
