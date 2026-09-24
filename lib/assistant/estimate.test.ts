import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "./settings";
import { messageCostKopecks, weeklyMessages, worstCaseCostKopecks, worstCaseEstimate } from "./estimate";

const MODELS = { model: "google/gemini-3.5-flash-lite", strongModel: "anthropic/claude-sonnet-5" };
const RATE = 85;
const MARKUP = 1.25;
/** Явный набор для арифметики — чтобы проверки не менялись вместе с умолчаниями. */
const L50 = { dailyLimit: 15, weeklyLimit: 50, strongWeeklyLimit: 4 };

test("messageCostKopecks: профиль §1 — ≈0,30 ₽ на Flash-Lite и ≈1,6 ₽ на Sonnet 5", () => {
  // Flash-Lite: (5000 × 0,30 + 500 × 2,50) / 1M = $0,00275 × 85 × 1,25 = 29,2 коп. → 30
  // Sonnet 5:   (5000 × 2 + 500 × 10) / 1M = $0,015 × 85 × 1,25 = 159,4 коп. → 160
  assert.deepEqual(messageCostKopecks(MODELS, RATE, MARKUP), { normal: 30, strong: 160 });
});

test("weeklyMessages: недельный лимит, но не больше семи дневных; сильные — внутри общего числа", () => {
  assert.deepEqual(weeklyMessages({ dailyLimit: 15, weeklyLimit: 50, strongWeeklyLimit: 4 }), { total: 50, strong: 4 });
  assert.deepEqual(weeklyMessages({ dailyLimit: 5, weeklyLimit: 50, strongWeeklyLimit: 4 }), { total: 35, strong: 4 });
  assert.deepEqual(weeklyMessages({ dailyLimit: 1, weeklyLimit: 10, strongWeeklyLimit: 10 }), { total: 7, strong: 7 });
});

test("worstCaseCostKopecks: 15/50/4 — 46 обычных и 4 сильных в неделю, на 30 дней ≈ 86,58 ₽", () => {
  // Неделя: 46 × 30 + 4 × 160 = 2020 коп.; × 30/7 = 8657,14 → 8658
  assert.equal(worstCaseCostKopecks(L50, MODELS, RATE, MARKUP), 8658);
});

test("worstCaseCostKopecks: сильные дороже — рост их лимита растит расход, дневной лимит режет неделю", () => {
  const base = worstCaseCostKopecks(L50, MODELS, RATE, MARKUP);
  assert.ok(worstCaseCostKopecks({ ...L50, strongWeeklyLimit: 10 }, MODELS, RATE, MARKUP) > base);
  // 35 в неделю (5 × 7): 31 × 30 + 4 × 160 = 1570; × 30/7 = 6728,57 → 6729
  assert.equal(worstCaseCostKopecks({ ...L50, dailyLimit: 5 }, MODELS, RATE, MARKUP), 6729);
});

test("worstCaseCostKopecks: незнакомая модель считается по самой дорогой — оценка не оптимистичнее", () => {
  const unknown = worstCaseCostKopecks(L50, { model: "vendor/new-model", strongModel: "vendor/new-model" }, RATE, MARKUP);
  // Все 50 сообщений по 160 коп.: 8000 × 30/7 = 34 285,7 → 34 286
  assert.equal(unknown, 34_286);
});

test("worstCaseEstimate: 200 ₽ при 15/50/4 — маржа 57 %, warn (поэтому умолчания 45/3)", () => {
  const e = worstCaseEstimate({ ...L50, priceRub: 200 }, MODELS, RATE, MARKUP);
  assert.equal(e.costKopecks, 8658);
  assert.equal(e.marginPct, 57); // (20 000 − 8658) / 20 000 = 56,7 %
  assert.equal(e.tone, "warn");
  assert.equal(e.messages, 214); // 50 × 30/7 = 214,3
  assert.equal(e.strongMessages, 17); // 4 × 30/7 = 17,1
  assert.deepEqual(e.perMessage, { normal: 30, strong: 160 });
});

test("worstCaseEstimate: 250 ₽ даёт запас — маржа 65 %, ok", () => {
  const e = worstCaseEstimate({ ...L50, priceRub: 250 }, MODELS, RATE, MARKUP);
  assert.equal(e.marginPct, 65); // (25 000 − 8658) / 25 000 = 65,4 %
  assert.equal(e.tone, "ok");
});

test("worstCaseEstimate: дёшево и щедро — danger; бесплатно — маржи нет, warn", () => {
  assert.equal(worstCaseEstimate({ ...L50, priceRub: 100 }, MODELS, RATE, MARKUP).tone, "danger"); // 13 %
  const free = worstCaseEstimate({ ...L50, priceRub: 0 }, MODELS, RATE, MARKUP);
  assert.equal(free.marginPct, null);
  assert.equal(free.tone, "warn");
});

test("умолчания: при их цене и лимитах маржа в худшем случае не ниже 60 % — требование владельца", () => {
  // Курс и наценка — умолчания env (lib/env.ts): 85 ₽/$ и +25 % Polza. Сменил цену или лимиты — этот тест скажет,
  // не упала ли маржа ниже обещанной.
  const r = worstCaseEstimate(DEFAULT_SETTINGS, MODELS, 85, 1.25);
  assert.ok(r.marginPct !== null && r.marginPct >= 60, `маржа ${r.marginPct} %`);
});
