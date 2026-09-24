import { test } from "node:test";
import assert from "node:assert/strict";
import { accessBadge, accessLine, fmtUntil } from "./admin-labels";

const TODAY = "2026-09-24";

test("fmtUntil: день.месяц, год — только если не текущий", () => {
  assert.equal(fmtUntil("2026-10-24", TODAY), "24.10");
  assert.equal(fmtUntil("2027-01-15", TODAY), "15.01.27");
  assert.equal(fmtUntil("2025-12-31", TODAY), "31.12.25");
});

test("accessLine: все четыре состояния", () => {
  assert.equal(accessLine({ kind: "none" }, TODAY), "не начинал");
  assert.equal(accessLine({ kind: "trial", until: "2026-09-30" }, TODAY), "пробный до 30.09");
  assert.equal(accessLine({ kind: "paid", until: "2026-10-24" }, TODAY), "оплачено до 24.10");
  assert.equal(accessLine({ kind: "expired", since: "2026-09-20" }, TODAY), "не оплачено (истекло 20.09)");
  assert.equal(accessLine({ kind: "expired", since: null }, TODAY), "не оплачено");
});

test("accessBadge: только при живом доступе; оплата — ok, проба — нейтральная и подписана словом", () => {
  assert.deepEqual(accessBadge({ kind: "paid", until: "2026-10-24" }, TODAY), { tone: "ok", text: "ИИ до 24.10" });
  assert.deepEqual(accessBadge({ kind: "trial", until: "2026-09-30" }, TODAY), { tone: "neutral", text: "ИИ проба до 30.09" });
  assert.equal(accessBadge({ kind: "none" }, TODAY), null);
  assert.equal(accessBadge({ kind: "expired", since: "2026-09-20" }, TODAY), null);
});
