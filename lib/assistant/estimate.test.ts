import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "./settings";
import { HISTORY_TOKENS } from "./context";
import { estimateTokens } from "./pricing";
import { systemPrompt } from "./prompt";
import { budgetEstimate, inputFactor, messageCostKopecks, questionUsage, REQUEST_PROFILE, weeklyMessages, worstCaseCostKopecks } from "./estimate";

const MODELS = { model: "google/gemini-3.5-flash-lite", strongModel: "anthropic/claude-sonnet-5" };
const RATE = 85;
const MARKUP = 1.25;
/** Явный набор для арифметики — чтобы проверки не менялись вместе с умолчаниями. */
const L45 = { dailyLimit: 15, weeklyLimit: 45, strongWeeklyLimit: 3 };

test("профиль: системный промпт не длиннее заложенного — сменил промпт, перемерь REQUEST_PROFILE", () => {
  assert.ok(estimateTokens(systemPrompt("М41О25")) <= REQUEST_PROFILE.system);
});

test("questionUsage: два круга с полным входом, во втором — вызов и результат инструмента", () => {
  // Вход круга: 470 + 500 + 790 + 4000 + 300 = 6060; второй: + 60 + 1143 (4000 символов результата).
  assert.equal(HISTORY_TOKENS, 4000);
  assert.equal(REQUEST_PROFILE.toolResult, 1143);
  assert.deepEqual(questionUsage("google/gemini-3.5-flash-lite", 500), { prompt: 13_323, completion: 560, cached: 0 });
  // Токенизатор Claude — +30 % входа: 13 323 × 1,3 = 17 319,9 → 17 320.
  assert.deepEqual(questionUsage("anthropic/claude-sonnet-5", 1000), { prompt: 17_320, completion: 1060, cached: 0 });
});

test("inputFactor: Gemini — как есть, Claude и незнакомая модель — +30 %", () => {
  assert.equal(inputFactor("google/gemini-3.5-flash-lite"), 1);
  assert.equal(inputFactor("anthropic/claude-haiku-4.5"), 1.3);
  assert.equal(inputFactor("vendor/new-model"), 1.3);
});

test("messageCostKopecks: вопрос с поиском по данным ≈ 0,58 ₽ на Flash-Lite, сильный ≈ 4,81 ₽ на Sonnet 5", () => {
  // Flash-Lite: (13 323 × 0,30 + 560 × 2,50) / 1M = $0,0053969 × 85 × 1,25 = 57,3 коп. → 58
  // Sonnet 5:   (17 320 × 2 + 1060 × 10) / 1M = $0,04524 × 85 × 1,25 = 480,7 коп. → 481
  assert.deepEqual(messageCostKopecks(MODELS, RATE, MARKUP), { normal: 58, strong: 481 });
});

test("weeklyMessages: недельный лимит, но не больше семи дневных; сильные — внутри общего числа", () => {
  assert.deepEqual(weeklyMessages({ dailyLimit: 15, weeklyLimit: 50, strongWeeklyLimit: 4 }), { total: 50, strong: 4 });
  assert.deepEqual(weeklyMessages({ dailyLimit: 5, weeklyLimit: 50, strongWeeklyLimit: 4 }), { total: 35, strong: 4 });
  assert.deepEqual(weeklyMessages({ dailyLimit: 1, weeklyLimit: 10, strongWeeklyLimit: 10 }), { total: 7, strong: 7 });
});

test("budgetEstimate: 200 ₽ — ресурс 80 ₽, это 137 вопросов с поиском или 16 сильных", () => {
  const e = budgetEstimate({ ...L45, priceRub: 200 }, MODELS, RATE, MARKUP);
  assert.equal(e.budgetKopecks, 8000);
  assert.equal(e.marginFloorPct, 60);
  assert.deepEqual(e.perMessage, { normal: 58, strong: 481 });
  assert.equal(e.questions, 137); // 8000 / 58 = 137,9
  assert.equal(e.strongQuestions, 16); // 8000 / 481 = 16,6
  // Лимиты 15/45/3 пропускают больше, чем помещается в ресурс: при вопросах с поиском первым кончится ресурс.
  assert.equal(e.limitMessages, 192); // 45 × 30/7 = 192,9
  assert.equal(e.limitStrong, 12); // 3 × 30/7 = 12,9
});

test("budgetEstimate: ресурс растёт с ценой, число вопросов — вместе с ним", () => {
  const e = budgetEstimate({ ...L45, priceRub: 300 }, MODELS, RATE, MARKUP);
  assert.equal(e.budgetKopecks, 12_000);
  assert.equal(e.questions, 206); // 12 000 / 58 = 206,9
  assert.equal(e.strongQuestions, 24); // 12 000 / 481 = 24,9
});

test("budgetEstimate: бесплатно — ресурса нет, потолок расхода задают только лимиты", () => {
  const e = budgetEstimate({ ...L45, priceRub: 0 }, MODELS, RATE, MARKUP);
  assert.equal(e.budgetKopecks, null);
  assert.equal(e.questions, null);
  assert.equal(e.strongQuestions, null);
  // Неделя: 42 × 58 + 3 × 481 = 3879 коп.; × 30/7 = 16 624,3 → 16 625
  assert.equal(e.worstCaseKopecks, 16_625);
  assert.equal(worstCaseCostKopecks(L45, MODELS, RATE, MARKUP), 16_625);
});

test("незнакомая модель считается по самой дорогой и с токенизатором Claude — оценка не оптимистичнее", () => {
  const unknown = messageCostKopecks({ model: "vendor/new-model", strongModel: "vendor/new-model" }, RATE, MARKUP);
  // Цена Sonnet 5, вход × 1,3, ответ обычного — 500 токенов: (17 320 × 2 + 560 × 10) / 1M × 106,25 = 427,5 → 428
  assert.deepEqual(unknown, { normal: 428, strong: 481 });
});

test("умолчания: ресурс 40 % цены — маржа не ниже 60 %, и в него помещается осмысленное число вопросов", () => {
  // Маржу гарантирует потолок ресурса (limits.ts), а не лимиты сообщений. Здесь проверяем, что при умолчаниях
  // цены и моделей ресурс — это не десяток вопросов в месяц: если он окажется меньше ~4 в день, умолчания плохие.
  const e = budgetEstimate(DEFAULT_SETTINGS, MODELS, RATE, MARKUP);
  assert.equal(e.marginFloorPct, 60);
  assert.ok(e.budgetKopecks !== null && e.budgetKopecks <= DEFAULT_SETTINGS.priceRub * 100 * 0.4);
  assert.ok(e.questions !== null && e.questions >= 120, `вопросов в ресурс: ${e.questions}`);
});
