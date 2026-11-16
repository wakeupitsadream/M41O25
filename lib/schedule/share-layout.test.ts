import test from "node:test";
import assert from "node:assert/strict";
import { SHARE_DENSITIES, SHARE_LIST_HEIGHT, SHARE_MAX_LESSONS, roomLabel, shareDensity, shareListHeight, wrappedLines } from "./share-layout";

const short = { title: "Иностранный язык", sub: "Практика · ауд. 215 · Иванова И.И." };
const long = { title: "Элективные дисциплины по физической культуре и спорту", sub: "Практика · Спорт. зал · Петров П.П." };

test("wrappedLines: жадный перенос по словам и после дефиса, длинное слово режется", () => {
  assert.equal(wrappedLines("Матанализ", 19), 1);
  assert.equal(wrappedLines("Иностранный язык", 19), 1);
  // Как на готовой карточке: «Элективные / дисциплины по / физической культуре / и спорту».
  assert.equal(wrappedLines("Элективные дисциплины по физической культуре и спорту", 19), 4);
  assert.equal(wrappedLines("Социально-экономическая статистика", 19), 3);
  assert.equal(wrappedLines("абвгдеёжзи", 4), 3);
  assert.equal(wrappedLines("   ", 10), 1);
});

test("shareDensity: обычный день — просторная вёрстка, как раньше", () => {
  assert.equal(shareDensity([short, short, short]), SHARE_DENSITIES[0]);
  assert.equal(shareDensity([]), SHARE_DENSITIES[0]);
});

test("shareDensity: шесть пар с короткими названиями помещаются без обрезки текста", () => {
  const d = shareDensity(Array.from({ length: 6 }, () => short));
  assert.equal(d.titleLines, null);
  assert.ok(shareListHeight(Array.from({ length: 6 }, () => short), d) <= SHARE_LIST_HEIGHT);
});

test("shareDensity: среда нижней недели (две обычные пары и две физкультуры) — текст целиком, без обрезки", () => {
  const wednesday = [short, short, long, long];
  const d = shareDensity(wednesday);
  assert.equal(d.titleLines, null);
  assert.ok(shareListHeight(wednesday, d) <= SHARE_LIST_HEIGHT);
});

test("shareDensity: пять пар с длинными названиями уплотняются до обрезки названия на двух строках", () => {
  const day = Array.from({ length: 5 }, () => long);
  const d = shareDensity(day);
  assert.equal(d.titleLines, 2);
  assert.ok(shareListHeight(day, d) <= SHARE_LIST_HEIGHT);
});

test("shareDensity: худший случай — максимум пар с длинными названиями — всё равно помещается", () => {
  for (let n = 1; n <= SHARE_MAX_LESSONS; n++) {
    const day = Array.from({ length: n }, () => long);
    const d = shareDensity(day);
    assert.ok(shareListHeight(day, d) <= SHARE_LIST_HEIGHT, `${n} длинных пар не помещаются: ${shareListHeight(day, d)}`);
  }
});

test("shareDensity: плотности идут от просторной к плотной", () => {
  const day = Array.from({ length: 5 }, () => long);
  const heights = SHARE_DENSITIES.map((d) => shareListHeight(day, d));
  for (let i = 1; i < heights.length; i++) assert.ok(heights[i] < heights[i - 1]);
});

test("roomLabel: «ауд.» только перед номером", () => {
  assert.equal(roomLabel("215"), "ауд. 215");
  assert.equal(roomLabel("2-14а"), "ауд. 2-14а");
  assert.equal(roomLabel("Спорт. зал"), "Спорт. зал");
  assert.equal(roomLabel("  "), null);
  assert.equal(roomLabel(null), null);
});
