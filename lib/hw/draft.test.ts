import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addToQueue,
  DEDUP_WINDOW_MS,
  dedupSince,
  DRAFT_KEY,
  DRAFT_TTL_MS,
  findRecentDuplicate,
  freshDue,
  isEmptyDraft,
  isOfflineError,
  markQueueFailed,
  markQueueRetry,
  myQueue,
  nextLessonDate,
  parseDraft,
  parseQueue,
  pruneQueue,
  QUEUE_KEY,
  QUEUE_MAX,
  QUEUE_TTL_MS,
  queueLabel,
  queueToSend,
  removeFromQueue,
  sameHwEntry,
  saveDraft,
  serializeQueue,
  writeQueue,
  writeTo,
  type HwDraft,
  type QueuedHw,
} from "./draft";

const NOW = Date.UTC(2026, 8, 8, 9, 0, 0);
const ME = "u-max";

const draft = (over: Partial<HwDraft> = {}): HwDraft => ({
  userId: ME,
  body: "№ 214–220, стр. 48",
  title: "",
  subjectId: "s-math",
  dueOverride: null,
  savedAt: NOW,
  ...over,
});

const entry = (over: Partial<QueuedHw> = {}): QueuedHw => ({
  key: "k1",
  userId: ME,
  body: "№ 214–220, стр. 48",
  title: "",
  subjectId: "s-math",
  dueDate: "2026-09-11",
  lessonId: null,
  attachmentIds: [],
  queuedAt: NOW,
  tries: 0,
  lastError: null,
  ...over,
});

/* ─── Черновик ─────────────────────────────────────────────────────────────── */

test("parseDraft: свой свежий черновик восстанавливается целиком", () => {
  const d = draft({ title: "Контрольная", dueOverride: "2026-09-14" });
  assert.deepEqual(parseDraft(JSON.stringify(d), ME, NOW + 60_000), d);
});

test("parseDraft: чужой черновик не показывается новому человеку на том же телефоне", () => {
  assert.equal(parseDraft(JSON.stringify(draft({ userId: "u-anya" })), ME, NOW), null);
});

test("parseDraft: старше суток — не восстанавливаем", () => {
  const raw = JSON.stringify(draft());
  assert.notEqual(parseDraft(raw, ME, NOW + DRAFT_TTL_MS - 1), null);
  assert.equal(parseDraft(raw, ME, NOW + DRAFT_TTL_MS + 1), null);
});

test("parseDraft: пустой, битый и отсутствующий черновик — как будто его нет", () => {
  assert.equal(parseDraft(null, ME, NOW), null);
  assert.equal(parseDraft("{не json", ME, NOW), null);
  assert.equal(parseDraft("[]", ME, NOW), null);
  assert.equal(parseDraft(JSON.stringify(draft({ body: "   ", title: "" })), ME, NOW), null);
  // Без savedAt возраст неизвестен — считаем протухшим.
  assert.equal(parseDraft(JSON.stringify({ userId: ME, body: "текст" }), ME, NOW), null);
});

test("parseDraft: мусор в полях не ломает форму", () => {
  const d = parseDraft(JSON.stringify({ ...draft(), subjectId: 42, dueOverride: "завтра", title: null }), ME, NOW);
  assert.deepEqual(d, draft({ subjectId: null, dueOverride: null, title: "" }));
});

test("isEmptyDraft: пробелы — это пусто", () => {
  assert.equal(isEmptyDraft({ body: "  \n ", title: "" }), true);
  assert.equal(isEmptyDraft({ body: "", title: "Контрольная" }), false);
});

/* ─── Очередь ──────────────────────────────────────────────────────────────── */

test("parseQueue: круговой разбор и отсев битых элементов", () => {
  const good = entry();
  const raw = JSON.stringify([good, null, "мусор", { key: "k2" }, { ...entry({ key: "k3" }), dueDate: "11.09.2026" }]);
  assert.deepEqual(parseQueue(raw), [good]);
  assert.deepEqual(parseQueue(serializeQueue([good])), [good]);
  assert.deepEqual(parseQueue(null), []);
  assert.deepEqual(parseQueue("{}"), []);
});

