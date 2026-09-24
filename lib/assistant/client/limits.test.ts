import { test } from "node:test";
import assert from "node:assert/strict";
import { canSend, NEXT_MESSAGE_KOPECKS as SERVER_RESERVE } from "../limits";
import type { LimitsView } from "../types";
import { blockReason, budgetMeter, limitCopy, NEXT_MESSAGE_KOPECKS } from "./limits";

const view = (over: Partial<LimitsView> = {}): LimitsView => ({
  day: { used: 3, limit: 15 },
  week: { used: 10, limit: 45 },
  strong: { used: 1, limit: 3 },
  budget: { used: 1000, limit: 8000 },
  resetsDay: "2026-09-25",
  resetsWeek: "2026-09-28",
  ...over,
});

test("клиентский запас на ответ совпадает с серверным", () => {
  assert.deepEqual(NEXT_MESSAGE_KOPECKS, SERVER_RESERVE);
});

test("blockReason повторяет canSend сервера на сетке состояний", () => {
  const counts = [
    [0, 15],
    [15, 15],
  ] as const;
  const budgets = [null, { used: 0, limit: 8000 }, { used: 7950, limit: 8000 }, { used: 7700, limit: 8000 }, { used: 9000, limit: 8000 }];
  for (const [dayUsed, dayLimit] of counts)
    for (const [weekUsed, weekLimit] of [
      [10, 45],
      [45, 45],
    ])
      for (const strongUsed of [0, 3])
        for (const budget of budgets)
          for (const strong of [false, true]) {
            const v = view({ day: { used: dayUsed, limit: dayLimit }, week: { used: weekUsed, limit: weekLimit }, strong: { used: strongUsed, limit: 3 }, budget });
            const server = canSend(v, strong);
            assert.equal(blockReason(v, strong), server.ok ? null : server.reason, JSON.stringify({ v, strong }));
          }
});

test("budgetMeter: процент, «<1 %» и «исчерпан» по запасу, а не по 100 %", () => {
  assert.deepEqual(budgetMeter({ used: 2960, limit: 8000 }), { pct: 37, exhausted: false, text: "37 %" });
  assert.deepEqual(budgetMeter({ used: 0, limit: 8000 }), { pct: 0, exhausted: false, text: "0 %" });
  assert.equal(budgetMeter({ used: 3, limit: 8000 }).text, "<1 %");
  // 99,4 %: до потолка 50 копеек, а обычный ответ требует запаса 60 — сервер уже не пустит.
  assert.deepEqual(budgetMeter({ used: 7950, limit: 8000 }), { pct: 100, exhausted: true, text: "исчерпан" });
  assert.equal(budgetMeter({ used: 9000, limit: 8000 }).exhausted, true, "последний ответ мог перелезть через потолок");
  assert.equal(budgetMeter({ used: 0, limit: 0 }).exhausted, true, "пустой потолок — ресурса нет");
});

test("limitCopy: ресурс — своя карточка; на сильный не хватает, а на обычный хватает — так и говорим", () => {
  const out = limitCopy("budget", "текст сервера", view({ budget: { used: 7950, limit: 8000 } }), false);
  assert.equal(out.title, "Ресурс на 30 дней исчерпан");
  assert.match(out.message, /Документы и сильный режим тратят ресурс быстрее/);
  const strongOnly = limitCopy("budget", "текст сервера", view({ budget: { used: 7700, limit: 8000 } }), true);
  assert.equal(strongOnly.title, "На сильный ответ ресурса не хватает");
  assert.deepEqual(limitCopy("day", "Лимит на сегодня исчерпан — обновится в полночь", null, false), {
    title: "Лимит исчерпан",
    message: "Лимит на сегодня исчерпан — обновится в полночь",
  });
});
