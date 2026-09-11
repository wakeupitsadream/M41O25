import { test } from "node:test";
import assert from "node:assert/strict";
import { describeHwChanges, editDistance, hwChangeKinds, isSubstantialHwChange, normalizeHwText, shouldNotifyDueMoved, TYPO_EDIT_DISTANCE, type HwEssentials } from "./changes";

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

test("исчезнувшее отрицание — существенная правка, даже если правка короткая", () => {
  const hw = (body: string) => ({ title: null, body, dueDate: "2026-09-14", subjectId: null });
  assert.deepEqual(hwChangeKinds(hw("Задачу 5 сдавать не нужно"), hw("Задачу 5 сдавать нужно")), ["text"]);
  assert.deepEqual(hwChangeKinds(hw("Конспект нужен"), hw("Конспект не нужен")), ["text"]);
  // Обычная опечатка того же размера по-прежнему не событие.
  assert.deepEqual(hwChangeKinds(hw("Прочитать параграф"), hw("Прочитать параграф")), []);
});

// --- Кого будить пушем после правки (shouldNotifyDueMoved) ---

const TODAY = "2026-09-11";
/** Как это считает updateHomework: сначала что изменилось, потом — будить ли группу. */
const wouldPush = (before: HwEssentials, after: HwEssentials, today = TODAY) => shouldNotifyDueMoved(hwChangeKinds(before, after), after.dueDate, today);

test("пуш после правки: только правка текста или предмета группу не будит", () => {
  assert.equal(wouldPush(base, with_({ body: base.body.replace("письменно", "устно у доски") })), false);
  assert.equal(wouldPush(base, with_({ title: "Контрольная" })), false);
  assert.equal(wouldPush(base, with_({ subjectId: "e" })), false);
  // Правка ни на что не повлияла — тем более молчим.
  assert.equal(wouldPush(base, base), false);
});

test("пуш после правки: сдвинутый дедлайн будит, в том числе вместе с текстом", () => {
  assert.equal(wouldPush(base, with_({ dueDate: "2026-09-18" })), true);
  assert.equal(wouldPush(base, with_({ dueDate: "2026-09-18", body: "Совсем другое задание" })), true);
  // Перенос на сегодня — тоже новость: дедлайн стал ближе некуда.
  assert.equal(wouldPush(with_({ dueDate: "2026-09-18" }), with_({ dueDate: TODAY })), true);
});

test("пуш после правки: опечатка при том же дедлайне не будит", () => {
  assert.equal(wouldPush(base, with_({ body: base.body.replace("письменно", "письмено") })), false);
  assert.equal(wouldPush(base, with_({ body: base.body.toUpperCase() })), false);
});

test("пуш после правки: перенос в прошлое не будит — это опечатка или уборка старой записи", () => {
  assert.equal(wouldPush(with_({ dueDate: "2026-09-18" }), with_({ dueDate: "2026-09-10" })), false);
  assert.equal(wouldPush(with_({ dueDate: "2026-09-18" }), with_({ dueDate: "2025-12-31" })), false);
  // Дата в прошлом молчит и вместе с существенной правкой текста.
  assert.equal(wouldPush(with_({ dueDate: "2026-09-18" }), with_({ dueDate: "2026-09-01", body: "Совсем другое задание" })), false);
});
