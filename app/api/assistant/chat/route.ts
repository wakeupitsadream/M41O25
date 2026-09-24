import { NextResponse, after } from "next/server";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
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
import { runChat, summarizeHistory, summaryBatch, type RunChatResult } from "@/lib/assistant/model";
import { costKopecks } from "@/lib/assistant/pricing";
import {
  claimAssistantUploads,
  getAccessRow,
  getCountsBefore,
  getLimitCounts,
  getSettings,
  loadChatAttachments,
  MESSAGE_ORDER,
  releaseQuota,
  reserveQuota,
  toChatMessage,
} from "@/lib/assistant/store";
import { encodeEvent } from "@/lib/assistant/stream";
import type { AssistantSettings, ChatEvent, ChatMessage, LimitsView } from "@/lib/assistant/types";

/*
 * POST /api/assistant/chat — сообщение помощнику и ответ NDJSON-стримом (docs/AI-CHAT.md §7).
 *
 * База и стрим разведены: всё, что пишет в базу до ответа (квота, беседа, сообщение, привязка файлов), делается
 * и коммитится до вызова модели; всё, что после, — отдельными запросами по окончании стрима. Пул — 3 соединения
 * на инстанс, и держать одно из них минуту, пока модель думает, нельзя. Во время стрима база нужна только
 * коротким чтениям контекста и инструментов.
 *
 * Обрыв клиента («Стоп», iOS заморозил приложение) доходит до функции через req.signal только с
 * supportsCancellation в vercel.json — без него Vercel держит соединение сам, и модель дописывает (и мы оплачиваем)
 * ответ, который никто не увидит. Цена отмены: при уходе клиента Vercel завершает функцию, доживает только работа,
 * отданная в waitUntil — поэтому весь запрос с первой строки под after() (он и есть waitUntil), см. POST.
 */

export const runtime = "nodejs";
// Hobby с Fluid Compute допускает до 300 с; 120 — два круга инструментов по минуте с запасом на сохранение.
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const MAX_DURATION_MS = 120_000;
const TEXT_MAX = 4000;
const ATTACHMENTS_MAX = 4;
const TITLE_CHARS = 60;
/**
 * Сколько последних сообщений беседы поднимать для истории. Бюджет HISTORY_TOKENS (4000 ≈ 14 000 символов) обычно
 * кончается раньше, но беседа из коротких реплик может в него уложиться и длиннее — тогда всё, что старше окна,
 * уходит в summary (truncated → сжатие), а не пропадает из разговора молча.
 */
const HISTORY_ROWS = 60;
/** Сколько сообщений за раз перечитывать для сжатия; сколько из них войдёт в один вызов — решает summaryBatch. */
const COMPRESS_ROWS = 200;
/** Сжатие начинаем, только если до maxDuration остаётся хотя бы столько: оборванный лимитом функции вызов оплачен, но не записан. */
const COMPRESS_MIN_MS = 10_000;
const ROUTE = "/api/assistant/chat";

const bodySchema = z.object({
  conversationId: z.uuid().nullable().default(null),
  text: z.string().max(TEXT_MAX),
  attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_MAX).default([]),
  strong: z.boolean().default(false),
});

const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
/** Клиент ушёл до коммита вопроса: отвечать некому, писать в базу нечего. 499 — «client closed request» из nginx. */
const gone = () => json({ error: "Запрос отменён" }, 499);

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
  const work = handle(req);
  // after() до первого await: при уходе клиента (supportsCancellation) Vercel завершает функцию, и без waitUntil обрыв
  // посреди подготовки оставил бы резерв квоты без отката или закоммиченный вопрос без ответа. Стрим, сохранение ответа
  // и сжатие истории держит второй after() в streamAnswer — он регистрируется раньше, чем work завершится.
  after(work.catch(() => null));
  return work;
}

