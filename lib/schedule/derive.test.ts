import { test } from "node:test";
import assert from "node:assert/strict";
import { nowState } from "./derive";
import type { ScheduleLesson } from "./types";

const lesson = (startsAt: string, endsAt: string, extra: Partial<ScheduleLesson> = {}) =>
  ({ id: `${startsAt}`, title: "Матан", startsAt, endsAt, isCancelled: false, ...extra }) as ScheduleLesson;
const day = [lesson("08:30", "10:00"), lesson("10:10", "11:40"), lesson("12:10", "13:40")];
const min = (h: number, m: number) => h * 60 + m;

test("nowState: до первой пары", () => {
  const s = nowState(day, min(8, 0));
  assert.equal(s.kind, "before");
  if (s.kind === "before") assert.equal(s.minutesUntil, 30);
});

test("nowState: во время пары — прогресс и остаток", () => {
  const s = nowState(day, min(9, 15));
  assert.equal(s.kind, "during");
  if (s.kind === "during") {
    assert.equal(s.index, 0);
    assert.equal(s.total, 3);
    assert.equal(s.minutesLeft, 45);
    assert.ok(Math.abs(s.progress - 0.5) < 1e-9);
  }
});

test("nowState: перемена и конец дня", () => {
  const b = nowState(day, min(10, 5));
  assert.equal(b.kind, "break");
  if (b.kind === "break") assert.equal(b.minutesUntil, 5);
  assert.equal(nowState(day, min(14, 0)).kind, "done");
});

test("nowState: отменённые пары не считаются", () => {
  const s = nowState([lesson("08:30", "10:00", { isCancelled: true })], min(9, 0));
  assert.equal(s.kind, "none");
});
