import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SLOT_TIMES, EDITOR_SLOTS, editorSlots, slotTime, withDefaultSlots } from "./slots";

const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

/** Сетка группы из четырёх пар: первые две — старая 90-минутная, чтобы было видно, что своё время побеждает стандартное. */
const four = [
  { slot: 1, start: "08:30", end: "10:00" },
  { slot: 2, start: "10:10", end: "11:40" },
  { slot: 3, start: "11:30", end: "12:50" },
  { slot: 4, start: "13:30", end: "14:50" },
];

test("стандартная сетка: шесть пар по 80 минут, по порядку и без наложений", () => {
  assert.equal(DEFAULT_SLOT_TIMES.length, EDITOR_SLOTS);
  DEFAULT_SLOT_TIMES.forEach((s, i) => {
    assert.equal(s.slot, i + 1);
    assert.equal(toMin(s.end) - toMin(s.start), 80, `${s.slot}-я пара не 80 минут`);
    if (i > 0) assert.ok(toMin(s.start) >= toMin(DEFAULT_SLOT_TIMES[i - 1].end), `${s.slot}-я пара начинается до конца предыдущей`);
  });
});

test("slotTime: своё время группы, иначе стандартное, иначе null", () => {
  assert.deepEqual(slotTime(2, four), { slot: 2, start: "10:10", end: "11:40" });
  assert.deepEqual(slotTime(5, four), { slot: 5, start: "15:00", end: "16:20" });
  assert.equal(slotTime(9, four), null);
});

test("withDefaultSlots: дополняет сетку группы стандартными парами и сортирует", () => {
  const grid = withDefaultSlots([four[3], four[0]]);
  assert.deepEqual(
    grid.map((s) => `${s.slot}:${s.start}`),
    ["1:08:30", "2:10:00", "3:11:30", "4:13:30", "5:15:00", "6:16:30"],
  );
  assert.deepEqual(withDefaultSlots(DEFAULT_SLOT_TIMES), DEFAULT_SLOT_TIMES);
});

test("editorSlots: всегда шесть строк; без настроек — подсказки из стандартной сетки", () => {
  const rows = editorSlots([], []);
  assert.equal(rows.length, EDITOR_SLOTS);
  assert.ok(rows.every((r) => !r.configured));
  assert.equal(rows[4].start, "15:00");
  assert.equal(rows[5].end, "17:50");
});

test("editorSlots: четыре пары в настройках → строки 5 и 6 остаются, но помечены как не настроенные", () => {
  const rows = editorSlots(four, []);
  assert.deepEqual(rows.map((r) => [r.slot, r.configured]), [[1, true], [2, true], [3, true], [4, true], [5, false], [6, false]]);
  assert.equal(rows[1].start, "10:10");
  assert.equal(rows[4].start, "15:00");
});

test("editorSlots: пара вне сетки (7-я из скана) добавляет строку с её временем, настроенные 8-е тоже видны", () => {
  const rows = editorSlots([...four, { slot: 8, start: "18:00", end: "19:20" }], [{ slot: 7, startsAt: "17:55", endsAt: "19:15" }]);
  assert.deepEqual(rows.map((r) => r.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(rows[6], { slot: 7, start: "17:55", end: "19:15", configured: false });
  assert.equal(rows[7].configured, true);
});
