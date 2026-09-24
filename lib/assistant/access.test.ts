import { test } from "node:test";
import assert from "node:assert/strict";
import { accessStatus, extendPaidUntil, isAccessActive, trialUntil } from "./access";

const TODAY = "2026-09-23";

test("accessStatus: строки нет — none, триал ещё не начинался", () => {
  assert.deepEqual(accessStatus(TODAY, null), { kind: "none" });
  assert.equal(isAccessActive({ kind: "none" }), false);
});

test("accessStatus: триал активен, пока trialUntil >= сегодня; сегодня = until — ещё активен, завтра — expired", () => {
  assert.deepEqual(accessStatus(TODAY, { trialUntil: "2026-09-30", paidUntil: null }), { kind: "trial", until: "2026-09-30" });
  assert.deepEqual(accessStatus(TODAY, { trialUntil: TODAY, paidUntil: null }), { kind: "trial", until: TODAY });
  assert.deepEqual(accessStatus("2026-09-24", { trialUntil: TODAY, paidUntil: null }), { kind: "expired", since: TODAY });
});

test("accessStatus: оплата активна по paidUntil >= сегодня, границы такие же", () => {
  assert.deepEqual(accessStatus(TODAY, { trialUntil: null, paidUntil: "2026-10-23" }), { kind: "paid", until: "2026-10-23" });
  assert.deepEqual(accessStatus(TODAY, { trialUntil: null, paidUntil: TODAY }), { kind: "paid", until: TODAY });
  assert.deepEqual(accessStatus("2026-09-24", { trialUntil: null, paidUntil: TODAY }), { kind: "expired", since: TODAY });
});

test("accessStatus: активная оплата важнее активного триала", () => {
  assert.deepEqual(accessStatus(TODAY, { trialUntil: "2026-09-30", paidUntil: "2026-10-23" }), { kind: "paid", until: "2026-10-23" });
  // Оплата уже кончилась, а триал ещё идёт (админ проставил старую дату руками) — доступ по триалу.
  assert.deepEqual(accessStatus(TODAY, { trialUntil: "2026-09-30", paidUntil: "2026-09-01" }), { kind: "trial", until: "2026-09-30" });
});

test("accessStatus: всё истекло — expired с датой последнего окончания", () => {
  assert.deepEqual(accessStatus(TODAY, { trialUntil: "2026-09-01", paidUntil: "2026-09-15" }), { kind: "expired", since: "2026-09-15" });
  assert.deepEqual(accessStatus(TODAY, { trialUntil: "2026-09-20", paidUntil: "2026-09-15" }), { kind: "expired", since: "2026-09-20" });
  // Строка есть, дат нет (админ снял оплату у того, кто не брал триал): это не none — второго триала не будет.
  assert.deepEqual(accessStatus(TODAY, { trialUntil: null, paidUntil: null }), { kind: "expired", since: null });
});

test("isAccessActive: trial и paid активны, none и expired — нет", () => {
  assert.equal(isAccessActive({ kind: "trial", until: TODAY }), true);
  assert.equal(isAccessActive({ kind: "paid", until: TODAY }), true);
  assert.equal(isAccessActive({ kind: "expired", since: null }), false);
});

test("extendPaidUntil: paid_until в прошлом или пустой — считаем от сегодня", () => {
  assert.equal(extendPaidUntil(TODAY, null, 30), "2026-10-23");
  assert.equal(extendPaidUntil(TODAY, "2026-09-01", 30), "2026-10-23");
});

test("extendPaidUntil: paid_until в будущем — продлеваем от неё, оставшиеся дни не сгорают", () => {
  assert.equal(extendPaidUntil(TODAY, "2026-10-10", 30), "2026-11-09");
});

test("extendPaidUntil: paid_until = сегодня — от сегодня (последний оплаченный день не считается дважды)", () => {
  assert.equal(extendPaidUntil(TODAY, TODAY, 30), "2026-10-23");
});

test("extendPaidUntil: через границу года", () => {
  assert.equal(extendPaidUntil("2026-12-20", null, 30), "2027-01-19");
});

test("trialUntil: сегодня — первый день, «7 дней» заканчиваются на седьмой календарный день", () => {
  assert.equal(trialUntil(TODAY, 7), "2026-09-29");
  assert.equal(trialUntil("2026-09-28", 7), "2026-10-04");
  assert.equal(trialUntil(TODAY, 1), TODAY);
  // Семь дней ровно: от сегодня до until включительно — 7 календарных дат.
  const days = (a: string, b: string) => (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000 + 1;
  assert.equal(days(TODAY, trialUntil(TODAY, 7)), 7);
});
