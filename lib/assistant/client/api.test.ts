import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAssistantState, parseConversation } from "./api";

const CID = "11111111-1111-4111-8111-111111111111";
const AT = "2026-09-24T10:00:00.000Z";
const LIMITS = {
  day: { used: 1, limit: 15 },
  week: { used: 1, limit: 45 },
  strong: { used: 0, limit: 3 },
  budget: { used: 120, limit: 8000 },
  resetsDay: "2026-09-25",
  resetsWeek: "2026-09-28",
};

const conversation = { id: CID, title: "Матан", createdAt: AT, updatedAt: AT, archivedAt: null };
const message = (over: Record<string, unknown> = {}) => ({ id: "m1", role: "user", content: "вопрос", attachments: [], strong: false, status: "done", createdAt: AT, ...over });

test("parseConversation: тело GET /api/assistant/conversations/[id]", () => {
  const photo = { id: "f", name: "p.jpg", mime: "image/jpeg", url: "/api/files/f" };
  const got = parseConversation({ conversation, messages: [message({ attachments: [photo] }), message({ id: "m2", role: "assistant", status: "aborted", content: "" })] });
  assert.ok(got);
  assert.equal(got.conversation.id, CID);
  assert.equal(got.messages.length, 2);
  assert.deepEqual(got.messages[0].attachments, [photo]);
  assert.equal(got.messages[1].status, "aborted");
});

test("parseConversation: HTML страницы ошибки, чужая форма и битое сообщение — null", () => {
  assert.equal(parseConversation(null), null);
  assert.equal(parseConversation({ ok: true, data: { conversation, messages: [] } }), null, "не ActionResult, а голое тело");
  assert.equal(parseConversation({ conversation, messages: [message({ role: "system" })] }), null);
  assert.equal(parseConversation({ conversation, messages: [message({ status: "streaming" })] }), null);
  assert.equal(parseConversation({ conversation, messages: [message({ attachments: [{ id: 1 }] })] }), null);
  assert.equal(parseConversation({ conversation: { id: CID }, messages: [] }), null);
});

test("parseAssistantState: остатки и доступ; ресурс необязателен", () => {
  const got = parseAssistantState({ enabled: true, access: { kind: "trial", until: "2026-09-30" }, limits: LIMITS, settings: { priceRub: 200, paymentNote: "", trialDays: 7 }, strongAvailable: true });
  assert.ok(got);
  assert.deepEqual(got.limits, LIMITS);
  assert.equal(got.strongAvailable, true);
  const old: Record<string, unknown> = { ...LIMITS };
  delete old.budget;
  assert.equal(parseAssistantState({ access: { kind: "paid", until: "2026-10-30" }, limits: old })?.limits.budget, null);
  assert.equal(parseAssistantState({ access: { kind: "paid" }, limits: LIMITS }), null);
  assert.equal(parseAssistantState({ access: { kind: "none" }, limits: { day: 1 } }), null);
});
