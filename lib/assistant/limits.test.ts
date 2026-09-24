import { test } from "node:test";
import assert from "node:assert/strict";
import { BUDGET_WINDOW_DAYS, COST_SHARE, LIMIT_MESSAGES, NEXT_MESSAGE_KOPECKS, budgetKopecks, canSend, limitsView } from "./limits";
import { DEFAULT_SETTINGS } from "./settings";
import type { LimitsView } from "./types";

// Среда 23.09.2026, понедельник той же недели — 21.09.
const TODAY = "2026-09-23";
const MONDAY = "2026-09-21";

test("limitsView: остатки из счётчиков и лимиты из настроек", () => {
  const v = limitsView(DEFAULT_SETTINGS, { day: 9, weekTotal: 31, strongWeek: 3, costKopecks30d: 2150 }, TODAY, MONDAY, 8000);
  assert.deepEqual(v.day, { used: 9, limit: 15 });
  assert.deepEqual(v.week, { used: 31, limit: 45 });
  assert.deepEqual(v.strong, { used: 3, limit: 3 });
  assert.deepEqual(v.budget, { used: 2150, limit: 8000 });
  // Цена 0 — потолка ресурса нет, полоски тоже.
  assert.equal(limitsView(DEFAULT_SETTINGS, { day: 0, weekTotal: 0, strongWeek: 0, costKopecks30d: 0 }, TODAY, MONDAY, null).budget, null);
});

test("limitsView: сбросы — завтра в полночь и следующий понедельник", () => {
  const v = limitsView(DEFAULT_SETTINGS, { day: 0, weekTotal: 0, strongWeek: 0, costKopecks30d: 0 }, TODAY, MONDAY, 8000);
  assert.equal(v.resetsDay, "2026-09-24");
  assert.equal(v.resetsWeek, "2026-09-28");
  // Воскресенье: день сбрасывается в тот же момент, что и неделя.
  const sun = limitsView(DEFAULT_SETTINGS, { day: 0, weekTotal: 0, strongWeek: 0, costKopecks30d: 0 }, "2026-09-27", MONDAY, 8000);
  assert.equal(sun.resetsDay, "2026-09-28");
  assert.equal(sun.resetsWeek, "2026-09-28");
});

const view = (day: number, week: number, strong: number, spent = 0): LimitsView => ({
  day: { used: day, limit: 15 },
  week: { used: week, limit: 50 },
  strong: { used: strong, limit: 4 },
  budget: { used: spent, limit: 8000 },
  resetsDay: "2026-09-24",
  resetsWeek: "2026-09-28",
});

test("canSend: в пределах лимитов — ok, и обычное, и сильное", () => {
  assert.deepEqual(canSend(view(14, 49, 3), false), { ok: true });
  assert.deepEqual(canSend(view(14, 49, 3), true), { ok: true });
  assert.deepEqual(canSend(view(0, 0, 0), true), { ok: true });
});

test("canSend: день исчерпан — текст про полночь", () => {
  assert.deepEqual(canSend(view(15, 20, 0), false), { ok: false, reason: "day", message: "Лимит на сегодня исчерпан — обновится в полночь" });
});

test("canSend: неделя исчерпана — текст про понедельник", () => {
  assert.deepEqual(canSend(view(3, 50, 0), false), { ok: false, reason: "week", message: "На этой неделе всё — обновится в понедельник" });
});

test("canSend: сильные кончились — блокирует только сильное, обычное проходит", () => {
  assert.deepEqual(canSend(view(3, 20, 4), true), { ok: false, reason: "strong", message: "Сильных ответов на неделю больше нет" });
  assert.deepEqual(canSend(view(3, 20, 4), false), { ok: true });
});

test("canSend: сильное расходует оба счётчика — при исчерпанном дне причина «день», а не «сильные»", () => {
  const r = canSend(view(15, 20, 4), true);
  assert.ok(!r.ok && r.reason === "day");
  const w = canSend(view(3, 50, 4), true);
  assert.ok(!w.ok && w.reason === "week");
});

test("canSend: перебор сверх лимита (гонка) тоже блокируется", () => {
  assert.equal(canSend(view(16, 20, 0), false).ok, false);
  assert.equal(canSend(view(3, 51, 0), false).ok, false);
});

test("LIMIT_MESSAGES: по тексту на каждую причину", () => {
  assert.deepEqual(Object.keys(LIMIT_MESSAGES).sort(), ["budget", "day", "strong", "week"]);
});

test("budgetKopecks: оплата — 40 % цены, то есть маржа не ниже 60 % по построению", () => {
  const s = { priceRub: 200, trialDays: 7 };
  assert.equal(budgetKopecks(s, { kind: "paid", until: "2026-10-24" }), 8000);
  assert.equal(COST_SHARE, 0.4);
  // Инвариант владельца: себестоимость одного человека за окно не больше 40 % его платы.
  for (const price of [1, 99, 150, 200, 249, 500, 5000]) {
    const b = budgetKopecks({ priceRub: price, trialDays: 7 }, { kind: "paid", until: "2026-10-24" })!;
    assert.ok(b <= Math.ceil(price * 100 * 0.4), `цена ${price}: потолок ${b}`);
  }
});

test("budgetKopecks: пробная неделя — пропорционально дням; без доступа — 0; цена 0 — без потолка", () => {
  assert.equal(budgetKopecks({ priceRub: 200, trialDays: 7 }, { kind: "trial", until: "2026-09-29" }), Math.round((8000 * 7) / BUDGET_WINDOW_DAYS));
  assert.equal(budgetKopecks({ priceRub: 200, trialDays: 60 }, { kind: "trial", until: "2026-11-01" }), 8000);
  assert.equal(budgetKopecks({ priceRub: 200, trialDays: 7 }, { kind: "none" }), 0);
  assert.equal(budgetKopecks({ priceRub: 200, trialDays: 7 }, { kind: "expired", since: null }), 0);
  assert.equal(budgetKopecks({ priceRub: 0, trialDays: 7 }, { kind: "paid", until: "2026-10-24" }), null);
});

test("canSend: ресурс — нужен запас на следующее сообщение, сильному нужно больше", () => {
  const edge = 8000 - NEXT_MESSAGE_KOPECKS.normal;
  assert.deepEqual(canSend(view(1, 1, 0, edge), false), { ok: true });
  const r = canSend(view(1, 1, 0, edge + 1), false);
  assert.ok(!r.ok && r.reason === "budget");
  // На сильный не хватает — причина «ресурс», а обычный ещё проходит.
  const s = canSend(view(1, 1, 0, 8000 - NEXT_MESSAGE_KOPECKS.strong + 1), true);
  assert.ok(!s.ok && s.reason === "budget");
  assert.equal(canSend(view(1, 1, 0, 8000 - NEXT_MESSAGE_KOPECKS.strong + 1), false).ok, true);
  // Дневной лимит важнее ресурса в тексте отказа.
  const d = canSend(view(15, 1, 0, 9999), false);
  assert.ok(!d.ok && d.reason === "day");
  // Без потолка (цена 0) ресурс не проверяется.
  assert.equal(canSend({ ...view(1, 1, 0), budget: null }, true).ok, true);
});