async function handle(req: Request): Promise<Response> {
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
  const budgetLimit = budgetKopecks(settings, access);

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
  // Файл годится, если он свой и ещё ничей — или уже приложен к своему же вопросу в этой беседе: «Повторить» под
  // вопросом с фото шлёт те же id, и без фото модель ответила бы «пришли решение», списав лимит. Такие файлы
  // принимаем, но не перепривязываем: они остаются у первого вопроса. Чужие и из другой беседы — по-прежнему 400.
  const ownQuestions = conversation
    ? db
        .select({ id: assistantMessages.id })
        .from(assistantMessages)
        .where(and(eq(assistantMessages.conversationId, conversation.id), eq(assistantMessages.userId, user.id), eq(assistantMessages.role, "user")))
    : null;
  const files = attachmentIds.length
    ? await db
        .select()
        .from(attachments)
        .where(
          and(
            inArray(attachments.id, attachmentIds),
            eq(attachments.uploadedBy, user.id),
            eq(attachments.entityType, "assistant"),
            ownQuestions ? or(isNull(attachments.entityId), inArray(attachments.entityId, ownQuestions)) : isNull(attachments.entityId),
          ),
        )
    : [];
  if (files.length !== attachmentIds.length) return json({ error: "Файлы не найдены или уже отправлены — прикрепи их заново" }, 400);
  // Порядок — как прикрепил студент (верх и низ страницы), а не как вернула база.
  files.sort((a, b) => attachmentIds.indexOf(a.id) - attachmentIds.indexOf(b.id));
  const freshIds = files.filter((f) => f.entityId === null).map((f) => f.id);

  // Клиент ушёл, пока шли проверки: он считает сообщение неотправленным, и резервировать под него лимит незачем.
  if (req.signal.aborted) return gone();

  // Квота: атомарный резерв, потом проверка по состоянию «до этого сообщения» (getCountsBefore — по номеру
  // из строки резерва, так что две вкладки разом не проскочат и не откажут друг другу).
  const reserved = await reserveQuota(user.id, today, strong);
  let quotaHeld = true;
  const release = async () => {
    if (!quotaHeld) return;
    quotaHeld = false;
    await releaseQuota(user.id, today, strong).catch((e) => console.error("[assistant/chat] releaseQuota", e));
  };

  try {
    const before = limitsView(settings, await getCountsBefore(user.id, today, monday, reserved, strong), today, monday, budgetLimit);
    const check = canSend(before, strong);
    if (!check.ok) {
      await release();
      return json({ error: check.message, reason: check.reason, limits: before }, 429);
    }
    if (req.signal.aborted) {
      await release();
      return gone();
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
      const claimed = await claimAssistantUploads(tx, freshIds, user.id, m.id);
      if (claimed.length !== freshIds.length) throw new AttachmentsTaken();
      return { conversationId, messageId: m.id };
    });

    // Дальше вопрос закоммичен: всё, что может сломаться (история, хранилище, модель), — внутри стрима и кончается
    // ответом-ошибкой в ленте, а не 500, после которого клиент вернул бы вопрос в поле, а в беседе он висел бы без ответа.
    return streamAnswer({ req, user, settings, budgetLimit, before, today, monday, strong, text, files, conversation, ids, started, release });
  } catch (e) {
    await release();
    if (e instanceof AttachmentsTaken) return json({ error: "Файлы уже отправлены — прикрепи их заново" }, 400);
    console.error("[assistant/chat]", e);
    await logAppError({ route: ROUTE, message: e instanceof Error ? e.message : String(e), digest: null, kind: "assistant" });
    return json({ error: "Не получилось отправить — повтори" }, 500);
  }
}

type History = { messages: ChatMessage[]; truncated: boolean };

/**
 * Граница summary: сообщения после summarized_through в том же порядке (created_at, id), что и лента. Нет строки-
 * границы (удалили руками) — вся беседа, а не пустая история.
 */
const afterSummary = (conversation: ConversationRef) => {
  const through = conversation.summarizedThrough;
  if (!through) return undefined;
  return sql`((${assistantMessages.createdAt}, ${assistantMessages.id}) > (select b.created_at, b.id from assistant_messages b where b.id = ${through})
    or not exists (select 1 from assistant_messages b where b.id = ${through}))`;
};

/**
 * История для модели: сообщения беседы после границы summary, без только что вставленного вопроса, последние
 * HISTORY_ROWS по порядку. truncated — до окна есть ещё сообщения, не вошедшие в summary: их нужно сжать.
 */
async function loadHistory(conversation: ConversationRef, currentId: string, userId: string): Promise<History> {
  const rows = await db
    .select()
    .from(assistantMessages)
    .where(and(eq(assistantMessages.conversationId, conversation.id), ne(assistantMessages.id, currentId), afterSummary(conversation)))
    .orderBy(desc(assistantMessages.createdAt), desc(assistantMessages.id))
    .limit(HISTORY_ROWS + 1);
  const truncated = rows.length > HISTORY_ROWS;
  const window = rows.slice(0, HISTORY_ROWS).reverse();
  const atts = await loadChatAttachments(
    window.flatMap((r) => r.attachmentIds),
    userId,
  );
  return { messages: window.map((r) => toChatMessage(r, atts)), truncated };
}

