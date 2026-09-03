import { test } from "node:test";
import assert from "node:assert/strict";
import { inviteCodesMatch, invitePrefix, normalizeInviteCode } from "./invite";

test("normalizeInviteCode: русская раскладка, дефисы и пробелы не мешают", () => {
  assert.equal(normalizeInviteCode("M41-O2025"), "M41O2025");
  assert.equal(normalizeInviteCode("м41-о2025"), "M41O2025");
  assert.equal(normalizeInviteCode(" М41 О2025 "), "M41O2025");
  assert.equal(normalizeInviteCode("м41о2025"), "M41O2025");
  assert.equal(normalizeInviteCode("З41-АВС"), "341ABC");
});

test("inviteCodesMatch: сохранённый и набранный сравниваются по канону", () => {
  assert.ok(inviteCodesMatch("M41-O2025", "м41о2025"));
  assert.ok(inviteCodesMatch("М41-XK7P-2ABC", "m41xk7p2abc"));
  assert.ok(!inviteCodesMatch("M41-O2025", "M41-O2026"));
});

test("invitePrefix: латиница из шифра группы", () => {
  assert.equal(invitePrefix("М41О25"), "M41");
  assert.equal(invitePrefix("ЭБ-21"), "21");
  assert.equal(invitePrefix("!!!"), "GRP");
});