test("addToQueue: тот же ключ идемпотентности не удваивает запись", () => {
  const list = addToQueue([entry()], entry({ body: "уточнил текст" }));
  assert.equal(list.length, 1);
  assert.equal(list[0].body, "уточнил текст");
  assert.equal(addToQueue(list, entry({ key: "k2" })).length, 2);
});

test("addToQueue: очередь не растёт бесконечно, выпадают самые старые", () => {
  let list: QueuedHw[] = [];
  for (let i = 0; i < QUEUE_MAX + 3; i++) list = addToQueue(list, entry({ key: `k${i}` }));
  assert.equal(list.length, QUEUE_MAX);
  assert.equal(list[0].key, "k3");
  assert.equal(list[QUEUE_MAX - 1].key, `k${QUEUE_MAX + 2}`);
});

test("removeFromQueue и pruneQueue", () => {
  assert.deepEqual(removeFromQueue([entry(), entry({ key: "k2" })], "k1").map((e) => e.key), ["k2"]);
  const list = [entry({ key: "old", queuedAt: NOW - QUEUE_TTL_MS - 1 }), entry({ key: "fresh" })];
  assert.deepEqual(pruneQueue(list, NOW).map((e) => e.key), ["fresh"]);
});

test("myQueue: чужие записи не считаются и не отправляются", () => {
  const list = [entry(), entry({ key: "k2", userId: "u-anya" })];
  assert.deepEqual(myQueue(list, ME).map((e) => e.key), ["k1"]);
  assert.deepEqual(queueToSend(list, "u-anya", true).map((e) => e.key), ["k2"]);
});

test("queueToSend: отказ сервера повторяем только вручную", () => {
  const list = markQueueFailed([entry(), entry({ key: "k2" })], "k2", "Слишком много записей за час");
  assert.deepEqual(queueToSend(list, ME, false).map((e) => e.key), ["k1"]);
  assert.deepEqual(queueToSend(list, ME, true).map((e) => e.key), ["k1", "k2"]);
  assert.equal(list[1].tries, 1);
  const retried = markQueueRetry(list, "k2");
  assert.equal(retried[1].lastError, null);
  assert.equal(retried[1].tries, 2);
  assert.deepEqual(queueToSend(retried, ME, false).map((e) => e.key), ["k1", "k2"]);
});

test("queueLabel: русские числительные", () => {
  assert.equal(queueLabel(1), "1 запись ждёт отправки");
  assert.equal(queueLabel(2), "2 записи ждут отправки");
  assert.equal(queueLabel(5), "5 записей ждут отправки");
  assert.equal(queueLabel(11), "11 записей ждут отправки");
});

/* ─── Хранилище ────────────────────────────────────────────────────────────── */

/** Минимальный localStorage: `fail` заставляет setItem бросать, как переполненная квота в Safari. */
const fakeStore = (fail = false) => {
  const map = new Map<string, string>();
  return {
    map,
    storage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (fail) throw new Error("QuotaExceededError");
        map.set(k, v);
      },
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage,
  };
};

/** Подменяет глобальный localStorage на время одного теста (в node его нет вовсе). */
const withStorage = (storage: Storage | null, fn: () => void) => {
  const g = globalThis as { localStorage?: Storage };
  const had = "localStorage" in g;
  const prev = g.localStorage;
  if (storage) g.localStorage = storage;
  else delete g.localStorage;
  try {
    fn();
  } finally {
    if (had) g.localStorage = prev;
    else delete g.localStorage;
  }
};

test("writeTo: отчитывается об отказе, а не молчит", () => {
  const okStore = fakeStore();
  assert.equal(writeTo(okStore.storage, "k", "v"), true);
  assert.equal(okStore.map.get("k"), "v");
  // Квота кончилась: setItem бросил.
  assert.equal(writeTo(fakeStore(true).storage, "k", "v"), false);
  // Хранилище выключено (приватный режим, отключённые данные сайта): setItem даже не зовётся.
  assert.equal(writeTo(null, "k", "v"), false);
});

