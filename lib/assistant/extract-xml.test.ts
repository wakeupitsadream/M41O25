import { test } from "node:test";
import assert from "node:assert/strict";
import { clipXml, columnIndex, fitSections, sharedStrings, sheetOrder, sheetText, slideText, slidesText, workbookSheets, workbookText } from "./extract-xml";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const slide = (...paragraphs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/>${paragraphs.join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const para = (...runs: string[]) => `<a:p>${runs.map((r) => (r === "<br>" ? "<a:br/>" : `<a:r><a:rPr lang="ru-RU"/><a:t>${r}</a:t></a:r>`)).join("")}</a:p>`;

test("slideText: абзацы построчно, прогоны склеиваются с пробелами как есть, a:br — перевод строки", () => {
  const xml = slide(para("Тема: ", "Эластичность"), para(), para("Спрос ", "<br>", "Предложение"), para("P &amp; Q &lt; 10"));
  assert.equal(slideText(xml), "Тема: Эластичность\nСпрос\nПредложение\nP & Q < 10");
});

test("slidesText: по номеру файла (slide10 после slide2), метка — порядковый номер, пустой слайд пропущен", () => {
  const files = {
    "ppt/slides/slide10.xml": slide(para("Десятый")),
    "ppt/slides/slide2.xml": slide(para("Второй")),
    "ppt/slides/slide1.xml": slide(para("Первый")),
    "ppt/slides/slide3.xml": slide(),
    "ppt/slides/_rels/slide1.xml.rels": "<Relationships/>",
    "ppt/notesSlides/notesSlide1.xml": slide(para("Заметки докладчика")),
  };
  assert.deepEqual(slidesText(files), [
    { label: "Слайд 1", text: "Первый" },
    { label: "Слайд 2", text: "Второй" },
    { label: "Слайд 4", text: "Десятый" },
  ]);
});

test("slideText: таблица на слайде — каждая ячейка своей строкой, поле (номер слайда) тоже текст", () => {
  const xml = slide(
    `<a:tbl><a:tr><a:tc><a:txBody>${para("Год")}</a:txBody></a:tc><a:tc><a:txBody>${para("ВВП")}</a:txBody></a:tc></a:tr></a:tbl>`,
    `<a:p><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p>`,
  );
  assert.equal(slideText(xml), "Год\nВВП\n7");
});

const SST = `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
<si><t>Фамилия</t></si>
<si><t xml:space="preserve">Оценка </t></si>
<si><r><rPr><b/></rPr><t>Иванов</t></r><r><t xml:space="preserve"> И.</t></r></si>
<si><t>Петров</t><rPh sb="0" eb="1"><t>ペ</t></rPh></si>
</sst>`;

test("sharedStrings: простые, форматированные прогоны склеиваются, фонетика выброшена", () => {
  assert.deepEqual(sharedStrings(SST), ["Фамилия", "Оценка ", "Иванов И.", "Петров"]);
  assert.deepEqual(sharedStrings(undefined), []);
});

test("columnIndex: буквы колонки → номер с нуля", () => {
  assert.equal(columnIndex("A1"), 0);
  assert.equal(columnIndex("C5"), 2);
  assert.equal(columnIndex("Z9"), 25);
  assert.equal(columnIndex("AA10"), 26);
  assert.equal(columnIndex("BC12"), 54);
  assert.equal(columnIndex(null), null);
  assert.equal(columnIndex("12"), null);
});

const sheet = (rows: string) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`;

test("sheetText: общие строки, числа, inlineStr, булевы, формулы; пропуски колонок сохраняют позиции", () => {
  const xml = sheet(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>5</v></c><c r="D2" t="inlineStr"><is><t>сдал</t></is></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" t="str"><f>A1</f><v>4.5</v></c><c r="C3" t="b"><v>1</v></c><c r="E3" s="1"/></row>` +
      `<row r="4"><c r="A4" s="2"/></row>` +
      `<row r="5"><c r="B5" t="e"><v>#DIV/0!</v></c></row>`,
  );
  assert.equal(sheetText(xml, sharedStrings(SST)), ["Фамилия\tОценка", "Иванов И.\t5\t\tсдал", "Петров\t4.5\tИСТИНА", "\t#DIV/0!"].join("\n"));
});

test("sheetText: префикс x:, неизвестный индекс общей строки, табуляция внутри ячейки", () => {
  const xml = `<x:worksheet xmlns:x="u"><x:sheetData><x:row r="1"><x:c r="A1" t="s"><x:v>99</x:v></x:c><x:c r="B1" t="inlineStr"><x:is><x:t>a\tb</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`;
  assert.equal(sheetText(xml, []), "\ta b");
});

