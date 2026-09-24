import { test } from "node:test";
import assert from "node:assert/strict";
import { clipText, ddmm, fitJson, shareBudget, weekdayRu } from "./compact";

test("clipText: короче лимита — как есть; длиннее — по границе слова с «…»", () => {
  assert.equal(clipText("коротко", 20), "коротко");
  const s = clipText("раз два три четыре пять шесть семь", 20);
  assert.ok(s.length <= 20);
  assert.ok(s.endsWith("…"));
  assert.equal(s, "раз два три четыре…");
  // Нет пробела рядом с границей — режем по символу.
  assert.equal(clipText("а".repeat(50), 10), `${"а".repeat(9)}…`);
});

test("fitJson: влезает — без изменений", () => {
  const v = { from: "2026-09-24", items: [{ a: 1 }] };
  assert.equal(fitJson(v, "items", 4000), JSON.stringify(v));
});

test("fitJson: длинный список режется по элементам, JSON валиден и с пометкой", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ title: `Новость ${i}`, body: "текст ".repeat(20) }));
  const s = fitJson({ items }, "items", 4000);
  assert.ok(s.length <= 4000);
  const parsed = JSON.parse(s) as { items: unknown[]; truncated: string };
  assert.ok(parsed.items.length > 5 && parsed.items.length < 100);
  assert.equal(parsed.truncated, `показаны первые ${parsed.items.length} из 100 — сузи запрос (период, предмет, limit)`);
});

test("fitJson: один огромный элемент — строки в нём укорачиваются, поля остаются", () => {
  const s = fitJson({ items: [{ subject: "Матан", body: "задача ".repeat(2000) }, { subject: "История", body: "x" }] }, "items", 1000);
  assert.ok(s.length <= 1000);
  const parsed = JSON.parse(s) as { items: { subject: string; body: string }[]; truncated: string };
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0].subject, "Матан");
  assert.ok(parsed.items[0].body.endsWith("…"));
  assert.match(parsed.truncated, /показаны первые 1 из 2/);
});

test("fitJson: undefined-поля не мешают, без списка — укорачиваются строки", () => {
  const s = fitJson({ note: "н".repeat(5000), skip: undefined }, "items", 300);
  assert.ok(s.length <= 300);
  const parsed = JSON.parse(s) as { note: string; truncated: string };
  assert.ok(parsed.note.endsWith("…"));
  assert.equal(parsed.truncated, "текст укорочен");
});

test("weekdayRu и ddmm: календарная дата без сдвига по поясу", () => {
  assert.equal(weekdayRu("2026-09-24"), "чт");
  assert.equal(weekdayRu("2026-09-27", true), "воскресенье");
  assert.equal(weekdayRu("2026-09-28", true), "понедельник");
  assert.equal(ddmm("2026-09-04"), "04.09");
});

test("shareBudget: малым — целиком, большим — поровну остаток, порядок сохраняется", () => {
  assert.deepEqual(shareBudget([1000, 50_000, 200], 30_000), [1000, 28_800, 200]);
  assert.deepEqual(shareBudget([40_000, 40_000], 30_000), [15_000, 15_000]);
  assert.deepEqual(shareBudget([10, 20], 30_000), [10, 20]);
  assert.deepEqual(shareBudget([], 30_000), []);
  const three = shareBudget([20_000, 20_000, 20_000], 30_000);
  assert.ok(three.reduce((a, b) => a + b, 0) <= 30_000);
});
