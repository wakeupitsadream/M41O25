import type { ChatAttachment, ChatMessage, ConversationInfo, LimitsView } from "../types";
import type { StreamEvent } from "./stream";

/*
 * Состояние экрана чата как чистый редьюсер: оптимистичная отправка, события стрима, обрыв, перечитывание
 * с сервера. Отдельно от React, чтобы переходы проверялись тестом (chat-state.test.ts), а компонент только
 * вызывал dispatch и делал побочные эффекты (fetch, history.replaceState).
 */

/**
 * Сообщение на экране. key стабилен на всё время жизни строки: временный id оптимистичного сообщения
 * меняется на серверный по start/done, а React не должен из-за этого перемонтировать пузырь посреди стрима.
 * note — подпись под ответом (текст ошибки сервера, «Остановлено»).
 */
export type UiMessage = ChatMessage & { key: string; note?: string };

export type Pending = {
  /** id user-сообщения: временный до start, потом серверный. */
  userId: string;
  /** id ответа-заглушки: временный до done. */
  replyId: string;
  /** Сервер прислал start — сообщение сохранено и лимит списан. */
  started: boolean;
  /** Модель читает данные группы — показываем «читаю расписание…», пока не пошёл текст. */
  tool: string | null;
};

/**
 * Ответ, который сервер, возможно, ещё пишет: вопрос в базе есть, ответа нет. Так бывает после обрыва связи
 * (на Vercel функция доживает до конца и без клиента, ответ сохранится позже) и при открытии беседы, пока ответ
 * в пути. Экран показывает «ответ ещё готовится…» и перечитывает беседу (use-chat.ts); «Повторить» — только когда
 * ждать перестали, иначе повтор задваивает вопрос и квоту. fresh — вопрос только что ушёл с этого экрана: его
 * возраст по часам телефона не проверяем, они могут расходиться с серверными.
 */
export type Awaiting = { questionId: string; replyKey: string; fresh: boolean };

export type ChatState = {
  conversationId: string | null;
  title: string;
  messages: UiMessage[];
  pending: Pending | null;
  limits: LimitsView;
  awaiting: Awaiting | null;
};

export type ChatAction =
  | { type: "send"; text: string; attachments: ChatAttachment[]; strong: boolean; userId: string; replyId: string; at: string }
  | { type: "event"; event: StreamEvent }
  /** Сервер точно не принял сообщение (не-200): оптимистичные строки убираются, черновик вернёт компонент. */
  | { type: "rejected" }
  /** Обрыв после start (сеть, таймаут, «Стоп»): показанный кусок остаётся с пометкой; await — ждать ответ с сервера. */
  | { type: "interrupted"; note: string; await: boolean }
  /** Свежая беседа с сервера (GET-роут или RSC-refresh страницы). conversation — у экрана, открытого как «новый чат». */
  | { type: "reload"; messages: ChatMessage[]; conversation?: ConversationInfo | null }
  /** Перестали ждать ответ: дальше под вопросом «Ответ не пришёл» и «Повторить». */
  | { type: "awaitEnd"; questionId: string }
  | { type: "limits"; limits: LimitsView };

export const NEW_CHAT_TITLE = "Новый чат";
/** Как сервер называет беседу без заголовка (app/(app)/group/assistant/actions.ts). */
const UNTITLED = "Без названия";
/** Сервер берёт в заголовок новой беседы первые 60 символов текста (docs/AI-CHAT.md §7, шаг 3) — повторяем до перезагрузки. */
const TITLE_CHARS = 60;
/** Префикс id строк, которых нет в базе: оптимистичные сообщения и заглушки ответа. Серверные id — uuid. */
const LOCAL = "local-";
export const NOT_ARRIVED = "Ответ не пришёл — повтори";

export const isLocalId = (id: string) => id.startsWith(LOCAL);

const titleOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, TITLE_CHARS) || UNTITLED;

const fromServer = (m: ChatMessage): UiMessage => ({ ...m, key: m.id });

/** Заглушка ответа под вопросом без ответа. id зависит только от вопроса: на каждом перечитывании тот же ключ React. */
const placeholderFor = (q: UiMessage): UiMessage => {
  const id = `${LOCAL}wait-${q.id}`;
  return { id, key: id, role: "assistant", content: "", attachments: [], strong: q.strong, status: "aborted", note: NOT_ARRIVED, createdAt: q.createdAt };
};