test("writeQueue: не сохранённая очередь — это false, а не тихий успех", () => {
  const okStore = fakeStore();
  withStorage(okStore.storage, () => {
    assert.equal(writeQueue([entry()]), true);
    assert.deepEqual(parseQueue(okStore.map.get(QUEUE_KEY) ?? null), [entry()]);
    // Пустая очередь просто стирается — терять нечего.
    assert.equal(writeQueue([]), true);
    assert.equal(okStore.map.has(QUEUE_KEY), false);
  });
  withStorage(fakeStore(true).storage, () => {
    assert.equal(writeQueue([entry()]), false);
  });
  withStorage(null, () => {
    assert.equal(writeQueue([entry()]), false);
  });
});

test("saveDraft: отказ хранилища виден вызывающему", () => {
  const okStore = fakeStore();
  withStorage(okStore.storage, () => {
    assert.equal(saveDraft(draft()), true);
    assert.deepEqual(parseDraft(okStore.map.get(DRAFT_KEY) ?? null, ME, NOW), draft());
    // Пустой черновик хранить нечего — стираем и считаем успехом.
    assert.equal(saveDraft(draft({ body: "  ", title: "" })), true);
    assert.equal(okStore.map.has(DRAFT_KEY), false);
  });
  withStorage(fakeStore(true).storage, () => {
    assert.equal(saveDraft(draft()), false);
  });
  withStorage(null, () => {
    assert.equal(saveDraft(draft()), false);
  });
});

/* ─── Дедлайн ──────────────────────────────────────────────────────────────── */

test("nextLessonDate: из кеша SW могли приехать уже прошедшие пары", () => {
  const lessons = [{ date: "2026-09-08" }, { date: "2026-09-11" }];
  assert.equal(nextLessonDate(lessons, "2026-09-08"), "2026-09-08");
  // Страница пролежала в кеше несколько дней: вчерашняя пара дедлайном не станет.
  assert.equal(nextLessonDate(lessons, "2026-09-09"), "2026-09-11");
  assert.equal(nextLessonDate(lessons, "2026-09-12"), null);
  assert.equal(nextLessonDate([], "2026-09-08"), null);
});

test("freshDue: протухшая своя дата из черновика не возвращается", () => {
  assert.equal(freshDue("2026-09-11", "2026-09-08"), "2026-09-11");
  assert.equal(freshDue("2026-09-08", "2026-09-08"), "2026-09-08");
  assert.equal(freshDue("2026-09-07", "2026-09-08"), null);
  assert.equal(freshDue(null, "2026-09-08"), null);
});

/* ─── Ошибка сети ──────────────────────────────────────────────────────────── */

test("isOfflineError: исключения fetch из разных браузеров считаем отсутствием сети", () => {
  assert.equal(isOfflineError(new TypeError("Failed to fetch")), true);
  assert.equal(isOfflineError(new TypeError("Load failed")), true);
  assert.equal(isOfflineError(new TypeError("NetworkError when attempting to fetch resource.")), true);
  assert.equal(isOfflineError(new Error("fetch failed")), true);
  assert.equal(isOfflineError(new Error("An unexpected response was received from the server.")), true);
  assert.equal(isOfflineError(new Error("The network connection was lost.")), true);
  assert.equal(isOfflineError(new Error("net::ERR_INTERNET_DISCONNECTED")), true);
  assert.equal(isOfflineError("Failed to fetch"), true);
});

test("isOfflineError: navigator.onLine=false — сети нет, что бы ни было в ошибке", () => {
  assert.equal(isOfflineError(new Error("Что-то пошло не так"), false), true);
  assert.equal(isOfflineError(undefined, false), true);
});

