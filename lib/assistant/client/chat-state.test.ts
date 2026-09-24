import { test } from "node:test";
import assert from "node:assert/strict";
import { chatReducer, initChat, NEW_CHAT_TITLE, replyStage, retrySource, type ChatAction, type ChatState } from "./chat-state";
import type { ChatMessage, LimitsView } from "../types";

const LIMITS: LimitsView = {
  day: { used: 0, limit: 15 },
  week: { used: 0, limit: 50 },
  strong: { used: 0, limit: 4 },
  budget: { used: 0, limit: 8000 },
  resetsDay: "2026-09-25",
  resetsWeek: "2026-09-28",
};
const AFTER: LimitsView = { ...LIMITS, day: { used: 1, limit: 15 }, week: { used: 1, limit: 50 } };

const CID = "11111111-1111-4111-8111-111111111111";
const MID = "22222222-2222-4222-8222-222222222222";
const RID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-09-24T10:00:00.000Z";

const fresh = () => initChat({ conversation: null, messages: [], limits: LIMITS });
const send = (text = "Какие пары завтра?", strong = false): ChatAction => ({ type: "send", text, attachments: [], strong, userId: "local-u", replyId: "local-r", at: AT });
const run = (s: ChatState, ...actions: ChatAction[]) => actions.reduce(chatReducer, s);
const ev = (event: Extract<ChatAction, { type: "event" }>["event"]): ChatAction => ({ type: "event", event });

const msg = (id: string, role: ChatMessage["role"], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  role,
  content,
  attachments: [],
  strong: false,
  status: "done",
  createdAt: AT,
  ...extra,
});

test("новый чат: заголовок-заглушка, беседы нет", () => {
  const s = fresh();
  assert.equal(s.conversationId, null);
  assert.equal(s.title, NEW_CHAT_TITLE);
  assert.equal(s.pending, null);
});

test("полный путь: send → start → tool → delta → done", () => {
  let s = run(fresh(), send("  Какие   пары\nзавтра?  "));
  assert.equal(s.messages.length, 2);
  assert.deepEqual(replyStage(s, s.messages[1]), { kind: "thinking" });

  s = run(s, ev({ t: "start", conversationId: CID, messageId: MID }));
  assert.equal(s.conversationId, CID);
  assert.equal(s.title, "Какие пары завтра?", "заголовок новой беседы — начало вопроса одной строкой");
  assert.equal(s.messages[0].id, MID, "временный id вопроса заменён серверным");
  assert.equal(s.messages[0].key, "local-u", "ключ React не меняется — пузырь не перемонтируется");

  s = run(s, ev({ t: "tool", name: "get_schedule" }));
  assert.deepEqual(replyStage(s, s.messages[1]), { kind: "tool", name: "get_schedule" });

  const before = s.messages[0];
  s = run(s, ev({ t: "delta", text: "Завтра " }), ev({ t: "delta", text: "две пары." }));
  assert.equal(s.messages[1].content, "Завтра две пары.");
  assert.equal(replyStage(s, s.messages[1]), null, "пошёл текст — строка инструмента скрыта");
  assert.equal(s.messages[0], before, "вопрос не пересоздаётся на каждый delta");

  s = run(s, ev({ t: "done", messageId: RID, limits: AFTER, usage: null }));
  assert.equal(s.pending, null);
  assert.equal(s.messages[1].id, RID);
  assert.equal(s.messages[1].status, "done");
  assert.deepEqual(s.limits, AFTER);
});

test("done без limits оставляет прежние остатки", () => {
  const s = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "done", messageId: RID, limits: null, usage: null }));
  assert.deepEqual(s.limits, LIMITS);
});

test("существующая беседа сохраняет свой заголовок после start", () => {
  const s0 = initChat({ conversation: { id: CID, title: "Матан", createdAt: AT, updatedAt: AT, archivedAt: null }, messages: [], limits: LIMITS });
  const s = run(s0, send("новый вопрос"), ev({ t: "start", conversationId: CID, messageId: MID }));
  assert.equal(s.title, "Матан");
});