test("sheetText: далёкая колонка не даёт тысячи табуляций", () => {
  const xml = sheet(`<row r="1"><c r="A1"><v>1</v></c><c r="XFD1"><v>2</v></c></row>`);
  const line = sheetText(xml, []);
  assert.ok(line.startsWith("1\t"));
  assert.ok(line.endsWith("\t2"));
  assert.ok(line.split("\t").length <= 32);
});

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
<sheet name="Оценки" sheetId="1" r:id="rId2"/><sheet name="Служебный" sheetId="2" state="hidden" r:id="rId3"/><sheet name="Посещаемость" sheetId="3" r:id="rId1"/>
</sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

test("workbookSheets: порядок вкладок, файл через rels (относительный и абсолютный Target), скрытые пропущены", () => {
  assert.deepEqual(workbookSheets(WORKBOOK, RELS), [
    { name: "Оценки", path: "xl/worksheets/sheet1.xml" },
    { name: "Посещаемость", path: "xl/worksheets/sheet3.xml" },
  ]);
  // Без rels — i-я вкладка = sheet{i+1}.xml.
  assert.deepEqual(
    workbookSheets(WORKBOOK, undefined).map((s) => s.path),
    ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet3.xml"],
  );
});

test("workbookText: метки с именами листов, пустой лист пропущен; без workbook.xml — по номерам файлов", () => {
  const files = {
    "xl/workbook.xml": WORKBOOK,
    "xl/_rels/workbook.xml.rels": RELS,
    "xl/sharedStrings.xml": SST,
    "xl/worksheets/sheet1.xml": sheet(`<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1"><v>5</v></c></row>`),
    "xl/worksheets/sheet2.xml": sheet(`<row r="1"><c r="A1"><v>секрет</v></c></row>`),
    "xl/worksheets/sheet3.xml": sheet(""),
  };
  assert.deepEqual(workbookText(files), [{ label: "Лист 1: Оценки", text: "Иванов И.\t5" }]);

  const bare = {
    "xl/worksheets/sheet10.xml": sheet(`<row r="1"><c r="A1"><v>10</v></c></row>`),
    "xl/worksheets/sheet2.xml": sheet(`<row r="1"><c r="A1"><v>2</v></c></row>`),
  };
  assert.deepEqual(workbookText(bare), [
    { label: "Лист 1", text: "2" },
    { label: "Лист 2", text: "10" },
  ]);
});

test("clipXml: обрезка по последнему закрытому элементу, парсер принимает незакрытый хвост", () => {
  const rows = Array.from({ length: 50 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i + 1}</v></c></row>`).join("");
  const xml = sheet(rows);
  const clipped = clipXml(xml, 400, "row");
  assert.ok(clipped.length <= 400);
  assert.ok(clipped.endsWith("</row>"));
  const lines = sheetText(clipped, []).split("\n");
  assert.ok(lines.length > 3 && lines.length < 50);
  assert.deepEqual(lines.slice(0, 3), ["1", "2", "3"]);
  assert.equal(clipXml(xml, xml.length, "row"), xml);
  assert.equal(clipXml("<a><b>очень длинный текст без закрытых row</b></a>", 10, "row"), "");
});

test("parseXml: DOCTYPE с сущностями вырезается, текст не раздувается", () => {
  const evil = `<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>` + slide(para("&b;"), para("норм"));
  const text = slideText(evil);
  assert.ok(text.includes("норм"));
  assert.ok(!text.includes("aaaaaaaaaa"));
});

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
  const pages = Array.from({ length: 21 }, (_, i) => ({ label: `Страница ${i + 1}`, text: "слово ".repeat(100).trim() }));
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

test("fitSections: прочитано меньше разделов, чем в документе (PDF бросили на полпути) — пометка с общим числом", () => {
  const r = fitSections([{ label: "Страница 1", text: "а" }], 1000, "pages", 40);
  assert.equal(r.truncated, true);
  assert.equal(r.text, "— Страница 1 —\nа");
  assert.equal(r.note, "документ обрезан, показаны первые 1 из 40 страниц");
});

test("sheetOrder: только листы, которые есть в архиве; метки по порядку вкладок", () => {
  const files = { "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": RELS };
  assert.deepEqual(sheetOrder(files, ["xl/worksheets/sheet3.xml", "xl/worksheets/sheet1.xml"]), [
    { label: "Лист 1: Оценки", path: "xl/worksheets/sheet1.xml" },
    { label: "Лист 2: Посещаемость", path: "xl/worksheets/sheet3.xml" },
  ]);
  assert.deepEqual(sheetOrder({}, ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]), [
    { label: "Лист 1", path: "xl/worksheets/sheet1.xml" },
    { label: "Лист 2", path: "xl/worksheets/sheet2.xml" },
  ]);
});