/**
 * Серверная версия беседы поверх экранной. Порядок строк — только серверный: вопрос и ответ там идут парами,
 * даже если ответ на первый вопрос сохранился после второго («Стоп» → «Повторить»). Экран добавляет лишь то,
 * чего в базе ещё нет:
 * 1) свой несохранённый ответ (оборванный, с ошибкой, заглушку) — сразу за его вопросом, если на этот вопрос сервер
 *    ещё не ответил. Пустой тоже: иначе оборванный до первого слова ответ исчезал бы вместе с «Повторить»;
 * 2) строки с серверными id, которые экран уже видел, а снимок ещё нет (RSC-refresh, начатый до отправки);
 * 3) заглушку под последним вопросом без ответа — placeholder в результате, чтобы редьюсер начал ждать ответ.
 */
export function mergeServer(local: UiMessage[], server: ChatMessage[]): { messages: UiMessage[]; placeholder: UiMessage | null } {
  const next = server.map(fromServer);
  const ids = new Set(next.map((m) => m.id));
  const unsaved = new Map<string, UiMessage>();
  local.forEach((m, i) => {
    const q = local[i - 1];
    if (m.role === "assistant" && m.status !== "done" && !ids.has(m.id) && q?.role === "user" && ids.has(q.id)) unsaved.set(q.id, m);
  });
  const out: UiMessage[] = [];
  next.forEach((m, i) => {
    out.push(m);
    const r = unsaved.get(m.id);
    if (r && next[i + 1]?.role !== "assistant") out.push(r);
  });

  let lastCommon = -1;
  local.forEach((m, i) => {
    if (ids.has(m.id)) lastCommon = i;
  });
  for (const m of local.slice(lastCommon + 1)) {
    const prev = out.at(-1);
    if (!isLocalId(m.id) || (m.role === "assistant" && prev?.role === "user" && !isLocalId(prev.id))) out.push(m);
  }

  const tail = out.at(-1);
  if (tail?.role !== "user") return { messages: out, placeholder: null };
  const placeholder = placeholderFor(tail);
  return { messages: [...out, placeholder], placeholder };
}

/** Ждём дальше, только если под вопросом всё ещё тот же несохранённый ответ; ответил сервер — ждать нечего. */
function keepAwaiting(a: Awaiting | null, messages: UiMessage[]): Awaiting | null {
  if (!a) return null;
  const i = messages.findIndex((m) => m.id === a.questionId);
  return i >= 0 && messages[i + 1]?.key === a.replyKey ? a : null;
}

export function initChat(input: { conversation: ConversationInfo | null; messages: ChatMessage[]; limits: LimitsView }): ChatState {
  const base: ChatState = {
    conversationId: input.conversation?.id ?? null,
    title: input.conversation?.title ?? NEW_CHAT_TITLE,
    messages: [],
    pending: null,
    limits: input.limits,
    awaiting: null,
  };
  return input.messages.length ? chatReducer(base, { type: "reload", messages: input.messages }) : base;
}

/** Точечная правка одной строки: остальные сохраняют идентичность объектов, и memo-пузыри не перерисовываются на каждый delta. */
const patch = (list: UiMessage[], id: string, fn: (m: UiMessage) => UiMessage) => list.map((m) => (m.id === id ? fn(m) : m));

