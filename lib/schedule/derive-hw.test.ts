import { test } from "node:test";
import assert from "node:assert/strict";
import { changeBadgeAlive, dayHasFreshChanges, homeworkForLesson, homeworkOn } from "./derive";
import type { ScheduleHomework, ScheduleLesson } from "./types";

const lesson = (id: string, date: string, extra: Partial<ScheduleLesson> = {}) =>
  ({ id, date, title: "Матан", subjectId: "m", startsAt: "08:30", endsAt: "10:00", isCancelled: false, modifiedAfterPublish: false, ...extra }) as ScheduleLesson;
const hw = (id: string, dueDate: string, extra: Partial<ScheduleHomework> = {}) =>
  ({ id, dueDate, lessonId: null, subjectId: "m", subjectShort: "Матан", subjectColor: null, title: null, text: "№ 1", done: false, ...extra }) as ScheduleHomework;

test("changeBadgeAlive: бейдж виден в день пары и раньше, гаснет со следующего дня", () => {
  const l = lesson("a", "2026-09-10", { modifiedAfterPublish: true });
  assert.equal(changeBadgeAlive(l, "2026-09-09"), true);
  assert.equal(changeBadgeAlive(l, "2026-09-10"), true);
  assert.equal(changeBadgeAlive(l, "2026-09-11"), false);
  assert.equal(changeBadgeAlive(lesson("b", "2026-09-10"), "2026-09-10"), false);
});

test("dayHasFreshChanges: прошедшие правки и отмены не тревожат карточку недели", () => {
  const changed = [lesson("a", "2026-09-08", { modifiedAfterPublish: true }), lesson("b", "2026-09-08")];
  assert.equal(dayHasFreshChanges(changed, "2026-09-08"), true);
  assert.equal(dayHasFreshChanges(changed, "2026-09-09"), false);
  assert.equal(dayHasFreshChanges([lesson("c", "2026-09-12", { isCancelled: true })], "2026-09-10"), true);
  assert.equal(dayHasFreshChanges([lesson("c", "2026-09-12", { isCancelled: true })], "2026-09-13"), false);
  assert.equal(dayHasFreshChanges([lesson("d", "2026-09-12")], "2026-09-10"), false);
});

test("homeworkOn: только записи с дедлайном в этот день; старый кеш без поля — пусто", () => {
  const list = [hw("1", "2026-09-10"), hw("2", "2026-09-11"), hw("3", "2026-09-10")];
  assert.deepEqual(homeworkOn(list, "2026-09-10").map((h) => h.id), ["1", "3"]);
  assert.deepEqual(homeworkOn(list, "2026-09-12"), []);
  assert.deepEqual(homeworkOn(undefined, "2026-09-10"), []);
});

test("homeworkForLesson: явная привязка побеждает, без привязки — совпадение предмета и дня", () => {
  const math1 = lesson("L1", "2026-09-10");
  const math2 = lesson("L2", "2026-09-10", { startsAt: "10:10", endsAt: "11:40" });
  const eng = lesson("L3", "2026-09-10", { subjectId: "e" });
  const noSubject = lesson("L4", "2026-09-10", { subjectId: null });
  const list = [
    hw("bound", "2026-09-10", { lessonId: "L2" }),
    hw("loose", "2026-09-10"),
    hw("otherDay", "2026-09-11"),
    hw("noSubj", "2026-09-10", { subjectId: null }),
  ];
  assert.deepEqual(homeworkForLesson(list, math1).map((h) => h.id), ["loose"]);
  assert.deepEqual(homeworkForLesson(list, math2).map((h) => h.id), ["bound", "loose"]);
  assert.deepEqual(homeworkForLesson(list, eng), []);
  // Пара без предмета не «притягивает» записи без предмета — иначе любая заметка висела бы на каждой такой паре.
  assert.deepEqual(homeworkForLesson(list, noSubject), []);
  assert.deepEqual(homeworkForLesson(undefined, math1), []);
});
