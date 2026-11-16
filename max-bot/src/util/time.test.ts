import assert from "node:assert/strict";
import { test } from "node:test";
import { courseNumber, formatWhen, localDayIso, nextMidnight, nextPacificMidnight, nextUtcMidnight } from "./time.js";

test("полночь по Лос-Анджелесу летом — 07:00 UTC, зимой — 08:00 UTC", () => {
  assert.equal(nextPacificMidnight(new Date("2026-10-08T10:00:00Z")).toISOString(), "2026-10-09T07:00:00.000Z");
  assert.equal(nextPacificMidnight(new Date("2026-12-01T10:00:00Z")).toISOString(), "2026-12-02T08:00:00.000Z");
  // 06:59 UTC 9 октября — ещё 8 октября в LA: сброс через минуту.
  assert.equal(nextPacificMidnight(new Date("2026-10-09T06:59:00Z")).toISOString(), "2026-10-09T07:00:00.000Z");
});

test("переход на зимнее время в США (1 ноября 2026)", () => {
  // Вечер 31 октября в LA (PDT) → полночь 1 ноября ещё по PDT = 07:00 UTC.
  assert.equal(nextPacificMidnight(new Date("2026-11-01T02:00:00Z")).toISOString(), "2026-11-01T07:00:00.000Z");
  // День 1 ноября (уже PST) → полночь 2 ноября = 08:00 UTC.
  assert.equal(nextPacificMidnight(new Date("2026-11-01T20:00:00Z")).toISOString(), "2026-11-02T08:00:00.000Z");
});

test("полночь UTC и Екатеринбурга", () => {
  assert.equal(nextUtcMidnight(new Date("2026-10-08T23:59:59Z")).toISOString(), "2026-10-09T00:00:00.000Z");
  assert.equal(nextMidnight(new Date("2026-10-08T20:00:00Z"), "Asia/Yekaterinburg").toISOString(), "2026-10-09T19:00:00.000Z");
});

test("formatWhen: сегодня — только время, иначе с датой", () => {
  const now = new Date("2026-10-08T03:00:00Z");
  assert.equal(formatWhen(new Date("2026-10-08T07:00:00Z"), now, "Asia/Yekaterinburg"), "12:00");
  assert.match(formatWhen(new Date("2026-10-09T07:00:00Z"), now, "Asia/Yekaterinburg"), /^12:00, 9 окт/);
});

test("localDayIso и номер курса", () => {
  assert.equal(localDayIso(new Date("2026-10-08T20:00:00Z"), "Asia/Yekaterinburg"), "2026-10-09");
  assert.equal(courseNumber(new Date("2026-10-08T10:00:00Z"), 2025, "Asia/Yekaterinburg"), 2);
  assert.equal(courseNumber(new Date("2026-08-31T10:00:00Z"), 2025, "Asia/Yekaterinburg"), 1);
  assert.equal(courseNumber(new Date("2027-09-01T10:00:00Z"), 2025, "Asia/Yekaterinburg"), 3);
});
