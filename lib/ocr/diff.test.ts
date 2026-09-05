import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChanges, diffDraft, shiftLessons, type DiffableDraft, type PrevLesson } from "./diff";

const prev = (over: Partial<PrevLesson>): PrevLesson => ({
  date: "2026-09-07", slot: 1, title: "Математический анализ", subjectId: "m", room: "214", teacherName: "Иванова И.И.", kind: "lecture", startsAt: "08:30", endsAt: "10:00", ...over,
});
const row = (over: Partial<DiffableDraft>): DiffableDraft => ({ key: over.key ?? `${over.date ?? "2026-09-07"}-${over.slot ?? 1}`, include: true, ...prev({}), ...over });

test("shiftLessons: даты прошлой недели переезжают на текущую понедельник к понедельнику", () => {
  const shifted = shiftLessons([prev({ date: "2026-08-26" })], "2026-08-24", "2026-09-07");
  assert.equal(shifted[0].date, "2026-09-09");
});

test("diffDraft: новая, такая же, изменённая (с описанием), пропавшая", () => {
  const previous = [prev({}), prev({ slot: 2, title: "Английский язык", subjectId: "e", room: "118", teacherName: "Смирнова А.В.", kind: "practice" }), prev({ date: "2026-09-08", slot: 1, title: "История", subjectId: "h" })];
  const draft = [
    row({ key: "a", slot: 1 }),
    row({ key: "b", slot: 2, title: "Англ. яз.", subjectId: "e", room: "305", teacherName: "Смирнова А.В.", kind: "practice" }),
    row({ key: "c", slot: 3, title: "Философия", subjectId: null }),
    row({ key: "d", date: "2026-09-08", slot: 1, include: false }),
  ];
  const diff = diffDraft(draft, previous);
  assert.deepEqual(diff.byKey.a, { status: "same" });
  assert.deepEqual(diff.byKey.b, { status: "changed", changes: ["ауд.: 118 → 305"] });
  assert.deepEqual(diff.byKey.c, { status: "new" });
  assert.equal(diff.byKey.d, undefined);
  // Невключённая строка не «закрывает» пару прошлой недели — та считается пропавшей.
  assert.deepEqual(diff.missing.map((m) => `${m.date}|${m.slot}`), ["2026-09-08|1"]);
});

test("describeChanges: предмет, вид, преподаватель, время; пустые значения как «—»", () => {
  const changes = describeChanges(prev({}), row({ title: "Философия", subjectId: "f", kind: "practice", teacherName: null, startsAt: "10:10", endsAt: "11:40" }));
  assert.deepEqual(changes, ["предмет: Математический анализ → Философия", "вид: Лекция → Практика", "преп.: Иванова И.И. → —", "время: 08:30–10:00 → 10:10–11:40"]);
  // Один предмет под разными написаниями без subjectId — не изменение.
  assert.deepEqual(describeChanges(prev({ subjectId: null, title: "Матан" }), row({ subjectId: null, title: "матан" })), []);
});

test("diffDraft: подгруппы в одной паре сопоставляются по предмету, лишняя прошлая — пропавшая", () => {
  const previous = [prev({ title: "Английский язык", subjectId: "e" }), prev({ title: "Немецкий язык", subjectId: "g", room: "120" })];
  const diff = diffDraft([row({ key: "x", title: "Немецкий язык", subjectId: "g", room: "120" })], previous);
  assert.deepEqual(diff.byKey.x, { status: "same" });
  assert.equal(diff.missing[0].title, "Английский язык");
});