test("isOfflineError: отказ сервера офлайном не считается", () => {
  assert.equal(isOfflineError(new Error("Слишком много записей за час")), false);
  assert.equal(isOfflineError(new Error("Напиши, что задали")), false);
  assert.equal(isOfflineError(undefined), false);
  assert.equal(isOfflineError({ error: "Failed to fetch" }), false);
});

/* ─── Дедупликация ─────────────────────────────────────────────────────────── */

const row = (over: Partial<{ id: string; body: string; dueDate: string; subjectId: string | null; createdAt: Date }> = {}) => ({
  id: "h1",
  body: "№ 214–220, стр. 48",
  dueDate: "2026-09-11",
  subjectId: "s-math" as string | null,
  createdAt: new Date(NOW),
  ...over,
});

const input = { body: "№ 214–220, стр. 48", dueDate: "2026-09-11", subjectId: "s-math" };

test("sameHwEntry: текст, дедлайн и предмет; пробелы по краям не считаются", () => {
  assert.equal(sameHwEntry(input, { ...input, body: "  № 214–220, стр. 48 " }), true);
  assert.equal(sameHwEntry(input, { ...input, dueDate: "2026-09-12" }), false);
  assert.equal(sameHwEntry(input, { ...input, subjectId: "s-eng" }), false);
  assert.equal(sameHwEntry(input, { ...input, body: "№ 214–221, стр. 48" }), false);
  assert.equal(sameHwEntry({ ...input, subjectId: null }, { ...input, subjectId: null }), true);
});

test("findRecentDuplicate: повтор внутри окна возвращает уже созданную запись", () => {
  assert.equal(findRecentDuplicate([row()], input, dedupSince(NOW + 60_000))?.id, "h1");
  assert.equal(findRecentDuplicate([], input, dedupSince(NOW)), null);
});

test("findRecentDuplicate: старше нижней границы — это новая запись, а не дубль", () => {
  assert.equal(findRecentDuplicate([row()], input, dedupSince(NOW + DEDUP_WINDOW_MS - 1))?.id, "h1");
  assert.equal(findRecentDuplicate([row()], input, dedupSince(NOW + DEDUP_WINDOW_MS + 1)), null);
});

test("dedupSince: свежая отправка — обычное окно, отложенная — от момента постановки в очередь", () => {
  assert.equal(dedupSince(NOW), NOW - DEDUP_WINDOW_MS);
  assert.equal(dedupSince(NOW, NOW - 60 * 60_000), NOW - 60 * 60_000);
  // Запись из будущего (часы телефона врут) окно не сужает.
  assert.equal(dedupSince(NOW, NOW + 60 * 60_000), NOW - DEDUP_WINDOW_MS);
  // И не растягивает его дальше срока жизни очереди.
  assert.equal(dedupSince(NOW, NOW - 30 * QUEUE_TTL_MS), NOW - QUEUE_TTL_MS);
});

test("dedupSince: повтор после суточной заморозки PWA не создаёт второй такой же ДЗ", () => {
  // Вечером запись ушла на сервер, но ответ потерялся: телефон заснул, запись осталась в очереди.
  const queuedAt = NOW;
  const inserted = row({ createdAt: new Date(NOW + 1_000) });
  const morning = NOW + 14 * 60 * 60_000;
  assert.equal(findRecentDuplicate([inserted], input, dedupSince(morning, queuedAt))?.id, "h1");
  // А набранная утром заново запись с тем же текстом дублем не считается — это осознанный повтор.
  assert.equal(findRecentDuplicate([inserted], input, dedupSince(morning)), null);
});

test("findRecentDuplicate: одинаковый текст для разных предметов не склеивается", () => {
  const rows = [row({ id: "h-eng", subjectId: "s-eng" }), row({ id: "h-math" })];
  assert.equal(findRecentDuplicate(rows, input, NOW)?.id, "h-math");
  assert.equal(findRecentDuplicate(rows, { ...input, subjectId: "s-eng" }, NOW)?.id, "h-eng");
  assert.equal(findRecentDuplicate(rows, { ...input, subjectId: "s-hist" }, NOW), null);
});
