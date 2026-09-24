import { test } from "node:test";
import assert from "node:assert/strict";
import { fitRaw } from "./extract-fit";
import { cellStyles, columnIndex, readPptx, readXlsx, sharedStrings, sheetOrder, sheetText, slideText } from "./extract-xml";
import { memorySource } from "./extract-zip";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const slide = (...shapes: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree>${shapes.join("")}</p:spTree></p:cSld></p:sld>`;
const shape = (...paragraphs: string[]) => `<p:sp><p:txBody><a:bodyPr/>${paragraphs.join("")}</p:txBody></p:sp>`;
const para = (...runs: string[]) => `<a:p>${runs.map((r) => (r === "<br>" ? "<a:br/>" : `<a:r><a:rPr lang="ru-RU"/><a:t>${r}</a:t></a:r>`)).join("")}</a:p>`;
const table = (rows: string[][]) =>
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblGrid/>${rows
    .map((r) => `<a:tr h="1">${r.map((c) => `<a:tc><a:txBody><a:bodyPr/>${c ? para(c) : "<a:p><a:endParaRPr/></a:p>"}</a:txBody></a:tc>`).join("")}</a:tr>`)
    .join("")}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const smartArt = (rid: string) =>
  `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" r:dm="${rid}" r:lo="rId3" r:qs="rId4" r:cs="rId5"/></a:graphicData></a:graphic></p:graphicFrame>`;

test("slideText: абзацы построчно, прогоны склеиваются с пробелами как есть, a:br — перевод строки", () => {
  const xml = slide(shape(para("Тема: ", "Эластичность"), para(), para("Спрос ", "<br>", "Предложение"), para("P &amp; Q &lt; 10")));
  assert.equal(slideText(xml), "Тема: Эластичность\nСпрос\nПредложение\nP & Q < 10");
});

test("slideText: таблица — строки через « | », пустые ячейки сохраняются; поле (номер слайда) — тоже текст", () => {
  const xml = slide(
    table([
      ["Дата", "Тема", "Балл"],
      ["01.10", "", "5"],
      ["08.10", "Инфляция", ""],
      ["", "", ""],
    ]),
    shape(`<a:p><a:fld id="{1}" type="slidenum"><a:t>7</a:t></a:fld></a:p>`),
  );
  assert.equal(slideText(xml), "Дата | Тема | Балл\n01.10 |  | 5\n08.10 | Инфляция | \n7");
});

test("slideText: mc:Fallback пропускается — текст не задваивается", () => {
  const xml = slide(
    `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="a14">${shape(para("Формула"))}</mc:Choice><mc:Fallback>${shape(para("Формула"))}</mc:Fallback></mc:AlternateContent>`,
  );
  assert.equal(slideText(xml), "Формула");
});

test("readPptx: по номеру файла (slide10 после slide2), метка — порядковый номер, пустой слайд пропущен, но посчитан", async () => {
  const files = {
    "ppt/slides/slide10.xml": slide(shape(para("Десятый"))),
    "ppt/slides/slide2.xml": slide(shape(para("Второй"))),
    "ppt/slides/slide1.xml": slide(shape(para("Первый"))),
    "ppt/slides/slide3.xml": slide(),
    "ppt/slides/_rels/slide1.xml.rels": "<Relationships/>",
    "ppt/notesSlides/notesSlide1.xml": slide(shape(para("Заметки докладчика"))),
  };
  const raw = await readPptx(memorySource(files), 30_000);
  assert.equal(raw.kind, "sections");
  if (raw.kind !== "sections") return;
  assert.deepEqual(
    raw.sections.map((s) => [s.label, s.text]),
    [
      ["Слайд 1", "Первый"],
      ["Слайд 2", "Второй"],
      ["Слайд 4", "Десятый"],
    ],
  );
  assert.equal(raw.total, 4);
  assert.equal(raw.read, 4);
  assert.deepEqual(fitRaw(raw, 30_000).truncated, false);
});

const DIAGRAM_DATA = `<?xml version="1.0"?><dgm:dataModel xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><dgm:ptLst>
<dgm:pt modelId="{0}" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:endParaRPr lang="ru-RU"/></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{1}"><dgm:prSet phldrT="[Текст]"/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>Планирование</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{2}"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:r><a:t>Исполнение</a:t></a:r></a:p></dgm:t></dgm:pt>
<dgm:pt modelId="{3}" type="parTrans"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt>
</dgm:ptLst></dgm:dataModel>`;

test("readPptx: SmartArt — текст из ppt/diagrams/dataN.xml через slideN.xml.rels; без данных — пометка «схема не прочитана»", async () => {
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data1.xml"/>
<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/diagramData" Target="../diagrams/data9.xml"/>
</Relationships>`;
  const files = {
    "ppt/slides/slide1.xml": slide(shape(para("Этапы процесса")), smartArt("rId2")),
    "ppt/slides/_rels/slide1.xml.rels": rels,
    "ppt/diagrams/data1.xml": DIAGRAM_DATA,
    // Второй слайд — одна схема, чьих данных в архиве нет.
    "ppt/slides/slide2.xml": slide(smartArt("rId9")),
    "ppt/slides/_rels/slide2.xml.rels": rels,
    "ppt/slides/slide3.xml": slide(
      `<p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></p:graphicFrame>`,
    ),
  };
  const raw = await readPptx(memorySource(files), 30_000);
  assert.equal(raw.kind, "sections");
  if (raw.kind !== "sections") return;
  assert.deepEqual(
    raw.sections.map((s) => s.text),
    ["Этапы процесса\nПланирование\nИсполнение", "[на слайде 2 схема — её текст не прочитан]", "[на слайде 3 диаграмма — её данные не прочитаны]"],
  );
});

test("readPptx: останавливается по бюджету, остальные слайды — в «показаны первые N из M»", async () => {
  const files: Record<string, string> = {};
  for (let i = 1; i <= 50; i++) files[`ppt/slides/slide${i}.xml`] = slide(shape(para(`Слайд номер ${i} `.repeat(30))));
  const raw = await readPptx(memorySource(files), 2000);
  assert.equal(raw.kind, "sections");
  if (raw.kind !== "sections") return;
  assert.ok(raw.read < 10, `прочитано ${raw.read} слайдов`);
  assert.equal(raw.total, 50);
  const r = fitRaw(raw, 2000);
  assert.equal(r.truncated, true);
  assert.match(r.note ?? "", /^документ обрезан, показаны первые \d из 50 слайдов$/);
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

const STYLES = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy;@"/><numFmt numFmtId="165" formatCode="[$-F400]h:mm:ss\\ AM/PM"/></numFmts>
<cellStyleXfs count="1"><xf numFmtId="14"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/><xf numFmtId="20"/><xf numFmtId="9"/><xf numFmtId="164"/><xf numFmtId="10"/><xf numFmtId="165"/></cellXfs>
</styleSheet>`;

test("sheetText: даты, время и проценты по стилю ячейки; плавающий шум округлён", () => {
  const xml = sheet(
    `<row r="1"><c r="A1" s="1"><v>46289</v></c><c r="B1" s="2"><v>0.375</v></c><c r="C1"><v>0.30000000000000004</v></c><c r="D1" s="3"><v>0.85</v></c></row>` +
      `<row r="2"><c r="A2" s="4"><v>45567</v></c><c r="B2" s="5"><v>0.12345</v></c><c r="C2" s="6"><v>0.5625</v></c><c r="D2" s="0"><v>20231234567</v></c></row>`,
  );
  assert.equal(sheetText(xml, [], cellStyles(STYLES)), ["24.09.2026\t9:00\t0.3\t85 %", "02.10.2024\t12.35 %\t13:30:00\t20231234567"].join("\n"));
  // Та же книга в системе 1904 (старые файлы с Mac): день 0 — 01.01.1904.
  assert.equal(sheetText(sheet(`<row r="1"><c r="A1" s="1"><v>44827</v></c></row>`), [], cellStyles(STYLES), true), "24.09.2026");
});

const WORKBOOK = `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="1"/><sheets>
<sheet name="Оценки" sheetId="1" r:id="rId2"/><sheet name="Служебный" sheetId="2" state="hidden" r:id="rId3"/><sheet name="Посещаемость" sheetId="3" r:id="rId1"/>
</sheets></workbook>`;
const RELS = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>`;

test("sheetOrder: порядок вкладок, файл через rels (относительный и абсолютный Target), скрытые и отсутствующие пропущены", () => {
  const sheets = [
    { name: "Оценки", rid: "rId2", hidden: false },
    { name: "Служебный", rid: "rId3", hidden: true },
    { name: "Посещаемость", rid: "rId1", hidden: false },
  ];
  const rels = new Map([
    ["rId1", "xl/worksheets/sheet3.xml"],
    ["rId2", "xl/worksheets/sheet1.xml"],
    ["rId3", "xl/worksheets/sheet2.xml"],
  ]);
  assert.deepEqual(sheetOrder(sheets, rels, ["xl/worksheets/sheet3.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]), [
    { label: "Лист 1: Оценки", path: "xl/worksheets/sheet1.xml" },
    { label: "Лист 2: Посещаемость", path: "xl/worksheets/sheet3.xml" },
  ]);
  // Без rels — i-я вкладка = sheet{i+1}.xml.
  assert.deepEqual(
    sheetOrder(sheets, new Map(), ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet3.xml"]).map((s) => s.path),
    ["xl/worksheets/sheet1.xml", "xl/worksheets/sheet3.xml"],
  );
  // Без workbook.xml — по номерам файлов.
  assert.deepEqual(sheetOrder([], new Map(), ["xl/worksheets/sheet2.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]), [
    { label: "Лист 1", path: "xl/worksheets/sheet1.xml" },
    { label: "Лист 2", path: "xl/worksheets/sheet2.xml" },
  ]);
});

test("readXlsx: метки с именами листов, date1904 из workbook.xml, стили; скрытый лист не читается", async () => {
  const files = {
    "xl/workbook.xml": WORKBOOK,
    "xl/_rels/workbook.xml.rels": RELS,
    "xl/sharedStrings.xml": SST,
    "xl/styles.xml": STYLES,
    "xl/worksheets/sheet1.xml": sheet(`<row r="1"><c r="A1" t="s"><v>2</v></c><c r="B1" s="1"><v>44827</v></c></row>`),
    "xl/worksheets/sheet2.xml": sheet(`<row r="1"><c r="A1"><v>секрет</v></c></row>`),
    "xl/worksheets/sheet3.xml": sheet(`<row r="1"><c r="A1" t="s"><v>3</v></c></row>`),
  };
  const r = fitRaw(await readXlsx(memorySource(files), 30_000), 30_000);
  assert.deepEqual(r, { text: "— Лист 1: Оценки —\nИванов И.\t24.09.2026\n\n— Лист 2: Посещаемость —\nПетров", truncated: false });
});

test("readXlsx: пустые листы просмотрены, но не делают документ «обрезанным»", async () => {
  const files = {
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="Оценки" r:id="rId1"/><sheet name="Лист2" r:id="rId2"/><sheet name="Лист3" r:id="rId3"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>Иванов</t></is></c><c r="B1"><v>5</v></c></row>`),
    "xl/worksheets/sheet2.xml": sheet(""),
    "xl/worksheets/sheet3.xml": sheet(`<row r="3" spans="1:3"/>`),
  };
  const r = fitRaw(await readXlsx(memorySource(files), 30_000), 30_000);
  assert.deepEqual(r, { text: "— Лист 1: Оценки —\nИванов\t5", truncated: false });
});