type StreamInput = {
  req: Request;
  user: SessionUser;
  settings: AssistantSettings;
  /** Потолок ресурса на момент запроса — для лимитов в событиях done/error (доступ за время ответа не меняется). */
  budgetLimit: number | null;
  /** Остатки до этого сообщения — запасной вариант limits в done, если перечитать счётчики не вышло. */
  before: LimitsView;
  today: string;
  monday: string;
  strong: boolean;
  text: string;
  files: AttachmentRow[];
  conversation: ConversationRef | null;
  ids: { conversationId: string; messageId: string };
  started: number;
  release: () => Promise<void>;
};

/**
 * Что сжать в summary после ответа (через after): всё после текущей границы и до keepFrom — первого сообщения,
 * оставшегося в запросе (или текущего вопроса, если не осталось ни одного). Сюда попадает и отброшенный по бюджету
 * хвост, и то, что старше окна HISTORY_ROWS и в запрос не поднималось вовсе.
 */
type CompressJob = { conversation: ConversationRef; keepFrom: string; userId: string; assistantMessageId: string; started: number };

function streamAnswer(s: StreamInput): Response {
  // Обрыв клиента приходит двумя путями: req.signal (соединение закрыто) и cancel() потока (читатель ушёл).
  const abort = new AbortController();
  const onClientGone = () => abort.abort();
  s.req.signal.addEventListener("abort", onClientGone);
  // Слушатель на уже прерванном сигнале не сработает: клиент мог уйти, пока шла транзакция.
  if (s.req.signal.aborted) abort.abort();
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

  // after() держит функцию живой, пока сохраняется ответ (и после ухода клиента — иначе Vercel завершил бы
  // функцию до записи aborted), и потом сжимает историю отдельным дешёвым вызовом.
  after(async () => {
    const job = await finished;
    if (job) await compressHistory(job);
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}

async function answer(s: StreamInput, send: (e: ChatEvent) => void, signal: AbortSignal): Promise<CompressJob | null> {
  const { user, today, monday, strong, ids } = s;
  send({ t: "start", conversationId: ids.conversationId, messageId: ids.messageId });

  /** Остатки после этого сообщения; база недоступна — undefined (в error клиент оставит прежние). */
  const limitsNow = () =>
    getLimitCounts(user.id, today, monday)
      .then((c) => limitsView(s.settings, c, today, monday, s.budgetLimit))
      .catch((e) => {
        console.error("[assistant/chat] лимиты", e);
        return undefined;
      });

  let sawDelta = false;
  let history: History = { messages: [], truncated: false };
  let result: RunChatResult;
  let stage: "history" | "files" | "model" = "history";
  try {
    if (s.conversation) history = await loadHistory(s.conversation, ids.messageId, user.id);
    stage = "files";
    const bodies = await Promise.all(
      s.files.map(async (att) => {
        const obj = await storage.get(att.fileKey);
        if (!obj) throw new Error(`Файл ${att.id} пропал из хранилища`);
        return { att, body: obj.body };
      }),
    );
    stage = "model";
    result = await runChat(
      { user, conversation: { id: ids.conversationId }, history: history.messages, summary: s.conversation?.summary ?? null, text: s.text, attachments: bodies, strong },
      (e) => {
        if (e.t === "delta") sawDelta = true;
        send(e);
      },
      signal,
    );
  } catch (e) {
    // runChat сам не бросает; сюда попадают история (сбой базы) и хранилище (R2 недоступен, файл удалён).
    console.error(`[assistant/chat] подготовка (${stage})`, e);
    const message = e instanceof Error ? e.message : String(e);
    if (stage === "history") void logAppError({ route: ROUTE, message: `История беседы не прочиталась: ${message}`, digest: null, kind: "assistant" });
    result = {
      content: "",
      usage: null,
      model: strong ? env.assistant.strongModel : env.assistant.model,
      toolCalls: 0,
      status: "error",
      error: message,
      errorMessage: stage === "files" ? "Не получилось прочитать вложения — прикрепи их заново" : "Помощник не смог ответить — повтори",
      dropped: [],
      modelCalled: false,
    };
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
        // Сразу за своим вопросом, а не «сейчас»: ответ пишется в конце стрима, и после «Стоп» → «Повторить» (пока
        // первая генерация ещё дописывается) лента по created_at выходила бы вопрос, вопрос, ответ, ответ. Микросекунды
        // created_at вопроса берём из базы — в JS они потерялись бы.
        createdAt: sql`coalesce((select q.created_at from assistant_messages q where q.id = ${ids.messageId}) + interval '1 millisecond', now())`,
      })
      .returning({ id: assistantMessages.id });
    assistantMessageId = row.id;
    await db.update(assistantConversations).set({ updatedAt: new Date() }).where(eq(assistantConversations.id, ids.conversationId));
  } catch (e) {
    console.error("[assistant/chat] сохранение ответа", e);
    await logAppError({ route: ROUTE, message: `Ответ не сохранён: ${e instanceof Error ? e.message : String(e)}`, digest: null, kind: "assistant" });
    if (!sawDelta) await s.release();
    send({ t: "error", message: "Ответ не сохранился — повтори", limits: await limitsNow() });
    return null;
  }

  // Квота возвращается, когда сообщение не состоялось: ни слова от модели, или студент ушёл раньше, чем запрос
  // к модели вообще ушёл. Обрыв после запроса («Стоп» посреди ответа) — не возвращаем: он уже оплачен, а «Стоп»
  // сразу после отправки не должен быть бесплатным способом спамить.
  if ((result.status === "error" && !sawDelta) || (result.status === "aborted" && !result.modelCalled)) await s.release();

  if (result.status === "done") {
    const limits = (await limitsNow()) ?? s.before;
    send({ t: "done", messageId: assistantMessageId, limits, usage: result.usage });
    if (!s.conversation || (result.dropped.length === 0 && !history.truncated)) return null;
    // Граница: первое сообщение, оставшееся в запросе (fitHistory режет сплошным старшим хвостом), иначе — сам вопрос.
    const keepFrom = history.messages[result.dropped.length]?.id ?? ids.messageId;
    return { conversation: s.conversation, keepFrom, userId: user.id, assistantMessageId, started: s.started };
  }
  if (result.status === "error") send({ t: "error", message: result.errorMessage ?? "Помощник не смог ответить — повтори", limits: await limitsNow() });
  return null;
}

