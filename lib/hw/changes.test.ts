import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHwChanges, editDistance, hwChangeKinds, isSubstantialHwChange, normalizeHwText, TYPO_EDIT_DISTANCE, type HwEssentials } from "./changes";

const base: HwEssentials = { title: null, body: "№ 214–220, стр. 48. Сдать письменно, проверка на паре.", dueDate: "2026-09-11", subjectId: "m" };
const with_ = (over: Partial<HwEssentials>): HwEssentials => ({ ...base, ...over });

test("editDistance: базовые случаи и срез общего префикса/суффикса", () => {
  assert.equal(editDistance("", ""), 0);
  assert.equal(editDistance("кот", "кот"), 0);
  assert.equal(editDistance("кот", "код"), 1);
  assert.equal(editDistance("кот", "коты"), 1);
  assert.equal(editDistance("сдедлайн", "дедлайн"), 1);
  assert.equal(editDistance("абв", "вба"), 2);
  assert.equal(editDistance("длинный текст с ошибкой в серидине и хвостом", "длинный текст с ошибкой в середине и хвостом"), 1);
  assert.equal(editDistance("длинный текст с ошибкой в сердеине и хвостом", "длинный текст с ошибкой в середине и хвостом"), 2);
  assert.equal(editDistance("a".repeat(50), "b".repeat(50)), 50);
});

test("editDistance: cap возвращает разницу длин как нижнюю границу, не считая матрицу", () => {
  assert.equal(editDistance("abc", "abcdefgh", 4), 5);
  assert.ok(editDistance("abc", "abcdefgh", 4) >= TYPO_EDIT_DISTANCE);
});

test("normalizeHwText: регистр, ё и пробелы не считаются правкой", () => {
  assert.equal(normalizeHwText("  Сдать   Ещё\nзавтра "), "сдать еще завтра");
});

test("опечатка (меньше 4 символов) — не событие", () => {
  assert.deepEqual(hwChangeKinds(base, with_({ body: base.body.replace("письменно", "письмено") })), []);
  assert.deepEqual(hwChangeKinds(base, with_({ body: base.body.replace("паре.", "паре") })), []);
  assert.deepEqual(hwChangeKinds(base, with_({ body: base.body.toUpperCase() })), []);
  assert.deepEqual(hwChangeKinds(base, with_({ body: `  ${base.body.replace(/ /g, "  ")}  ` })), []);
  assert.equal(isSubstantialHwChange(base, base), false);
});

test("замена слова, новое предложение, заголовок — существенно", () => {
  assert.deepEqual(hwChangeKinds(base, with_({ body: base.body.replace("письменно", "устно у доски") })), ["text"]);
  assert.deepEqual(hwChangeKinds(base, with_({ body: `${base.body} Принести распечатку.` })), ["text"]);
  assert.deepEqual(hwChangeKinds(base, with_({ title: "Контрольная" })), ["text"]);
  // Короткий заголовок: три буквы в разнице — опечатка, если цифр нет.
  assert.deepEqual(hwChangeKinds(with_({ title: "Контрольная" }), with_({ title: "Контрольнаяя" })), []);
});

test("цифры существенны всегда: другой номер задачи — другое задание", () => {
  assert.deepEqual(hwChangeKinds(base, with_({ body: base.body.replace("220", "230") })), ["text"]);
  assert.deepEqual(hwChangeKinds(base, with_({ body: base.body.replace("стр. 48", "стр. 84") })), ["text"]);
});

test("предмет и дедлайн — существенно, и в описании перечисляются по-русски", () => {
  assert.deepEqual(hwChangeKinds(base, with_({ dueDate: "2026-09-12" })), ["dueDate"]);
  assert.deepEqual(hwChangeKinds(base, with_({ subjectId: "e" })), ["subject"]);
  assert.deepEqual(hwChangeKinds(base, with_({ subjectId: null, dueDate: "2026-09-18", body: "Совсем другое задание" })), ["subject", "dueDate", "text"]);
  assert.equal(describeHwChanges([]), "");
  assert.equal(describeHwChanges(["dueDate"]), "дедлайн");
  assert.equal(describeHwChanges(["dueDate", "text"]), "дедлайн и текст");
  assert.equal(describeHwChanges(["subject", "dueDate", "text"]), "предмет, дедлайн и текст");
});