test("вторая отправка во время стрима игнорируется", () => {
  const s = run(fresh(), send("раз"), send("два"));
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[0].content, "раз");
});

test("error: ответ помечен ошибкой с текстом сервера, частичный текст остаётся", () => {
  const s = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "Начал" }), ev({ t: "error", message: "Помощник перегружен" }));
  assert.equal(s.pending, null);
  assert.equal(s.messages[1].status, "error");
  assert.equal(s.messages[1].content, "Начал");
  assert.equal(s.messages[1].note, "Помощник перегружен");
});

test("rejected и обрыв до start убирают оптимистичные сообщения", () => {
  assert.deepEqual(run(fresh(), send(), { type: "rejected" }).messages, []);
  const s = run(fresh(), send(), { type: "interrupted", note: "Ответ прервался — повтори" });
  assert.deepEqual(s.messages, []);
  assert.equal(s.pending, null);
});

test("обрыв после start: кусок ответа остаётся со статусом aborted", () => {
  const s = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "Первая пара" }), { type: "interrupted", note: "Ответ прервался — повтори" });
  assert.equal(s.messages[1].status, "aborted");
  assert.equal(s.messages[1].content, "Первая пара");
  assert.equal(s.messages[1].note, "Ответ прервался — повтори");
});

test("события без ожидающего ответа игнорируются", () => {
  const s = fresh();
  assert.equal(run(s, ev({ t: "delta", text: "x" })), s);
  assert.equal(run(s, { type: "interrupted", note: "x" }), s);
});

test("reload: серверная версия заменяет экранную, но не во время стрима", () => {
  const streaming = run(fresh(), send());
  assert.equal(run(streaming, { type: "reload", messages: [] }), streaming);

  const done = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "done", messageId: RID, limits: null, usage: null }));
  const s = run(done, { type: "reload", messages: [msg(MID, "user", "вопрос"), msg(RID, "assistant", "ответ с сервера")], title: "Вопрос" });
  assert.deepEqual(
    s.messages.map((m) => [m.key, m.content]),
    [
      [MID, "вопрос"],
      [RID, "ответ с сервера"],
    ],
  );
  assert.equal(s.title, "Вопрос");
});

test("reload после обрыва: сервер ещё не сохранил ответ — показанный кусок не пропадает", () => {
  const cut = run(fresh(), send("вопрос"), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "кусок" }), { type: "interrupted", note: "Ответ прервался — повтори" });
  const s = run(cut, { type: "reload", messages: [msg(MID, "user", "вопрос")] });
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[1].content, "кусок");
  assert.equal(s.messages[1].status, "aborted");

  // Сервер успел — берём его версию, без дубля.
  const saved = run(cut, { type: "reload", messages: [msg(MID, "user", "вопрос"), msg(RID, "assistant", "кусок", { status: "aborted" })] });
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].id, RID);
});

test("retrySource: ближайший вопрос выше неудачного ответа; вопрос только из фото повторить нечем", () => {
  const s = initChat({
    conversation: null,
    limits: LIMITS,
    messages: [
      msg("u1", "user", "первый"),
      msg("a1", "assistant", "ок"),
      msg("u2", "user", "второй", { strong: true }),
      msg("a2", "assistant", "", { status: "error" }),
      msg("u3", "user", "   ", { attachments: [{ id: "f", name: "p.jpg", mime: "image/jpeg", url: "/api/files/f" }] }),
      msg("a3", "assistant", "", { status: "aborted" }),
    ],
  });
  assert.deepEqual(retrySource(s.messages, "a2"), { text: "второй", strong: true });
  assert.equal(retrySource(s.messages, "a3"), null);
  assert.equal(retrySource(s.messages, "нет-такого"), null);
});
