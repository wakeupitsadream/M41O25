import { test } from "node:test";
import assert from "node:assert/strict";
import { maskTime, toHm } from "./time-mask";

test("maskTime: двоеточие появляется само, лишнее отбрасывается", () => {
  assert.equal(maskTime(""), "");
  assert.equal(maskTime("0"), "0");
  assert.equal(maskTime("08"), "08");
  assert.equal(maskTime("083"), "0:83");
  assert.equal(maskTime("0830"), "08:30");
  assert.equal(maskTime("830"), "8:30");
  assert.equal(maskTime("08:30"), "08:30");
  assert.equal(maskTime("08305"), "08:30");
  assert.equal(maskTime("ЧЧ:ММ"), "");
});

test("toHm: сервер получает ровно ЧЧ:ММ", () => {
  assert.equal(toHm(""), "");
  assert.equal(toHm("8"), "08:00");
  assert.equal(toHm("13"), "13:00");
  assert.equal(toHm("830"), "08:30");
  assert.equal(toHm("0830"), "08:30");
  assert.equal(toHm("08:30"), "08:30");
  assert.equal(toHm("1810"), "18:10");
});

test("toHm: несуществующее время не проходит", () => {
  assert.equal(toHm("2530"), "");
  assert.equal(toHm("0899"), "");
  assert.equal(toHm("99"), "");
});

test("toHm: результат всегда подходит под проверку сервера", () => {
  for (const raw of ["8", "830", "0830", "2359", "00:00"]) {
    assert.match(toHm(raw), /^\d{2}:\d{2}$/, raw);
  }
});
