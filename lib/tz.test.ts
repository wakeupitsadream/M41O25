import { test } from "node:test";
import assert from "node:assert/strict";
import { addDaysIso, hmToMinutes, mondayIso, parseLocalDateTime } from "./tz";

test("mondayIso: воскресенье относится к прошедшей неделе", () => {
  assert.equal(mondayIso("2026-09-06"), "2026-08-31");
  assert.equal(mondayIso("2026-09-07"), "2026-09-07");
  assert.equal(mondayIso("2026-09-03"), "2026-08-31");
});

test("addDaysIso: через границу месяца и года", () => {
  assert.equal(addDaysIso("2026-08-31", 7), "2026-09-07");
  assert.equal(addDaysIso("2026-12-28", 7), "2027-01-04");
  assert.equal(addDaysIso("2026-09-01", -1), "2026-08-31");
});

test("parseLocalDateTime: 08:30 в Оренбурге = 03:30 UTC", () => {
  const d = parseLocalDateTime("2026-09-03T08:30");
  assert.ok(d);
  assert.equal(d!.toISOString(), "2026-09-03T03:30:00.000Z");
  assert.equal(parseLocalDateTime("не дата"), null);
});

test("hmToMinutes", () => {
  assert.equal(hmToMinutes("08:30"), 510);
  assert.equal(hmToMinutes("00:00"), 0);
});
