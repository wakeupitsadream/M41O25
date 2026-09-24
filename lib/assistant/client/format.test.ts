import { test } from "node:test";
import assert from "node:assert/strict";
import { accessHint, conversationDate, ddmm, toolLabel } from "./format";

const TZ = "Asia/Yekaterinburg";
const settings = { priceRub: 200, paymentNote: "", trialDays: 7 };

test("ddmm: день и месяц с ведущими нулями, не-дата как есть", () => {
  assert.equal(ddmm("2026-09-30"), "30.09");
  assert.equal(ddmm("2026-01-05"), "05.01");
  assert.equal(ddmm("завтра"), "завтра");
});

test("accessHint: подсказка на плитке по каждому состоянию", () => {
  assert.equal(accessHint({ access: { kind: "none" }, settings }), "7 дней бесплатно");
  assert.equal(accessHint({ access: { kind: "none" }, settings: { ...settings, trialDays: 3 } }), "3 дня бесплатно");
  assert.equal(accessHint({ access: { kind: "none" }, settings: { ...settings, trialDays: 0 } }), "200 ₽ в месяц", "без триала — сразу цена");
  assert.equal(accessHint({ access: { kind: "trial", until: "2026-09-30" }, settings }), "пробная до 30.09");
  assert.equal(accessHint({ access: { kind: "paid", until: "2026-10-24" }, settings }), "оплачено до 24.10");
  assert.equal(accessHint({ access: { kind: "expired", since: "2026-09-20" }, settings: { ...settings, priceRub: 250 } }), "250 ₽ в месяц");
});

test("toolLabel: известные инструменты по-русски, незнакомый — общая фраза", () => {
  assert.equal(toolLabel("get_schedule"), "читаю расписание…");
  assert.equal(toolLabel("get_homework"), "читаю домашку…");
  assert.equal(toolLabel("get_news"), "читаю новости…");
  assert.equal(toolLabel("get_something_new"), "читаю данные группы…");
});

test("conversationDate: сегодня — время в поясе группы, вчера, этот год, прошлые годы", () => {
  // 18:30 UTC 23.09 — уже 23:30 в Екатеринбурге, те же сутки; 19:30 UTC — 00:30 следующих суток.
  assert.equal(conversationDate("2026-09-24T04:05:00.000Z", "2026-09-24", TZ), "09:05");
  assert.equal(conversationDate("2026-09-23T19:30:00.000Z", "2026-09-24", TZ), "00:30", "полночь по Екатеринбургу — уже сегодня");
  assert.equal(conversationDate("2026-09-23T18:30:00.000Z", "2026-09-24", TZ), "вчера");
  assert.equal(conversationDate("2026-09-12T08:00:00.000Z", "2026-09-24", TZ), "12 сент");
  assert.equal(conversationDate("2026-01-02T08:00:00.000Z", "2026-09-24", TZ), "2 янв");
  assert.equal(conversationDate("2025-12-31T08:00:00.000Z", "2026-01-02", TZ), "31.12.2025");
  assert.equal(conversationDate("не дата", "2026-09-24", TZ), "");
});
