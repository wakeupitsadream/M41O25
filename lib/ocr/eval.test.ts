import { test } from "node:test";
import assert from "node:assert/strict";
import { actualKeys, evalMetrics, lessonKey, type ExpectedFixture } from "./eval";
import type { OcrResult } from "./schema";

const res = (lessons: Partial<OcrResult["lessons"][number]>[]): OcrResult => ({
  group_found: true,
  group_label_seen: "М41О25",
  week_type: "upper",
  confidence_notes: "",
  lessons: lessons.map((l) => ({ day: "mon", slot: 1, time_start: null, time_end: null, subject: "X", lesson_type: null, teacher: null, room: null, week_type: "both", uncertain: false, raw_text: "", ...l })),
});

test("lessonKey: нормализованный предмет, синонимы применяются", () => {
  assert.equal(lessonKey("mon", 1, "Матем. Анализ"), "mon|1|матем анализ");
  assert.equal(lessonKey("mon", 1, "Матан", { матан: "математический анализ" }), "mon|1|математический анализ");
});

test("evalMetrics: precision/recall по ключам с учётом синонимов и чётности", () => {
  const fixture: ExpectedFixture = {
    weekType: "upper",
    synonyms: { Матан: "Математический анализ" },
    lessons: [
      { day: "mon", slot: 1, subject: "Математический анализ" },
      { day: "mon", slot: 2, subject: "Английский язык" },
      { day: "tue", slot: 1, subject: "История России", weekType: "lower" },
      { day: "wed", slot: 1, subject: "Философия" },
    ],
  };
  const m = evalMetrics(
    fixture,
    res([
      { day: "mon", slot: 1, subject: "Матан" },
      { day: "mon", slot: 2, subject: "Английский язык" },
      { day: "mon", slot: 3, subject: "Правоведение" },
      { day: "thu", slot: 1, subject: "Информатика", week_type: "lower" },
    ]),
  );
  // Ожидание: 3 пары (история нижней недели отброшена); найдено 3 (информатика нижней недели отброшена); совпали 2.
  assert.equal(m.expected, 3);
  assert.equal(m.found, 3);
  assert.equal(m.tp, 2);
  assert.ok(Math.abs(m.precision - 2 / 3) < 1e-9);
  assert.ok(Math.abs(m.recall - 2 / 3) < 1e-9);
  assert.deepEqual(m.missing, ["wed|1|философия"]);
  assert.deepEqual(m.extra, ["mon|3|правоведение"]);
});

test("actualKeys: slot=0 восстанавливается по времени; пусто и пусто — метрики 1", () => {
  const keys = actualKeys(res([{ slot: 0, time_start: "10.10", subject: "A" }]), { lessons: [] });
  assert.deepEqual(keys, ["mon|2|a"]);
  const m = evalMetrics({ lessons: [] }, res([]));
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 1);
});
