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

export type ChatState = {
  conversationId: string | null;
  title: string;
  messages: UiMessage[];
  pending: Pending | null;
  limits: LimitsView;
};

export type ChatAction =
  | { type: "send"; text: string; attachments: ChatAttachment[]; strong: boolean; userId: string; replyId: string; at: string }
  | { type: "event"; event: StreamEvent }
  /** Сервер не принял сообщение (не-200 или обрыв до start): оптимистичные строки убираются, черновик вернёт компонент. */
  | { type: "rejected" }
  /** Обрыв после start (сеть, таймаут, «Стоп»): показанный кусок остаётся с пометкой. */
  | { type: "interrupted"; note: string }
  /** Свежая беседа с сервера: после обрыва (getConversation) или после RSC-refresh страницы. */
  | { type: "reload"; messages: ChatMessage[]; title?: string }
  | { type: "limits"; limits: LimitsView };

export const NEW_CHAT_TITLE = "Новый чат";
/** Как сервер называет беседу без заголовка (app/(app)/group/assistant/actions.ts). */
const UNTITLED = "Без названия";
/** Сервер берёт в заголовок новой беседы первые 60 символов текста (docs/AI-CHAT.md §7, шаг 3) — повторяем до перезагрузки. */
const TITLE_CHARS = 60;

const titleOf = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, TITLE_CHARS) || UNTITLED;

const fromServer = (m: ChatMessage): UiMessage => ({ ...m, key: m.id });

export function initChat(input: { conversation: ConversationInfo | null; messages: ChatMessage[]; limits: LimitsView }): ChatState {
  return {
    conversationId: input.conversation?.id ?? null,
    title: input.conversation?.title ?? NEW_CHAT_TITLE,
    messages: input.messages.map(fromServer),
    pending: null,
    limits: input.limits,
  };
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
      return { ...state, pending: null, messages: patch(state.messages, p.replyId, (m) => ({ ...m, status: "error", note: e.message })) };
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
      // До start сервер сообщение не подтвердил — для человека оно не ушло: убираем и возвращаем в черновик.
      if (!p.started) return chatReducer(state, { type: "rejected" });
      return { ...state, pending: null, messages: patch(state.messages, p.replyId, (m) => ({ ...m, status: "aborted", note: action.note })) };
    }
    case "reload": {
      // Во время стрима серверная версия заведомо старее экранной — не затираем идущий ответ.
      if (state.pending) return state;
      const next = action.messages.map(fromServer);
      // Сервер сохраняет оборванный ответ, заметив разрыв, и может не успеть к нашему перечитыванию: если в базе
      // последним стоит наш вопрос, а на экране после него есть кусок ответа — оставляем кусок, а не стираем его.
      const last = next.at(-1);
      const localReply = state.messages.at(-1);
      const localQuestion = state.messages.at(-2);
      if (last?.role === "user" && localReply?.role === "assistant" && localReply.content && localQuestion?.id === last.id && !next.some((m) => m.id === localReply.id)) {
        next.push(localReply);
      }
      return { ...state, messages: next, title: action.title ?? state.title };
    }
    case "limits":
      return { ...state, limits: action.limits };
  }
}

/** Что показать в пузыре идущего ответа: «думает…», строку инструмента или ничего (текст уже идёт). */
export function replyStage(state: Pick<ChatState, "pending">, m: UiMessage): { kind: "thinking" } | { kind: "tool"; name: string } | null {
  const p = state.pending;
  if (!p || m.id !== p.replyId) return null;
  if (p.tool) return { kind: "tool", name: p.tool };
  return m.content ? null : { kind: "thinking" };
}

/**
 * Что отправить по «Повторить» под неудачным ответом: ближайший вопрос выше. Вложения повторно не шлём —
 * они уже привязаны к первому сообщению и второй раз не привяжутся; вопрос только из фото повторить нечем (null).
 */
export function retrySource(messages: UiMessage[], replyKey: string): { text: string; strong: boolean } | null {
  const i = messages.findIndex((m) => m.key === replyKey);
  for (let j = i - 1; j >= 0; j--) {
    const m = messages[j];
    if (m.role !== "user") continue;
    return m.content.trim() ? { text: m.content, strong: m.strong } : null;
  }
  return null;
}
