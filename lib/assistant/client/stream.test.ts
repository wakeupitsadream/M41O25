import { test } from "node:test";
import assert from "node:assert/strict";
import { createEventParser, describeFailure, parseChatEvent, readChatStream, type StreamEvent } from "./stream";
import type { LimitsView } from "../types";

const LIMITS: LimitsView = {
  day: { used: 1, limit: 15 },
  week: { used: 1, limit: 50 },
  strong: { used: 0, limit: 4 },
  resetsDay: "2026-09-25",
  resetsWeek: "2026-09-28",
};

const CID = "11111111-1111-4111-8111-111111111111";
const MID = "22222222-2222-4222-8222-222222222222";
const RID = "33333333-3333-4333-8333-333333333333";

const line = (e: unknown) => `${JSON.stringify(e)}\n`;

/** Поток из заранее нарезанных байтовых кусков — как их отдаёт сеть. */
const streamOf = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });

const collect = async (chunks: Uint8Array[]) => {
  const out: StreamEvent[] = [];
  await readChatStream(streamOf(chunks), (e) => out.push(e));
  return out;
};

test("parseChatEvent: все пять событий протокола", () => {
  assert.deepEqual(parseChatEvent(JSON.stringify({ t: "start", conversationId: CID, messageId: MID })), { t: "start", conversationId: CID, messageId: MID });
  assert.deepEqual(parseChatEvent(JSON.stringify({ t: "delta", text: "При" })), { t: "delta", text: "При" });
  assert.deepEqual(parseChatEvent(JSON.stringify({ t: "tool", name: "get_schedule" })), { t: "tool", name: "get_schedule" });
  const usage = { prompt: 1200, completion: 80, cached: 0 };
  assert.deepEqual(parseChatEvent(JSON.stringify({ t: "done", messageId: RID, limits: LIMITS, usage })), { t: "done", messageId: RID, limits: LIMITS, usage });
  assert.deepEqual(parseChatEvent(JSON.stringify({ t: "error", message: "Помощник перегружен" })), { t: "error", message: "Помощник перегружен" });
});

test("parseChatEvent: битые и незнакомые строки не роняют разбор", () => {
  assert.equal(parseChatEvent("{не json"), null);
  assert.equal(parseChatEvent("[1,2]"), null);
  assert.equal(parseChatEvent("null"), null);
  assert.equal(parseChatEvent(JSON.stringify({ t: "ping" })), null);
  assert.equal(parseChatEvent(JSON.stringify({ t: "delta" })), null);
  assert.equal(parseChatEvent(JSON.stringify({ t: "start", conversationId: CID })), null);
});

test("parseChatEvent: done с битыми limits остаётся done, ошибка без текста получает общую фразу", () => {
  assert.deepEqual(parseChatEvent(JSON.stringify({ t: "done", messageId: RID, limits: { day: 1 }, usage: null })), { t: "done", messageId: RID, limits: null, usage: null });
  const e = parseChatEvent(JSON.stringify({ t: "error" }));
  assert.equal(e?.t, "error");
  assert.ok(e?.t === "error" && e.message.length > 0);
});

test("createEventParser: строка, разрезанная между кусками, склеивается", () => {
  const p = createEventParser();
  const whole = line({ t: "delta", text: "Привет" }) + line({ t: "delta", text: ", мир" });
  const cut = 9;
  assert.deepEqual(p.push(whole.slice(0, cut)), []);
  assert.deepEqual(p.push(whole.slice(cut)), [
    { t: "delta", text: "Привет" },
    { t: "delta", text: ", мир" },
  ]);
  assert.deepEqual(p.end(), []);
});

test("createEventParser: CRLF, пустые строки и хвост без \\n в конце потока", () => {
  const p = createEventParser();
  const got = p.push(`${JSON.stringify({ t: "tool", name: "get_news" })}\r\n\r\n\n${JSON.stringify({ t: "delta", text: "а" })}`);
  assert.deepEqual(got, [{ t: "tool", name: "get_news" }]);
  assert.deepEqual(p.end(), [{ t: "delta", text: "а" }]);
});

