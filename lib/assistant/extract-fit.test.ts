import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPlain, fitPlain, fitRaw, fitSections } from "./extract-fit";

test("fitSections: всё влезает — без пометки; заголовки разделов через тире", () => {
  const r = fitSections(
    [
      { label: "Слайд 1", text: "А" },
      { label: "Слайд 2", text: "Б" },
    ],
    1000,
    "slides",
  );
  assert.deepEqual(r, { text: "— Слайд 1 —\nА\n\n— Слайд 2 —\nБ", truncated: false });
  // Одна страница PDF — без заголовка «Страница 1».
  assert.deepEqual(fitSections([{ label: "Страница 1", text: "текст" }], 1000, "pages"), { text: "текст", truncated: false });
});

test("fitSections: обрезка по разделам с пометкой «показаны первые N из M» в родительном падеже", () => {
  const pages = Array.from({ length: 21 }, (_, i) => ({ label: `Страница ${i + 1}`, n: i + 1, text: "слово ".repeat(100).trim() }));
  const r = fitSections(pages, 2000, "pages");
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= 2000);
  const shown = (r.text.match(/— Страница \d+ —/g) ?? []).length;
  assert.equal(r.note, `документ обрезан, показаны первые ${shown} из 21 страницы`);
  assert.ok(shown >= 3 && shown < 21);

  const sheets = Array.from({ length: 5 }, (_, i) => ({ label: `Лист ${i + 1}`, text: "x".repeat(900) }));
  assert.equal(fitSections(sheets, 1000, "sheets").note, "документ обрезан, показаны первые 1 из 5 листов");
});

test("fitSections: огромный первый раздел — показывается его начало", () => {
  const r = fitSections([{ label: "Лист 1", text: "строка\n".repeat(10_000) }], 500, "sheets");
  assert.equal(r.truncated, true);
  assert.ok(r.text.startsWith("— Лист 1 —\nстрока"));
  assert.ok(r.text.length <= 500);
  assert.equal(r.note, "документ обрезан, показано только начало");
});

test("fitSections: «первые N» — номер последнего показанного раздела, пустые страницы между ними тоже считаются", () => {
  // 40 страниц, чётные пустые, прочитаны первые 25 (бюджет набран) — показаны страницы 1…25, а не «13 из 28».
  const odd = Array.from({ length: 13 }, (_, i) => ({ label: `Страница ${2 * i + 1}`, n: 2 * i + 1, text: "а" }));
  const r = fitSections(odd, 30_000, "pages", 40, 25);
  assert.equal(r.truncated, true);
  assert.equal(r.note, "документ обрезан, показаны первые 25 из 40 страниц");

  const one = fitSections([{ label: "Страница 1", n: 1, text: "а" }], 1000, "pages", 40, 1);
  assert.equal(one.text, "— Страница 1 —\nа");
  assert.equal(one.note, "документ обрезан, показаны первые 1 из 40 страниц");
});

test("fitSections: последний раздел влез частично — так и сказано, без «первые 3 из 3»", () => {
  const sheets = [
    { label: "Лист 1", n: 1, text: "а" },
    { label: "Лист 2", n: 2, text: "б" },
    { label: "Лист 3", n: 3, text: "x".repeat(2000) },
  ];
  assert.equal(fitSections(sheets, 1000, "sheets").note, "документ обрезан: из 3 листов последний показан не целиком");
});

test("cleanPlain: табуляции сохраняются, пробелы, отступы и лишние пустые строки схлопываются", () => {
  assert.equal(cleanPlain("a\t b  c \r\n\r\n\r\n\r\nd"), "a\t b c\n\nd");
  assert.equal(cleanPlain("  отступ\n хвост  "), "отступ\nхвост");
});

test("fitPlain: пробелы не трогает (пустая ячейка таблицы), недочитанный документ — «только начало»", () => {
  assert.deepEqual(fitPlain("08.10 |  | Петров", 100), { text: "08.10 |  | Петров", truncated: false });
  assert.deepEqual(fitPlain("x".repeat(50), 100, false), { text: "x".repeat(50), truncated: true, note: "документ обрезан, показано только начало — первые 50 символов" });
  const r = fitPlain("слово ".repeat(100).trim(), 100);
  assert.equal(r.truncated, true);
  assert.match(r.note ?? "", /^документ обрезан, показаны первые \d+ из 599 символов$/);
});

test("fitRaw: пометки о недочитанном добавляются к пометке об обрезке", () => {
  assert.deepEqual(fitRaw({ kind: "none" }, 100), { text: "", truncated: false });
  assert.deepEqual(fitRaw({ kind: "none", note: "скан" }, 100), { text: "", truncated: false, note: "скан" });
  const r = fitRaw({ kind: "sections", sections: [{ label: "Лист 1", n: 1, text: "а" }], unit: "sheets", total: 3, read: 1, notes: ["часть файла не прочитана"] }, 100);
  assert.equal(r.note, "документ обрезан, показаны первые 1 из 3 листов; часть файла не прочитана");
  assert.deepEqual(fitRaw({ kind: "plain", text: "всё", complete: true, notes: ["сканы"] }, 100), { text: "всё", truncated: false, note: "сканы" });
});