test("readXlsx: книга без данных — пометка, а не пустой текст", async () => {
  const r = fitRaw(await readXlsx(memorySource({ "xl/worksheets/sheet1.xml": sheet("") }), 30_000), 30_000);
  assert.deepEqual(r, { text: "", truncated: false, note: "в таблице нет данных — пришли фото или другой файл" });
});

test("readXlsx: большой лист останавливается по бюджету, следующие листы не читаются", async () => {
  const rows = Array.from({ length: 5000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Строка ${i + 1}</t></is></c></row>`).join("");
  const files = {
    "xl/worksheets/sheet1.xml": sheet(rows),
    "xl/worksheets/sheet2.xml": sheet(rows),
  };
  const raw = await readXlsx(memorySource(files), 1000);
  assert.equal(raw.kind, "sections");
  if (raw.kind !== "sections") return;
  assert.equal(raw.read, 1);
  assert.ok(raw.sections[0].text.length < 1100);
  const r = fitRaw(raw, 1000);
  assert.equal(r.note, "документ обрезан, показаны первые 1 из 2 листов");
});

test("бюджет посреди огромной ячейки или абзаца слайда: накопленное отдаётся, разбор останавливается", async () => {
  const cell = await readXlsx(
    memorySource({ "xl/worksheets/sheet1.xml": sheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>${"я".repeat(100_000)}</t></is></c></row><row r="2"><c r="A2"><v>2</v></c></row>`) }),
    1000,
  );
  assert.equal(cell.kind, "sections");
  if (cell.kind === "sections") assert.ok(cell.sections[0].text.startsWith("яяя") && cell.sections[0].text.length < 70_000);
  const slideRaw = await readPptx(memorySource({ "ppt/slides/slide1.xml": slide(shape(para("слово ".repeat(100_000)))) }), 1000);
  assert.equal(slideRaw.kind, "sections");
  if (slideRaw.kind === "sections") assert.ok(slideRaw.sections[0].text.startsWith("слово слово") && slideRaw.sections[0].text.length < 70_000);
});
