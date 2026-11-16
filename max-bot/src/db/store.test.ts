import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ensureSchema, resetSchemaCache } from "./schema.js";
import type { Store } from "./store.js";
import { testStore } from "./testdb.js";

let store: Store;
let close: () => Promise<void>;

before(async () => {
  ({ store, close } = await testStore());
});
after(async () => {
  await close();
});

test("схема идемпотентна: повторный ensureSchema ничего не ломает", async () => {
  resetSchemaCache();
  await ensureSchema(store.db);
  await ensureSchema(store.db);
  assert.equal(await store.getState<number>("schema_version"), 1);
});

test("дедупликация событий", async () => {
  assert.equal(await store.markProcessed("m:abc"), true);
  assert.equal(await store.markProcessed("m:abc"), false);
  assert.equal(await store.markProcessed("c:abc"), true);
});

test("владелец привязывается один раз", async () => {
  assert.equal(await store.setStateIfAbsent("owner", { userId: 1 }), true);
  assert.equal(await store.setStateIfAbsent("owner", { userId: 2 }), false);
  assert.deepEqual(await store.getState("owner"), { userId: 1 });
});

test("чат: режим, темы, история и резюме", async () => {
  const chat = await store.getChat(100, 1);
  assert.equal(chat.mode, "solve");
  assert.equal(chat.topic, 1);
  await store.setMode(100, "chat");
  assert.equal((await store.getChat(100, 1)).mode, "chat");

  const ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push(await store.addMessage(100, 1, i % 2 ? "assistant" : "user", `m${i}`, { i }));
  const last3 = await store.history(100, 1, null, 3);
  assert.deepEqual(last3.map((m) => m.content), ["m2", "m3", "m4"]);
  assert.equal(last3[0]!.meta.i, 2);
  assert.deepEqual((await store.history(100, 1, ids[2]!, 10)).map((m) => m.content), ["m3", "m4"]);
  assert.equal(await store.countAfter(100, 1, ids[1]!), 3);

  assert.equal(await store.setSummary(100, 1, "кратко", ids[1]!), true);
  assert.equal(await store.setSummary(100, 1, "старое", ids[0]!), false, "резюме не откатывается назад");
  const topic = await store.newTopic(100);
  assert.equal(topic, 2);
  const fresh = await store.getChat(100, 1);
  assert.equal(fresh.summary, null);
  assert.equal(await store.setSummary(100, 1, "поздно", ids[4]!), false, "резюме старой темы не пишется в новую");
  assert.deepEqual(await store.history(100, 2, null, 10), []);
});

test("элементы с TTL, take забирает один раз, счётчик и блокировка", async () => {
  await store.putItem("a1", 100, "answer", { q: "x" }, 60);
  assert.deepEqual(await store.getItem("a1", "answer"), { q: "x" });
  assert.equal(await store.getItem("a1", "quiz"), null, "чужой kind не отдаётся");
  assert.deepEqual(await store.takeItem("a1", "answer"), { q: "x" });
  assert.equal(await store.takeItem("a1", "answer"), null);

  await store.putItem("old", 100, "answer", { q: "y" }, -1);
  assert.equal(await store.getItem("old", "answer"), null, "истёкший не виден");

  assert.equal(await store.bump("cf:1", 100, 60), 1);
  assert.equal(await store.bump("cf:1", 100, 60), 2);

  assert.equal(await store.tryLock("lock:x", 60), true);
  assert.equal(await store.tryLock("lock:x", 60), false);
});

test("пачка фото: параллельные добавления попадают в одну пачку, take — один раз", async () => {
  const photo = (n: number) => ({ kind: "image" as const, url: `https://i.max.ru/${n}.jpg`, mid: `mid${n}` });
  const results = await Promise.all([1, 2, 3, 4].map((n) => store.appendPending(200, [photo(n)], 600)));
  const ids = new Set(results.map((r) => r.id));
  assert.equal(ids.size, 1, "одна пачка");
  assert.deepEqual(results.map((r) => r.seq).sort(), [1, 2, 3, 4]);
  const pending = await store.getPending(200);
  assert.equal(pending?.media.length, 4);
  await store.setPendingPrompt(200, pending!.id, "prompt-mid");
  assert.equal((await store.getPending(200))?.promptMid, "prompt-mid");

  const [a, b] = await Promise.all([store.takePending(200, pending!.id), store.takePending(200, pending!.id)]);
  assert.equal([a, b].filter(Boolean).length, 1, "забрать можно только один раз");
  assert.equal(await store.getPending(200), null);
});

test("состояние моделей: пауза, счётчики за день, сброс при успехе", async () => {
  const until = new Date(Date.now() + 3600_000);
  await store.recordModel("gemini:x", "2026-10-08", { ok: false, cooldownUntil: until, reason: "day", error: "429" });
  await store.recordModel("gemini:x", "2026-10-08", { ok: false, cooldownUntil: until, reason: "day", error: "429" });
  let s = (await store.modelStates()).get("gemini:x")!;
  assert.equal(s.failCount, 2);
  assert.equal(s.reason, "day");
  assert.equal(s.cooldownUntil?.getTime(), until.getTime());
  await store.recordModel("gemini:x", "2026-10-09", { ok: true });
  s = (await store.modelStates()).get("gemini:x")!;
  assert.equal(s.okCount, 1);
  assert.equal(s.failCount, 0, "новый день — счётчик ошибок с нуля");
  assert.equal(s.cooldownUntil, null);
  assert.equal(s.day, "2026-10-09");
});

test("cleanup удаляет истёкшее", async () => {
  await store.putItem("gone", 100, "x", {}, -10);
  await store.cleanup();
  assert.equal(await store.getItem("gone", "x"), null);
});

test("строка Neon: sslmode=require → verify-full, остальное не трогаем", async () => {
  const { normalizeDatabaseUrl } = await import("./pool.js");
  assert.equal(
    normalizeDatabaseUrl("postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"),
    "postgresql://u:p@ep-x-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require",
  );
  assert.equal(normalizeDatabaseUrl("postgres://localhost/db"), "postgres://localhost/db");
});
