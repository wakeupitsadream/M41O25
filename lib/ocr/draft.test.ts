import { test } from "node:test";
import assert from "node:assert/strict";
import { matchSubject, normalizeTime, slotByTime, toDraft } from "./draft";
import type { OcrResult } from "./schema";

const slots = [
  { slot: 1, start: "08:30", end: "10:00" },
  { slot: 2, start: "10:10", end: "11:40" },
  { slot: 3, start: "12:10", end: "13:40" },
];
const subjects = [
  { id: "m", name: "Математический анализ", shortName: "Матан" },
  { id: "e", name: "Английский язык", shortName: "Англ" },
  { id: "h", name: "История России", shortName: "История" },
];
const base = (lessons: OcrResult["lessons"]): OcrResult => ({ group_found: true, group_label_seen: "М41О25", week_type: "upper", confidence_notes: "", lessons });
const l = (over: Partial<OcrResult["lessons"][number]>): OcrResult["lessons"][number] => ({
  day: "mon", slot: 1, time_start: null, time_end: null, subject: "Матан", lesson_type: "лекция", teacher: null, room: null, week_type: "both", uncertain: false, raw_text: "", ...over,
});

test("normalizeTime и slotByTime: «8.30» → 08:30 → 1-я пара; далёкое время — null", () => {
  assert.equal(normalizeTime("8.30"), "08:30");
  assert.equal(normalizeTime("8-30"), "08:30");
  assert.equal(slotByTime("8.30", slots), 1);
  assert.equal(slotByTime("10:15", slots), 2);
  assert.equal(slotByTime("15:00", slots), null);
});

test("toDraft: даты по дням недели, чужая чётность выключена, своя включена", () => {
  const d = toDraft(base([l({ day: "mon" }), l({ day: "wed", slot: 2, week_type: "lower", subject: "Англ" }), l({ day: "wed", slot: 2, week_type: "upper", subject: "История" })]), "2026-09-07", "upper", slots, subjects);
  assert.equal(d[0].date, "2026-09-07");
  assert.equal(d[0].startsAt, "08:30");
  assert.equal(d[0].subjectId, "m");
  const wed = d.filter((x) => x.date === "2026-09-09");
  assert.equal(wed.find((x) => x.weekType === "lower")?.include, false);
  assert.equal(wed.find((x) => x.weekType === "upper")?.include, true);
});

test("toDraft: неделя без чётности ничего не выключает; слот по времени, если slot=0", () => {
  const d = toDraft(base([l({ slot: 0, time_start: "10.10", time_end: "11.40", week_type: "lower" })]), "2026-09-07", null, slots, subjects);
  assert.equal(d[0].include, true);
  assert.equal(d[0].slot, 2);
  assert.equal(d[0].startsAt, "10:10");
});

test("toDraft: два занятия в одной паре одной чётности подсвечиваются", () => {
  const d = toDraft(base([l({ subject: "Матан" }), l({ subject: "Англ" })]), "2026-09-07", "upper", slots, subjects);
  assert.ok(d.every((x) => x.uncertain));
});

test("matchSubject: точное, короткое, по вхождению; двусмысленное — null", () => {
  assert.equal(matchSubject("Матан", subjects), "m");
  assert.equal(matchSubject("математический анализ", subjects), "m");
  assert.equal(matchSubject("Английский язык (практика)", subjects), "e");
  assert.equal(matchSubject("ИЯ", subjects), null);
});