/**
 * Сжатие старшего хвоста в summary. Граница сдвигается условным update: если параллельный запрос успел сжать
 * раньше, его результат не перетираем. Стоимость сжатия добавляется к ответу, который его вызвал, при любом
 * исходе после вызова — и когда граница не сдвинулась, и когда модель вернула пустоту: вызов уже оплачен,
 * и расход в админке не должен быть оптимистичнее счёта Polza.
 */
async function compressHistory(job: CompressJob): Promise<void> {
  // maxDuration оборвал бы вызов на середине — оплаченный, но не записанный. Нет времени — не начинаем: граница
  // не сдвинется, и сожмёт следующий ответ.
  const left = MAX_DURATION_MS - (Date.now() - job.started) - 5_000;
  if (left < COMPRESS_MIN_MS) return;
  try {
    const rows = await db
      .select()
      .from(assistantMessages)
      .where(
        and(
          eq(assistantMessages.conversationId, job.conversation.id),
          afterSummary(job.conversation),
          sql`(${assistantMessages.createdAt}, ${assistantMessages.id}) < (select k.created_at, k.id from assistant_messages k where k.id = ${job.keepFrom})`,
        ),
      )
      .orderBy(...MESSAGE_ORDER)
      .limit(COMPRESS_ROWS);
    if (rows.length === 0) return;
    const atts = await loadChatAttachments(
      rows.flatMap((r) => r.attachmentIds),
      job.userId,
    );
    const batch = summaryBatch(rows.map((r) => toChatMessage(r, atts)));
    const { summary, usage, model } = await summarizeHistory(job.conversation.summary, batch, Math.min(30_000, left));
    if (usage) {
      const extra = costKopecks(model, usage, env.assistant.usdRub, env.assistant.polzaMarkup);
      await db
        .update(assistantMessages)
        .set({ costKopecks: sql`coalesce(${assistantMessages.costKopecks}, 0) + ${extra}` })
        .where(eq(assistantMessages.id, job.assistantMessageId));
    }
    // Пустое summary границу не двигает: иначе сжатое пропало бы из разговора без следа.
    if (!summary) return;
    await db
      .update(assistantConversations)
      .set({ summary, summarizedThrough: batch[batch.length - 1].id })
      .where(
        and(
          eq(assistantConversations.id, job.conversation.id),
          job.conversation.summarizedThrough ? eq(assistantConversations.summarizedThrough, job.conversation.summarizedThrough) : isNull(assistantConversations.summarizedThrough),
        ),
      );
  } catch (e) {
    // Не сжалось — не беда: граница не сдвинулась, следующий ответ попробует снова.
    console.error("[assistant/chat] сжатие истории", e instanceof Error ? e.message : e);
  }
}
