import { test } from "node:test";
import assert from "node:assert/strict";
import { chatReducer, findDelivered, initChat, isAnswered, NEW_CHAT_TITLE, NOT_ARRIVED, replyStage, retrySource, type ChatAction, type ChatState } from "./chat-state";
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
// Временные id — свои у каждой отправки, как у tempId в use-chat.ts: иначе второй ответ перепутался бы с первым.
let sent = 0;
const send = (text = "Какие пары завтра?", strong = false): ChatAction => {
  sent++;
  return { type: "send", text, attachments: [], strong, userId: `local-u${sent}`, replyId: `local-r${sent}`, at: AT };
};
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
  assert.match(s.messages[0].key, /^local-u/, "ключ React не меняется — пузырь не перемонтируется");

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
  const s = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "Начал" }), ev({ t: "error", message: "Помощник перегружен", limits: null }));
  assert.equal(s.pending, null);
  assert.equal(s.messages[1].status, "error");
  assert.equal(s.messages[1].content, "Начал");
  assert.equal(s.messages[1].note, "Помощник перегружен");
});

test("rejected и обрыв до start убирают оптимистичные сообщения", () => {
  assert.deepEqual(run(fresh(), send(), { type: "rejected" }).messages, []);
  const s = run(fresh(), send(), { type: "interrupted", note: "Ответ прервался — повтори", await: true });
  assert.deepEqual(s.messages, []);
  assert.equal(s.pending, null);
});

test("обрыв после start: кусок ответа остаётся со статусом aborted", () => {
  const s = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "Первая пара" }), { type: "interrupted", note: "Ответ прервался — повтори", await: true });
  assert.equal(s.messages[1].status, "aborted");
  assert.equal(s.messages[1].content, "Первая пара");
  assert.equal(s.messages[1].note, "Ответ прервался — повтори");
});

test("события без ожидающего ответа игнорируются", () => {
  const s = fresh();
  assert.equal(run(s, ev({ t: "delta", text: "x" })), s);
  assert.equal(run(s, { type: "interrupted", note: "x", await: true }), s);
});

test("reload: серверная версия заменяет экранную, но не во время стрима", () => {
  const streaming = run(fresh(), send());
  assert.equal(run(streaming, { type: "reload", messages: [] }), streaming);

  const done = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "done", messageId: RID, limits: null, usage: null }));
  const s = run(done, {
    type: "reload",
    messages: [msg(MID, "user", "вопрос"), msg(RID, "assistant", "ответ с сервера")],
    conversation: { id: CID, title: "Вопрос", createdAt: AT, updatedAt: AT, archivedAt: null },
  });
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
  const cut = run(fresh(), send("вопрос"), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "кусок" }), { type: "interrupted", note: "Ответ прервался — повтори", await: true });
  const s = run(cut, { type: "reload", messages: [msg(MID, "user", "вопрос")] });
  assert.equal(s.messages.length, 2);
  assert.equal(s.messages[1].content, "кусок");
  assert.equal(s.messages[1].status, "aborted");

  // Сервер успел — берём его версию, без дубля.
  const saved = run(cut, { type: "reload", messages: [msg(MID, "user", "вопрос"), msg(RID, "assistant", "кусок", { status: "aborted" })] });
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.messages[1].id, RID);
});

const PHOTO = { id: "f", name: "p.jpg", mime: "image/jpeg", url: "/api/files/f" };

test("retrySource: ближайший вопрос выше неудачного ответа — с теми же файлами (#22)", () => {
  const s = initChat({
    conversation: null,
    limits: LIMITS,
    messages: [
      msg("u1", "user", "первый"),
      msg("a1", "assistant", "ок"),
      msg("u2", "user", "Проверь моё решение:", { strong: true, attachments: [PHOTO] }),
      msg("a2", "assistant", "", { status: "error" }),
      msg("u3", "user", "   ", { attachments: [PHOTO] }),
      msg("a3", "assistant", "", { status: "aborted" }),
      msg("u4", "user", "  "),
      msg("a4", "assistant", "", { status: "error" }),
    ],
  });
  assert.deepEqual(retrySource(s.messages, "a2"), { text: "Проверь моё решение:", strong: true, attachments: [PHOTO] });
  assert.deepEqual(retrySource(s.messages, "a3"), { text: "   ", strong: false, attachments: [PHOTO] }, "вопрос из одного фото тоже повторяется");
  assert.equal(retrySource(s.messages, "a4"), null, "ни текста, ни файлов — повторять нечего");
  assert.equal(retrySource(s.messages, "нет-такого"), null);
});

