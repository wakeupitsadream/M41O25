import { test } from "node:test";
import assert from "node:assert/strict";
import { FALLBACK_PRICE_MODEL, PRICES_USD_PER_MTOK, costKopecks, estimateTokens, priceFor } from "./pricing";

const RATE = 84.24;
const MARKUP = 1.25;

test("PRICES_USD_PER_MTOK: четыре модели из §1, у Claude кеш 0,1 × input", () => {
  assert.deepEqual(PRICES_USD_PER_MTOK["google/gemini-3.5-flash-lite"], { input: 0.3, output: 2.5 });
  assert.deepEqual(PRICES_USD_PER_MTOK["google/gemini-3.5-flash"], { input: 1.5, output: 9 });
  assert.deepEqual(PRICES_USD_PER_MTOK["anthropic/claude-haiku-4.5"], { input: 1, output: 5, cachedInput: 0.1 });
  assert.deepEqual(PRICES_USD_PER_MTOK["anthropic/claude-sonnet-5"], { input: 2, output: 10, cachedInput: 0.2 });
  for (const [model, p] of Object.entries(PRICES_USD_PER_MTOK)) {
    if (p.cachedInput !== undefined) assert.ok(Math.abs(p.cachedInput - p.input * 0.1) < 1e-9, model);
  }
});

test("costKopecks: Flash-Lite, профиль сообщения из §1 — около 30 копеек", () => {
  // (5000 × 0,3 + 500 × 2,5) / 1e6 $ = 0,00275 $ → × 84,24 × 1,25 = 0,289575 ₽ → 28,96 коп → 29
  assert.equal(costKopecks("google/gemini-3.5-flash-lite", { prompt: 5000, completion: 500, cached: 0 }, RATE, MARKUP), 29);
});

test("costKopecks: Sonnet 5 тот же профиль — около 1,6 ₽", () => {
  // (5000 × 2 + 500 × 10) / 1e6 = 0,015 $ → 1,5795 ₽ → 157,95 коп → 158
  assert.equal(costKopecks("anthropic/claude-sonnet-5", { prompt: 5000, completion: 500, cached: 0 }, RATE, MARKUP), 158);
});

test("costKopecks: закешированный вход у Claude стоит 0,1 от обычного и вычитается из prompt, а не прибавляется", () => {
  const plain = costKopecks("anthropic/claude-sonnet-5", { prompt: 1000, completion: 0, cached: 0 }, 100, 1);
  const cached = costKopecks("anthropic/claude-sonnet-5", { prompt: 1000, completion: 0, cached: 1000 }, 100, 1);
  assert.equal(plain, 20); // 1000 × 2 / 1e6 × 100 ₽ = 0,2 ₽
  assert.equal(cached, 2); // 1000 × 0,2 / 1e6 × 100 ₽ = 0,02 ₽
  const half = costKopecks("anthropic/claude-sonnet-5", { prompt: 1000, completion: 0, cached: 500 }, 100, 1);
  assert.equal(half, 11); // 500 × 2 + 500 × 0,2 = 1100 → 0,0011 $ → 0,11 ₽
});

test("costKopecks: у Gemini скидки за кеш нет — cached считается по цене входа", () => {
  const plain = costKopecks("google/gemini-3.5-flash", { prompt: 1000, completion: 0, cached: 0 }, 100, 1);
  const cached = costKopecks("google/gemini-3.5-flash", { prompt: 1000, completion: 0, cached: 1000 }, 100, 1);
  assert.equal(plain, cached);
});

test("costKopecks: неизвестная модель — консервативно по цене Sonnet 5", () => {
  const usage = { prompt: 5000, completion: 500, cached: 0 };
  assert.equal(FALLBACK_PRICE_MODEL, "anthropic/claude-sonnet-5");
  assert.equal(costKopecks("openai/gpt-7-mini", usage, RATE, MARKUP), costKopecks("anthropic/claude-sonnet-5", usage, RATE, MARKUP));
  assert.deepEqual(priceFor("что-то"), PRICES_USD_PER_MTOK["anthropic/claude-sonnet-5"]);
});

test("costKopecks: копейки округляются вверх, но ровная сумма не растёт, а ноль остаётся нулём", () => {
  // 1 токен вывода Flash-Lite: 2,5e-6 $ → 0,00026 ₽ → 0,026 коп → 1 копейка
  assert.equal(costKopecks("google/gemini-3.5-flash-lite", { prompt: 0, completion: 1, cached: 0 }, RATE, MARKUP), 1);
  // 500 000 входных токенов Sonnet по 100 ₽/$ без наценки = ровно 1 $ = 10 000 коп
  assert.equal(costKopecks("anthropic/claude-sonnet-5", { prompt: 500_000, completion: 0, cached: 0 }, 100, 1), 10_000);
  assert.equal(costKopecks("anthropic/claude-sonnet-5", { prompt: 0, completion: 0, cached: 0 }, RATE, MARKUP), 0);
});

test("costKopecks: наценка и курс — множители", () => {
  const base = costKopecks("anthropic/claude-sonnet-5", { prompt: 100_000, completion: 0, cached: 0 }, 100, 1); // 0,2 $ → 20 ₽ → 2000
  assert.equal(base, 2000);
  assert.equal(costKopecks("anthropic/claude-sonnet-5", { prompt: 100_000, completion: 0, cached: 0 }, 100, 1.25), 2500);
  assert.equal(costKopecks("anthropic/claude-sonnet-5", { prompt: 100_000, completion: 0, cached: 0 }, 50, 1), 1000);
});

test("costKopecks: cached больше prompt (кривой usage) не даёт отрицательной стоимости", () => {
  const c = costKopecks("anthropic/claude-sonnet-5", { prompt: 100, completion: 0, cached: 1000 }, 100, 1);
  assert.ok(c >= 0);
  assert.equal(c, costKopecks("anthropic/claude-sonnet-5", { prompt: 100, completion: 0, cached: 100 }, 100, 1));
});

test("estimateTokens: ~3,5 символа на токен, вверх", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("абв"), 1);
  assert.equal(estimateTokens("абвгдеё"), 2);
  assert.equal(estimateTokens("x".repeat(350)), 100);
  assert.equal(estimateTokens("x".repeat(351)), 101);
});