test("readChatStream: кириллица, разрезанная посреди байтов буквы", async () => {
  const bytes = new TextEncoder().encode(line({ t: "start", conversationId: CID, messageId: MID }) + line({ t: "delta", text: "Ёжик в тумане" }) + line({ t: "done", messageId: RID, limits: LIMITS, usage: null }));
  // Режем по одному байту: каждая русская буква (2 байта) гарантированно окажется в двух кусках.
  const chunks = Array.from(bytes, (b) => new Uint8Array([b]));
  const events = await collect(chunks);
  assert.deepEqual(
    events.map((e) => e.t),
    ["start", "delta", "done"],
  );
  assert.deepEqual(events[1], { t: "delta", text: "Ёжик в тумане" });
});

test("readChatStream: последнее событие без завершающего перевода строки не теряется", async () => {
  const enc = new TextEncoder();
  const events = await collect([enc.encode(line({ t: "delta", text: "x" })), enc.encode(JSON.stringify({ t: "error", message: "обрыв" }))]);
  assert.deepEqual(events, [
    { t: "delta", text: "x" },
    { t: "error", message: "обрыв" },
  ]);
});

test("readChatStream: обрыв потока пробрасывается вызывающему после уже полученных событий", async () => {
  const enc = new TextEncoder();
  let pulls = 0;
  // Первый кусок доходит, на втором сеть рвётся — как iOS, заморозивший PWA посреди ответа.
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (pulls++ === 0) c.enqueue(enc.encode(line({ t: "delta", text: "начало" })));
      else c.error(new Error("network lost"));
    },
  });
  const got: StreamEvent[] = [];
  await assert.rejects(
    readChatStream(body, (e) => got.push(e)),
    /network lost/,
  );
  assert.deepEqual(got, [{ t: "delta", text: "начало" }]);
});

test("describeFailure: коды из протокола §7", () => {
  assert.deepEqual(describeFailure(401, null), { kind: "auth" });

  const paid = describeFailure(402, { error: "Пробная неделя закончилась", access: { kind: "expired", since: "2026-09-20" } });
  assert.equal(paid.kind, "blocked");
  assert.ok(paid.kind === "blocked" && paid.status === 402 && paid.message === "Пробная неделя закончилась");
  assert.deepEqual(paid.kind === "blocked" && paid.access, { kind: "expired", since: "2026-09-20" });

  const off = describeFailure(403, { error: "Помощник выключен" });
  assert.ok(off.kind === "blocked" && off.status === 403 && off.access === null && off.limits === null);

  const limit = describeFailure(429, { error: "Лимит на сегодня исчерпан — обновится в полночь", limits: LIMITS });
  assert.ok(limit.kind === "blocked" && limit.status === 429);
  assert.deepEqual(limit.kind === "blocked" && limit.limits, LIMITS);

  // Без тела (прокси отдал HTML) — своё объяснение, а не пустая карточка.
  const bare = describeFailure(429, null);
  assert.ok(bare.kind === "blocked" && bare.message.length > 0 && bare.limits === null);
});

test("describeFailure: 404 до деплоя роута и 5xx — «сервер не ответил», 400 — текст сервера", () => {
  const missing = describeFailure(404, { error: "not found" });
  assert.equal(missing.kind, "server");
  assert.match(missing.kind === "server" ? missing.message : "", /^Сервер не ответил \(404\)/);
  assert.deepEqual(describeFailure(502, null), { kind: "server", message: "Сервер не ответил (502) — попробуй ещё раз" });
  assert.deepEqual(describeFailure(400, { error: "Сообщение длиннее 4000 символов" }), { kind: "server", message: "Сообщение длиннее 4000 символов" });
});