const Q1 = "44444444-4444-4444-8444-444444444441";
const A1 = "44444444-4444-4444-8444-444444444442";
const Q2 = "44444444-4444-4444-8444-444444444443";
const A2 = "44444444-4444-4444-8444-444444444444";
const conv = (messages: ChatMessage[] = []) => initChat({ conversation: { id: CID, title: "Матан", createdAt: AT, updatedAt: AT, archivedAt: null }, messages, limits: LIMITS });

test("#17: обрыв до первого слова — пустой ответ не исчезает при перечитывании, а ждёт сервер", () => {
  const cut = run(conv(), send("Какие пары завтра?"), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "tool", name: "get_schedule" }), {
    type: "interrupted",
    note: "Ответ прервался — повтори",
    await: true,
  });
  const reply = cut.messages[1];
  assert.deepEqual(cut.awaiting, { questionId: MID, replyKey: reply.key, fresh: true });
  assert.deepEqual(replyStage(cut, reply), { kind: "awaiting" }, "«ответ ещё готовится…», а не «Повторить»");

  // В базе пока только вопрос: пузырь остаётся (пустой!), ожидание продолжается.
  const waiting = run(cut, { type: "reload", messages: [msg(MID, "user", "Какие пары завтра?")] });
  assert.equal(waiting.messages.length, 2);
  assert.equal(waiting.messages[1].key, reply.key);
  assert.equal(waiting.messages[1].content, "");
  assert.deepEqual(waiting.awaiting, cut.awaiting);

  // Ответ появился — он заменяет пузырь, ждать больше нечего.
  const answered = run(waiting, { type: "reload", messages: [msg(MID, "user", "Какие пары завтра?"), msg(RID, "assistant", "Завтра две пары.")] });
  assert.deepEqual(
    answered.messages.map((m) => [m.id, m.content]),
    [
      [MID, "Какие пары завтра?"],
      [RID, "Завтра две пары."],
    ],
  );
  assert.equal(answered.awaiting, null);

  // Так и не появился — ждать перестали: пометка остаётся, stage пропадает, «Повторить» снова доступен.
  const gaveUp = run(waiting, { type: "awaitEnd", questionId: MID });
  assert.equal(gaveUp.awaiting, null);
  assert.equal(replyStage(gaveUp, gaveUp.messages[1]), null);
  assert.equal(gaveUp.messages[1].note, "Ответ прервался — повтори");
  // Следующее перечитывание (RSC-refresh) ожидание заново не запускает.
  assert.equal(run(gaveUp, { type: "reload", messages: [msg(MID, "user", "Какие пары завтра?")] }).awaiting, null);
});

test("«Стоп» — ответ не ждём, показываем «Остановлено»", () => {
  const s = run(conv(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "Начало" }), { type: "interrupted", note: "Остановлено", await: false });
  assert.equal(s.awaiting, null);
  assert.equal(s.messages[1].note, "Остановлено");
  assert.equal(replyStage(s, s.messages[1]), null);
});

test("открытие беседы, где последний — вопрос без ответа: заглушка и ожидание", () => {
  const s = conv([msg(Q1, "user", "вопрос")]);
  assert.equal(s.messages.length, 2);
  const ph = s.messages[1];
  assert.equal(ph.role, "assistant");
  assert.equal(ph.content, "");
  assert.equal(ph.note, NOT_ARRIVED);
  assert.deepEqual(s.awaiting, { questionId: Q1, replyKey: ph.key, fresh: false });
  // Та же заглушка на повторном перечитывании: ключ React не меняется.
  const again = run(s, { type: "reload", messages: [msg(Q1, "user", "вопрос")] });
  assert.equal(again.messages[1].key, ph.key);
  assert.deepEqual(again.awaiting, s.awaiting);
});

