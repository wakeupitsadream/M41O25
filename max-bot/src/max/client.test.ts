import assert from "node:assert/strict";
import { test } from "node:test";
import { createMaxClient, MaxApiError } from "./client.js";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeFetch(responses: Array<(c: Call) => Response>) {
  const calls: Call[] = [];
  const fn = (async (input: URL | string, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next(call);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const noSleep = async () => {};

test("sendMessage: токен в Authorization без Bearer, chat_id в query, тело как есть", async () => {
  const { fn, calls } = fakeFetch([() => json(200, { message: { body: { mid: "m1", text: "ok" }, recipient: {}, timestamp: 1 } })]);
  const max = createMaxClient({ token: "T0K", baseUrl: "https://platform-api2.max.ru", fetch: fn, sleep: noSleep });
  const msg = await max.sendMessage({ chatId: 42 }, { text: "<b>hi</b>", format: "html" });
  assert.equal(msg.body.mid, "m1");
  assert.equal(calls[0]!.url, "https://platform-api2.max.ru/messages?chat_id=42");
  assert.equal(calls[0]!.method, "POST");
  assert.equal(calls[0]!.headers.Authorization, "T0K");
  assert.deepEqual(calls[0]!.body, { text: "<b>hi</b>", format: "html" });
});

test("429 повторяется с паузой, 400 — сразу ошибка с кодом MAX", async () => {
  const { fn, calls } = fakeFetch([
    () => json(429, { code: "too.many.requests", message: "slow down" }, { "retry-after": "1" }),
    () => json(200, { success: true }),
    () => json(400, { code: "proto.payload", message: "bad text" }),
  ]);
  const max = createMaxClient({ token: "T", baseUrl: "https://x.test", fetch: fn, sleep: noSleep });
  await max.editMessage("mid1", { text: "x" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]!.url, "https://x.test/messages?message_id=mid1");
  await assert.rejects(max.sendMessage({ userId: 7 }, { text: "x" }), (e: unknown) => {
    assert.ok(e instanceof MaxApiError);
    assert.equal(e.status, 400);
    assert.equal(e.code, "proto.payload");
    return true;
  });
});

test("success:false в ответе 200 — ошибка", async () => {
  const { fn } = fakeFetch([() => json(200, { success: false, message: "callback expired" })]);
  const max = createMaxClient({ token: "T", baseUrl: "https://x.test", fetch: fn, sleep: noSleep });
  await assert.rejects(max.answerCallback("cb1", { notification: "ok" }), /callback expired/);
});

test("подписка: секрет и типы событий в теле, отписка через query url", async () => {
  const { fn, calls } = fakeFetch([() => json(200, { success: true }), () => json(200, { success: true })]);
  const max = createMaxClient({ token: "T", baseUrl: "https://x.test/", fetch: fn, sleep: noSleep });
  await max.subscribe("https://bot.vercel.app/api/webhook", "sec", ["message_created"]);
  await max.unsubscribe("https://old.example/hook");
  assert.deepEqual(calls[0]!.body, { url: "https://bot.vercel.app/api/webhook", secret: "sec", update_types: ["message_created"] });
  assert.equal(calls[1]!.method, "DELETE");
  assert.equal(calls[1]!.url, "https://x.test/subscriptions?url=https%3A%2F%2Fold.example%2Fhook");
});

test("download: без авторизации, лимит размера, токен только для хостов MAX", async () => {
  const { fn, calls } = fakeFetch([
    () => new Response(null, { status: 403 }),
    () => new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } }),
    () => new Response(null, { status: 403 }),
    () => new Response(Buffer.alloc(2000), { status: 200 }),
  ]);
  const max = createMaxClient({ token: "SECRET", baseUrl: "https://x.test", fetch: fn, sleep: noSleep });
  const file = await max.download("https://i.max.ru/photo.jpg", 1000);
  assert.equal(file.contentType, "image/jpeg");
  assert.equal(calls[0]!.headers.Authorization, undefined);
  assert.equal(calls[1]!.headers.Authorization, "SECRET");
  await assert.rejects(max.download("https://evil.example/p.jpg", 1000), /download.failed/);
  assert.equal(calls.length, 3, "чужому хосту токен не отправляется");
  await assert.rejects(max.download("https://i.max.ru/big.jpg", 1000), /file.too.big/);
});

test("регрессия: отправку сообщения не повторяем после 502 и таймаута (MAX мог её принять), 503 и 429 — повторяем", async () => {
  const { fn, calls } = fakeFetch([() => json(502, { code: "bad.gateway", message: "x" })]);
  const max = createMaxClient({ token: "T", baseUrl: "https://x.test", fetch: fn, sleep: noSleep });
  await assert.rejects(max.sendMessage({ chatId: 1 }, { text: "x" }), /502/);
  assert.equal(calls.length, 1);

  const ok = { message: { body: { mid: "m" }, recipient: {}, timestamp: 1 } };
  const retry = fakeFetch([() => json(503, {}), () => json(429, {}), () => json(200, ok)]);
  const max2 = createMaxClient({ token: "T", baseUrl: "https://x.test", fetch: retry.fn, sleep: noSleep });
  assert.equal((await max2.sendMessage({ chatId: 1 }, { text: "x" })).body.mid, "m");

  const timeout = fakeFetch([
    () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    },
  ]);
  const max3 = createMaxClient({ token: "T", baseUrl: "https://x.test", fetch: timeout.fn, sleep: noSleep });
  await assert.rejects(max3.sendMessage({ chatId: 1 }, { text: "x" }), /network/);
  assert.equal(timeout.calls.length, 1);

  const refused = fakeFetch([
    () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    },
    () => json(200, ok),
  ]);
  const max4 = createMaxClient({ token: "T", baseUrl: "https://x.test", fetch: refused.fn, sleep: noSleep });
  assert.equal((await max4.sendMessage({ chatId: 1 }, { text: "x" })).body.mid, "m", "соединение не открылось — можно повторить");
});
