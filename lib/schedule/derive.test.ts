import { test } from "node:test";
import assert from "node:assert/strict";
import { isSessionWeek, mergeWeeks, nowState, semesterMondays, semesterPhase, semestersOf } from "./derive";
import type { ScheduleLesson, ScheduleSemester, ScheduleWeek } from "./types";

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

// Семестры: осень с сессией 12.01–25.01, каникулы до 09.02, весна.
const autumn: ScheduleSemester = { id: "a", title: "Осень", startsOn: "2026-09-01", endsOn: "2027-01-25", sessionStartsOn: "2027-01-12" };
const spring: ScheduleSemester = { id: "s", title: "Весна", startsOn: "2027-02-09", endsOn: "2027-06-30", sessionStartsOn: null };

test("semesterPhase: учёба и последний день перед сессией", () => {
  assert.equal(semesterPhase([autumn, spring], "2026-10-05").kind, "study");
  assert.equal(semesterPhase([autumn, spring], "2027-01-11").kind, "study");
});

test("semesterPhase: сессия с первого дня и до последнего дня семестра включительно", () => {
  const first = semesterPhase([autumn, spring], "2027-01-12");
  assert.equal(first.kind, "session");
  if (first.kind === "session") assert.equal(first.until, "2027-01-25");
  assert.equal(semesterPhase([autumn, spring], "2027-01-25").kind, "session");
});

test("semesterPhase: первый день каникул — до начала следующего, N дней", () => {
  const p = semesterPhase([spring, autumn], "2027-01-26");
  assert.equal(p.kind, "break");
  if (p.kind === "break") {
    assert.equal(p.until, "2027-02-09");
    assert.equal(p.days, 14);
    assert.equal(p.next.id, "s");
  }
});

test("semesterPhase: день начала следующего семестра — уже учёба", () => {
  const p = semesterPhase([autumn, spring], "2027-02-09");
  assert.equal(p.kind, "study");
  if (p.kind === "study") assert.equal(p.semester.id, "s");
});

test("semesterPhase: следующего семестра нет — «семестр закончился»", () => {
  const p = semesterPhase([autumn], "2027-01-26");
  assert.equal(p.kind, "over");
  if (p.kind === "over") assert.equal(p.semester.id, "a");
  assert.equal(semesterPhase([], "2027-01-26").kind, "unknown");
});

test("semesterPhase: до первого семестра — каникулы до его начала", () => {
  const p = semesterPhase([autumn], "2026-08-30");
  assert.equal(p.kind, "break");
  if (p.kind === "break") assert.equal(p.days, 2);
});

test("semestersOf: старый кеш без semesters — только текущий", () => {
  assert.deepEqual(semestersOf({ semester: autumn }), [autumn]);
  assert.deepEqual(semestersOf({ semester: null }), []);
  assert.deepEqual(semestersOf({ semester: autumn, semesters: [autumn, spring] }), [autumn, spring]);
});

test("semesterMondays и isSessionWeek: сессия помечает недели с 12.01 по 25.01", () => {
  const mondays = semesterMondays(autumn);
  assert.equal(mondays[0], "2026-08-31");
  assert.equal(mondays.at(-1), "2027-01-25");
  const session = mondays.filter((m) => isSessionWeek(m, autumn));
  assert.deepEqual(session, ["2027-01-11", "2027-01-18", "2027-01-25"]);
  assert.equal(isSessionWeek("2027-01-04", autumn), false);
  assert.equal(isSessionWeek("2027-03-01", spring), false);
});

test("mergeWeeks: без дублей, приоритет у базовых, по возрастанию", () => {
  const w = (startsOn: string, id = startsOn): ScheduleWeek => ({ id, startsOn, parity: null, publishedAt: null, lessons: [] });
  const base = [w("2026-09-07"), w("2026-09-14")];
  const merged = mergeWeeks(base, [w("2026-02-02"), w("2026-09-07", "dup")]);
  assert.deepEqual(
    merged.map((x) => x.id),
    ["2026-02-02", "2026-09-07", "2026-09-14"],
  );
  assert.equal(mergeWeeks(base, []), base);
});
