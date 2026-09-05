import { test } from "node:test";
import assert from "node:assert/strict";
import { pickNewLessons } from "./apply";

test("pickNewLessons: занятые (дата, пара) пропускаются, остальные добавляются, порядок сохраняется", () => {
  const items = [
    { date: "2026-09-07", slot: 1, title: "a" },
    { date: "2026-09-07", slot: 2, title: "b" },
    { date: "2026-09-08", slot: 1, title: "c" },
  ];
  const { add, skipped } = pickNewLessons(items, [{ date: "2026-09-07", slot: 2 }, { date: "2026-09-09", slot: 1 }]);
  assert.deepEqual(add.map((x) => x.title), ["a", "c"]);
  assert.deepEqual(skipped.map((x) => x.title), ["b"]);
});

test("pickNewLessons: пустая неделя — всё новое; две подгруппы черновика в одной паре обе проходят", () => {
  const items = [{ date: "2026-09-07", slot: 1 }, { date: "2026-09-07", slot: 1 }];
  assert.equal(pickNewLessons(items, []).add.length, 2);
});
