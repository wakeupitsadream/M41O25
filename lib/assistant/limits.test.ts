import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMIT_MESSAGES, canSend, limitsView } from "./limits";
import { DEFAULT_SETTINGS } from "./settings";
import type { LimitsView } from "./types";

// Среда 23.09.2026, понедельник той же недели — 21.09.
const TODAY = "2026-09-23";
const MONDAY = "2026-09-21";

test("limitsView: остатки из счётчиков и лимиты из настроек", () => {
  const v = limitsView(DEFAULT_SETTINGS, { day: 9, weekTotal: 31, strongWeek: 3 }, TODAY, MONDAY);
  assert.deepEqual(v.day, { used: 9, limit: 15 });
  assert.deepEqual(v.week, { used: 31, limit: 50 });
  assert.deepEqual(v.strong, { used: 3, limit: 4 });
});

test("limitsView: сбросы — завтра в полночь и следующий понедельник", () => {
  const v = limitsView(DEFAULT_SETTINGS, { day: 0, weekTotal: 0, strongWeek: 0 }, TODAY, MONDAY);
  assert.equal(v.resetsDay, "2026-09-24");
  assert.equal(v.resetsWeek, "2026-09-28");
  // Воскресенье: день сбрасывается в тот же момент, что и неделя.
  const sun = limitsView(DEFAULT_SETTINGS, { day: 0, weekTotal: 0, strongWeek: 0 }, "2026-09-27", MONDAY);
  assert.equal(sun.resetsDay, "2026-09-28");
  assert.equal(sun.resetsWeek, "2026-09-28");
});

const view = (day: number, week: number, strong: number): LimitsView => ({
  day: { used: day, limit: 15 },
  week: { used: week, limit: 50 },
  strong: { used: strong, limit: 4 },
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
  assert.deepEqual(Object.keys(LIMIT_MESSAGES).sort(), ["day", "strong", "week"]);
});