function applyEvent(state: ChatState, e: StreamEvent): ChatState {
  const p = state.pending;
  if (!p) return state;
  switch (e.t) {
    case "start": {
      const text = state.messages.find((m) => m.id === p.userId)?.content ?? "";
      return {
        ...state,
        conversationId: e.conversationId,
        title: state.conversationId === null ? titleOf(text) : state.title,
        pending: { ...p, started: true, userId: e.messageId },
        messages: patch(state.messages, p.userId, (m) => ({ ...m, id: e.messageId })),
      };
    }
    case "delta":
      return {
        ...state,
        pending: p.tool === null ? p : { ...p, tool: null },
        messages: patch(state.messages, p.replyId, (m) => ({ ...m, content: m.content + e.text })),
      };
    case "tool":
      return { ...state, pending: { ...p, tool: e.name } };
    case "done":
      return {
        ...state,
        pending: null,
        limits: e.limits ?? state.limits,
        messages: patch(state.messages, p.replyId, (m) => ({ ...m, id: e.messageId, status: "done" })),
      };
    case "error":
      return {
        ...state,
        pending: null,
        limits: e.limits ?? state.limits,
        messages: patch(state.messages, p.replyId, (m) => ({ ...m, status: "error", note: e.message })),
      };
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      // Вторая отправка во время стрима — двойной тап; композер её и так не пускает, здесь страховка.
      if (state.pending) return state;
      const base = { attachments: [] as ChatAttachment[], strong: action.strong, status: "done" as const, createdAt: action.at };
      const user: UiMessage = { ...base, id: action.userId, key: action.userId, role: "user", content: action.text, attachments: action.attachments };
      const reply: UiMessage = { ...base, id: action.replyId, key: action.replyId, role: "assistant", content: "" };
      return { ...state, messages: [...state.messages, user, reply], pending: { userId: action.userId, replyId: action.replyId, started: false, tool: null } };
    }
    case "event":
      return applyEvent(state, action.event);
    case "rejected": {
      const p = state.pending;
      if (!p) return state;
      return { ...state, pending: null, messages: state.messages.filter((m) => m.id !== p.userId && m.id !== p.replyId) };
    }
    case "interrupted": {
      const p = state.pending;
      if (!p) return state;
      // До start сервер сообщение не подтвердил: дошло ли оно, выясняет use-chat.ts, а сюда приходит уже ответ.
      if (!p.started) return chatReducer(state, { type: "rejected" });
      const reply = state.messages.find((m) => m.id === p.replyId);
      return {
        ...state,
        pending: null,
        messages: patch(state.messages, p.replyId, (m) => ({ ...m, status: "aborted", note: action.note })),
        awaiting: action.await && reply ? { questionId: p.userId, replyKey: reply.key, fresh: true } : state.awaiting,
      };
    }
    case "reload": {
      // Во время стрима серверная версия заведомо старее экранной — не затираем идущий ответ.
      if (state.pending) return state;
      const { messages, placeholder } = mergeServer(state.messages, action.messages);
      const q = messages.at(-2);
      const awaiting = placeholder && q ? { questionId: q.id, replyKey: placeholder.key, fresh: false } : keepAwaiting(state.awaiting, messages);
      return {
        ...state,
        conversationId: state.conversationId ?? action.conversation?.id ?? null,
        title: action.conversation?.title ?? state.title,
        messages,
        awaiting,
      };
    }
    case "awaitEnd":
      return state.awaiting?.questionId === action.questionId ? { ...state, awaiting: null } : state;
    case "limits":
      return { ...state, limits: action.limits };
  }
}

/** Что показать в пузыре ответа: «думает…», строку инструмента, «ответ ещё готовится…» или ничего (текст уже идёт). */
export function replyStage(
  state: Pick<ChatState, "pending" | "awaiting">,
  m: UiMessage,
): { kind: "thinking" } | { kind: "tool"; name: string } | { kind: "awaiting" } | null {
  if (state.awaiting?.replyKey === m.key) return { kind: "awaiting" };
  const p = state.pending;
  if (!p || m.id !== p.replyId) return null;
  if (p.tool) return { kind: "tool", name: p.tool };
  return m.content ? null : { kind: "thinking" };
}

/**
 * Что отправить по «Повторить» под неудачным ответом: ближайший вопрос выше — с теми же вложениями. Сервер
 * принимает файлы, уже привязанные к своему сообщению в этой беседе, так что фото к «проверь решение» уйдёт снова,
 * а не пропадёт молча. null — повторять нечего.
 */
export function retrySource(messages: UiMessage[], replyKey: string): { text: string; strong: boolean; attachments: ChatAttachment[] } | null {
  const i = messages.findIndex((m) => m.key === replyKey);
  for (let j = i - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role !== "user") continue;
    return m.content.trim() || m.attachments.length ? { text: m.content, strong: m.strong, attachments: m.attachments } : null;
  }
  return null;
}

/** Есть ли у вопроса ответ в серверной версии беседы: ответ идёт сразу за вопросом (пары с сервера). */
export function isAnswered(server: ChatMessage[], questionId: string): boolean {
  const i = server.findIndex((m) => m.id === questionId);
  return i >= 0 && server[i + 1]?.role === "assistant";
}

/**
 * Вопрос, отправленный без подтверждения (связь оборвалась до start): дошёл ли он до базы. Ищем новую строку —
 * ту, которой экран до отправки не знал, — с тем же текстом (сервер обрезает пробелы по краям). Вопрос из одних
 * файлов узнаём по файлам; у вопроса с текстом файлы не сверяем: запись о файле могла пропасть из выборки
 * вложений, а вопрос от этого не перестал быть отправленным.
 */
export function findDelivered(server: ChatMessage[], known: ReadonlySet<string>, sent: { text: string; attachmentIds: string[] }): ChatMessage | null {
  const text = sent.text.trim();
  const files = [...sent.attachmentIds].sort().join();
  for (let i = server.length - 1; i >= 0; i--) {
    const m = server[i];
    if (m.role !== "user" || known.has(m.id)) continue;
    if (text ? m.content.trim() === text : !m.content.trim() && m.attachments.map((a) => a.id).sort().join() === files) return m;
  }
  return null;
}
