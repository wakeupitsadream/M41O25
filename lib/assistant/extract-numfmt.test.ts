import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyFormat, formatById, formatNumber, isoCellDate, plainNumber, serialDate } from "./extract-numfmt";

const date = { kind: "datetime", date: true, time: false, seconds: false, elapsed: false } as const;

test("classifyFormat: даты, время, минуты против месяцев, проценты, мусор в кавычках и скобках", () => {
  assert.deepEqual(classifyFormat("dd/mm/yyyy;@"), date);
  assert.deepEqual(classifyFormat("[$-F800]dddd, mmmm dd, yyyy"), date);
  assert.deepEqual(classifyFormat("h:mm"), { kind: "datetime", date: false, time: true, seconds: false, elapsed: false });
  assert.deepEqual(classifyFormat("mm:ss"), { kind: "datetime", date: false, time: true, seconds: true, elapsed: false });
  assert.deepEqual(classifyFormat("[h]:mm:ss"), { kind: "datetime", date: false, time: true, seconds: true, elapsed: true });
  assert.deepEqual(classifyFormat("d.m.yy h:mm"), { kind: "datetime", date: true, time: true, seconds: false, elapsed: false });
  assert.deepEqual(classifyFormat("0%"), { kind: "percent", decimals: 0 });
  assert.deepEqual(classifyFormat("0.00%"), { kind: "percent", decimals: 2 });
  // В кавычках и после «\» — литералы, не коды: «шт.» и «м» не делают число датой.
  assert.deepEqual(classifyFormat('0 "шт. dmy"'), { kind: "general" });
  assert.deepEqual(classifyFormat("# ##0\\ \\м"), { kind: "general" });
  assert.deepEqual(classifyFormat("[Red]#,##0.00;[Blue]-#,##0.00"), { kind: "general" });
  assert.deepEqual(classifyFormat("General"), { kind: "general" });
  assert.deepEqual(classifyFormat("@"), { kind: "general" });
  assert.deepEqual(classifyFormat(undefined), { kind: "general" });
});

test("formatById: встроенные 14–22, 45–47, 9–10; пользовательский формат переопределяет встроенный", () => {
  const none = new Map<number, string>();
  assert.equal(formatById(14, none).kind, "datetime");
  assert.equal(formatById(22, none).kind, "datetime");
  assert.equal(formatById(46, none).kind, "datetime");
  assert.equal(formatById(9, none).kind, "percent");
  assert.equal(formatById(0, none).kind, "general");
  assert.equal(formatById(2, none).kind, "general");
  assert.equal(formatById(164, new Map([[164, "yyyy-mm-dd"]])).kind, "datetime");
});

test("serialDate: база 1899-12-30, 60-й день — несуществующее 29.02.1900, до него база 31.12.1899; система 1904", () => {
  assert.equal(serialDate(1, false), "01.01.1900");
  assert.equal(serialDate(59, false), "28.02.1900");
  assert.equal(serialDate(60, false), "29.02.1900");
  assert.equal(serialDate(61, false), "01.03.1900");
  assert.equal(serialDate(46289, false), "24.09.2026");
  assert.equal(serialDate(0, true), "01.01.1904");
  assert.equal(serialDate(46289 - 1462, true), "24.09.2026");
});

test("formatNumber: дата, время, дата со временем, прошедшее время, проценты, числа вне диапазона дат", () => {
  const fmt = (code: string) => classifyFormat(code);
  assert.equal(formatNumber("46289", fmt("dd.mm.yyyy"), false), "24.09.2026");
  assert.equal(formatNumber("46289.75", fmt("dd.mm.yyyy"), false), "24.09.2026");
  assert.equal(formatNumber("0.375", fmt("h:mm"), false), "9:00");
  assert.equal(formatNumber("0.3958333333333333", fmt("h:mm:ss"), false), "9:30:00");
  assert.equal(formatNumber("46289.375", fmt("dd.mm.yyyy h:mm"), false), "24.09.2026 9:00");
  // 23:59:59.9 округляется до следующих суток, а не до «24:00».
  assert.equal(formatNumber(String(46289 + 86399.9 / 86400), fmt("dd.mm.yyyy h:mm:ss"), false), "25.09.2026 0:00:00");
  assert.equal(formatNumber("1.9375", fmt("[h]:mm"), false), "46:30");
  assert.equal(formatNumber("0.85", fmt("0%"), false), "85 %");
  assert.equal(formatNumber("0.1234", fmt("0.00%"), false), "12.34 %");
  assert.equal(formatNumber("-5", fmt("dd.mm.yyyy"), false), "-5");
  assert.equal(formatNumber("1e10", fmt("dd.mm.yyyy"), false), "10000000000");
  assert.equal(formatNumber("", fmt("dd.mm.yyyy"), false), "");
});

test("plainNumber: шум до 10 значащих цифр, целые не трогаем, нечисловое — как есть", () => {
  assert.equal(plainNumber("0.30000000000000004"), "0.3");
  assert.equal(plainNumber("4.5"), "4.5");
  assert.equal(plainNumber("20231234567"), "20231234567");
  assert.equal(plainNumber("3.14159265358979"), "3.141592654");
  assert.equal(plainNumber("#N/A"), "#N/A");
});

test("isoCellDate: ячейка t=\"d\" — ISO-строка", () => {
  assert.equal(isoCellDate("2026-09-24T00:00:00"), "24.09.2026");
  assert.equal(isoCellDate("2026-09-24T09:30:00"), "24.09.2026 9:30");
  assert.equal(isoCellDate("не дата"), "не дата");
});
