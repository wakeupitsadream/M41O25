import { test } from "node:test";
import assert from "node:assert/strict";
import { MARGIN_OK_PCT, MARGIN_WARN_PCT, marginTone, monthSummary } from "./finance";

test("monthSummary: выручка, расход в рублях с копейками и маржа", () => {
  const s = monthSummary({ revenueRub: 4000, costKopecks: 89_040, messages: 320, activeUsers: 20 });
  assert.equal(s.revenueRub, 4000);
  assert.equal(s.costRub, 890.4);
  assert.equal(s.marginPct, 78); // (4000 − 890,4) / 4000 = 77,74 %
  assert.equal(s.tone, "ok");
  assert.equal(s.messages, 320);
  assert.equal(s.activeUsers, 20);
});

test("monthSummary: пороги — ≥ 60 ok, 40–60 warn, < 40 danger", () => {
  assert.equal(monthSummary({ revenueRub: 100, costKopecks: 4000, messages: 0, activeUsers: 0 }).tone, "ok"); // 60 %
  assert.equal(monthSummary({ revenueRub: 100, costKopecks: 4100, messages: 0, activeUsers: 0 }).tone, "warn"); // 59 %
  assert.equal(monthSummary({ revenueRub: 100, costKopecks: 6000, messages: 0, activeUsers: 0 }).tone, "warn"); // 40 %
  assert.equal(monthSummary({ revenueRub: 100, costKopecks: 6100, messages: 0, activeUsers: 0 }).tone, "danger"); // 39 %
  assert.equal(MARGIN_OK_PCT, 60);
  assert.equal(MARGIN_WARN_PCT, 40);
});

test("monthSummary: цвет совпадает с показанной цифрой — 59,6 % округляется до 60 и это ok", () => {
  const s = monthSummary({ revenueRub: 1000, costKopecks: 40_400, messages: 1, activeUsers: 1 });
  assert.equal(s.marginPct, 60);
  assert.equal(s.tone, "ok");
});

test("monthSummary: расход больше выручки — отрицательная маржа, danger", () => {
  const s = monthSummary({ revenueRub: 200, costKopecks: 30_000, messages: 1, activeUsers: 1 });
  assert.equal(s.marginPct, -50);
  assert.equal(s.tone, "danger");
});

test("monthSummary: без выручки маржи нет — расход даёт warn (пробная неделя), нули — ok", () => {
  const trial = monthSummary({ revenueRub: 0, costKopecks: 12_300, messages: 40, activeUsers: 9 });
  assert.equal(trial.marginPct, null);
  assert.equal(trial.tone, "warn");
  assert.equal(trial.costRub, 123);
  const empty = monthSummary({ revenueRub: 0, costKopecks: 0, messages: 0, activeUsers: 0 });
  assert.equal(empty.marginPct, null);
  assert.equal(empty.tone, "ok");
});

test("marginTone: границы включительно", () => {
  assert.equal(marginTone(100), "ok");
  assert.equal(marginTone(60), "ok");
  assert.equal(marginTone(59), "warn");
  assert.equal(marginTone(40), "warn");
  assert.equal(marginTone(39), "danger");
  assert.equal(marginTone(-10), "danger");
});
