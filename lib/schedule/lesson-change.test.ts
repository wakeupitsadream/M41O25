import { strictEqual } from "node:assert/strict";
import { test } from "node:test";
import { lessonChangeSummary, type LessonFacts } from "@/lib/schedule/lesson-change";

// Прежняя версия — как она лежит в базе: время с секундами (колонка time), пустые поля — null.
const prev: LessonFacts = {
  date: "2026-10-02",
  startsAt: "08:30:00",
  endsAt: "10:00:00",
  room: "214",
  teacherName: "Иванова И.И.",
  title: "Математический анализ",
  kind: "practice",
  note: null,
};

// Новая — как приходит из формы редактора: время «ЧЧ:ММ».
const same: LessonFacts = { ...prev, startsAt: "08:30", endsAt: "10:00" };

test("ничего значимого не поменялось — null, пуш слать незачем", () => {
  strictEqual(lessonChangeSummary(prev, same), null);
  // Снятая заметка сама по себе — не повод будить телефоны.
  strictEqual(lessonChangeSummary({ ...prev, note: "старая" }, same), null);
});

test("аудитория, преподаватель, время — по одному и вместе, в стабильном порядке", () => {
  strictEqual(lessonChangeSummary(prev, { ...same, room: "305" }), "аудитория 305");
  strictEqual(lessonChangeSummary(prev, { ...same, teacherName: "Петров П.П." }), "преподаватель Петров П.П.");
  // Новое время уже стоит в начале тела пуша («10:10 · …»), поэтому в перечне — прежнее.
  strictEqual(lessonChangeSummary(prev, { ...same, startsAt: "10:10", endsAt: "11:40" }), "было 08:30–10:00");
  strictEqual(lessonChangeSummary(prev, { ...same, startsAt: "10:10", endsAt: "11:40", room: "305", teacherName: "Петров П.П." }), "было 08:30–10:00, аудитория 305, преподаватель Петров П.П.");
});

test("перенос на другой день — с прежней датой словами", () => {
  strictEqual(lessonChangeSummary(prev, { ...same, date: "2026-10-03" }), "перенесли с 2 октября");
});

test("убранные аудитория и преподаватель — тоже изменение, о котором стоит сказать", () => {
  strictEqual(lessonChangeSummary(prev, { ...same, room: null }), "аудитория не указана");
  strictEqual(lessonChangeSummary(prev, { ...same, room: "  " }), "аудитория не указана");
  strictEqual(lessonChangeSummary(prev, { ...same, teacherName: "" }), "преподаватель не указан");
});

test("другой предмет и другой вид пары", () => {
  strictEqual(lessonChangeSummary(prev, { ...same, title: "Физкультура" }), "вместо «Математический анализ»");
  strictEqual(lessonChangeSummary(prev, { ...same, kind: "lecture" }), "теперь лекция");
  // У вида «другое» подписи нет — в перечень он не попадает.
  strictEqual(lessonChangeSummary(prev, { ...same, kind: "other" }), null);
});

test("заметка админа важнее автоматического перечня", () => {
  strictEqual(lessonChangeSummary(prev, { ...same, room: "305", note: "Пара перенесена в 305, вход со двора" }), "Пара перенесена в 305, вход со двора");
  // Та же заметка, что и была, перечень не заслоняет.
  strictEqual(lessonChangeSummary({ ...prev, note: "Замена" }, { ...same, note: "Замена", room: "305" }), "аудитория 305");
  // Пробелы вокруг — не новая заметка.
  strictEqual(lessonChangeSummary({ ...prev, note: "Замена" }, { ...same, note: "  Замена  " }), null);
});