test("#19: «Стоп» → «Повторить» — порядок только серверный, пары не переставляются", () => {
  const stopped = run(
    conv([msg(Q1, "user", "реши"), msg(A1, "assistant", "полный ответ")]),
    send("реши задачу 2"),
    ev({ t: "start", conversationId: CID, messageId: Q2 }),
    ev({ t: "delta", text: "Нач" }),
    { type: "interrupted", note: "Остановлено", await: false },
  );
  const retried = run(stopped, send("реши задачу 2"), ev({ t: "start", conversationId: CID, messageId: "55555555-5555-4555-8555-555555555551" }), ev({ t: "delta", text: "Ответ" }), ev({ t: "done", messageId: "55555555-5555-4555-8555-555555555552", limits: null, usage: null }));
  const Q3 = "55555555-5555-4555-8555-555555555551";
  const A3 = "55555555-5555-4555-8555-555555555552";

  // Остановленный ответ сервер ещё пишет (Vercel не прерывает функцию): кусок остаётся под своим вопросом.
  const pending = run(retried, {
    type: "reload",
    messages: [msg(Q1, "user", "реши"), msg(A1, "assistant", "полный ответ"), msg(Q2, "user", "реши задачу 2"), msg(Q3, "user", "реши задачу 2"), msg(A3, "assistant", "Ответ")],
  });
  assert.deepEqual(
    pending.messages.map((m) => [m.role, m.content]),
    [
      ["user", "реши"],
      ["assistant", "полный ответ"],
      ["user", "реши задачу 2"],
      ["assistant", "Нач"],
      ["user", "реши задачу 2"],
      ["assistant", "Ответ"],
    ],
  );

  // Сервер дописал остановленный ответ и поставил его сразу за вопросом (created_at = вопрос + 1 мс).
  const saved = run(retried, {
    type: "reload",
    messages: [
      msg(Q1, "user", "реши"),
      msg(A1, "assistant", "полный ответ"),
      msg(Q2, "user", "реши задачу 2"),
      msg(A2, "assistant", "Начало и конец"),
      msg(Q3, "user", "реши задачу 2"),
      msg(A3, "assistant", "Ответ"),
    ],
  });
  assert.deepEqual(
    saved.messages.map((m) => m.id),
    [Q1, A1, Q2, A2, Q3, A3],
  );
});

test("старые беседы с порядком Q, Q, A, A не получают заглушку посередине", () => {
  const s = conv([msg(Q1, "user", "раз"), msg(Q2, "user", "два"), msg(A1, "assistant", "ответ 1"), msg(A2, "assistant", "ответ 2")]);
  assert.deepEqual(
    s.messages.map((m) => m.id),
    [Q1, Q2, A1, A2],
  );
  assert.equal(s.awaiting, null);
});

test("снимок старее экрана (refresh начат до отправки): новые строки не пропадают", () => {
  const done = run(conv([msg(Q1, "user", "раз"), msg(A1, "assistant", "ответ 1")]), send("два"), ev({ t: "start", conversationId: CID, messageId: Q2 }), ev({ t: "done", messageId: A2, limits: null, usage: null }));
  const s = run(done, { type: "reload", messages: [msg(Q1, "user", "раз"), msg(A1, "assistant", "ответ 1")] });
  assert.deepEqual(
    s.messages.map((m) => m.id),
    [Q1, A1, Q2, A2],
  );
  assert.equal(s.awaiting, null);
});

test("#21: error с limits обновляет остатки, без limits — оставляет", () => {
  const spent: LimitsView = { ...LIMITS, strong: { used: 4, limit: 4 } };
  const withLimits = run(fresh(), send("?", true), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "delta", text: "a" }), ev({ t: "error", message: "обрыв", limits: spent }));
  assert.deepEqual(withLimits.limits, spent);
  const without = run(fresh(), send(), ev({ t: "start", conversationId: CID, messageId: MID }), ev({ t: "error", message: "обрыв", limits: null }));
  assert.deepEqual(without.limits, LIMITS);
});

test("#23: экран «нового чата» подхватывает беседу из адреса", () => {
  const s = run(fresh(), {
    type: "reload",
    messages: [msg(Q1, "user", "вопрос"), msg(A1, "assistant", "ответ")],
    conversation: { id: CID, title: "Вопрос", createdAt: AT, updatedAt: AT, archivedAt: null },
  });
  assert.equal(s.conversationId, CID);
  assert.equal(s.title, "Вопрос");
  assert.equal(s.messages.length, 2);
});

test("findDelivered: вопрос, ушедший без start, узнаётся по новой строке с тем же текстом", () => {
  const server = [msg(Q1, "user", "раз"), msg(A1, "assistant", "ответ"), msg(Q2, "user", "раз")];
  assert.equal(findDelivered(server, new Set([Q1, A1]), { text: "  раз ", attachmentIds: [] })?.id, Q2);
  assert.equal(findDelivered(server, new Set([Q1, A1, Q2]), { text: "раз", attachmentIds: [] }), null, "старый такой же вопрос — не наш");
  assert.equal(findDelivered(server, new Set([Q1, A1]), { text: "два", attachmentIds: [] }), null);
  const photo = [msg(Q1, "user", "", { attachments: [PHOTO] })];
  assert.equal(findDelivered(photo, new Set(), { text: "", attachmentIds: ["f"] })?.id, Q1, "вопрос из одного фото — по файлам");
  assert.equal(findDelivered(photo, new Set(), { text: "", attachmentIds: ["g"] }), null);
});

test("isAnswered: ответ — строка сразу за вопросом", () => {
  const server = [msg(Q1, "user", "раз"), msg(A1, "assistant", "ответ"), msg(Q2, "user", "два")];
  assert.equal(isAnswered(server, Q1), true);
  assert.equal(isAnswered(server, Q2), false);
  assert.equal(isAnswered(server, "нет"), false);
});
