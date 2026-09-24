import { test } from "node:test";
import assert from "node:assert/strict";
import { documentText, listNumbering, readDocx } from "./extract-docx";
import { fitRaw } from "./extract-fit";
import { memorySource } from "./extract-zip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const doc = (...body: string[]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join("")}<w:sectPr/></w:body></w:document>`;
const run = (t: string) => `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${t}</w:t></w:r>`;
const p = (...runs: string[]) => `<w:p><w:pPr><w:pStyle w:val="a"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.join("")}</w:p>`;
const li = (numId: number, ilvl: number, text: string) =>
  `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${run(text)}</w:p>`;
const tc = (text: string, span = 1) => `<w:tc><w:tcPr><w:tcW w:w="100"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ""}</w:tcPr>${text ? p(run(text)) : "<w:p/>"}</w:tc>`;
const tr = (...cells: string[]) => `<w:tr><w:trPr/>${cells.join("")}</w:tr>`;
const tbl = (...rows: string[]) => `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol/></w:tblGrid>${rows.join("")}</w:tbl>`;

const NUMBERING = `<?xml version="1.0"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl>
  <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="russianLower"/><w:lvlText w:val="%3)"/></w:lvl>
</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="2"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="upperRoman"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
<w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
<w:num w:numId="4"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

test("DOCX: автонумерация по numbering.xml — «N.», вложенные «1.1.» со сбросом, буквы, маркеры, startOverride", () => {
  const xml = doc(
    p(run("Вопросы к экзамену")),
    li(1, 0, "Понятие спроса"),
    li(1, 0, "Эластичность"),
    p(run("Пояснение к вопросу 2 отдельным абзацем.")),
    li(1, 1, "Ценовая"),
    li(1, 2, "точечная"),
    li(1, 2, "дуговая"),
    li(1, 1, "Перекрёстная"),
    li(1, 0, "Инфляция"),
    li(1, 1, "Виды"),
    li(2, 0, "маркер"),
    li(3, 0, "с пятого"),
    li(4, 0, "Раздел"),
    li(4, 0, "Раздел"),
    li(0, 0, "нумерация снята"),
  );
  assert.equal(
    documentText(xml, listNumbering(NUMBERING)),
    [
      "Вопросы к экзамену",
      "1. Понятие спроса",
      "2. Эластичность",
      "Пояснение к вопросу 2 отдельным абзацем.",
      "2.1. Ценовая",
      "а) точечная",
      "б) дуговая",
      "2.2. Перекрёстная",
      "3. Инфляция",
      "3.1. Виды",
      "• маркер",
      "5. с пятого",
      "I. Раздел",
      "II. Раздел",
      "нумерация снята",
    ].join("\n"),
  );
});

test("DOCX: нумерация из стиля — заголовки курсовой через w:lvl/w:pStyle и «Нумерованный список» через basedOn", () => {
  const numbering = `<w:numbering ${W}>
<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="1"/><w:lvlText w:val="%1"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="2"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum>
<w:abstractNum w:abstractNumId="8"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum>
<w:num w:numId="5"><w:abstractNumId w:val="7"/></w:num><w:num w:numId="6"><w:abstractNumId w:val="8"/></w:num></w:numbering>`;
  const styles = `<w:styles ${W}><w:docDefaults><w:pPrDefault><w:pPr/></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:styleId="1"><w:name w:val="heading 1"/><w:pPr><w:numPr><w:numId w:val="5"/></w:numPr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="2"><w:name w:val="heading 2"/><w:basedOn w:val="1"/><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:pPr><w:numPr><w:numId w:val="6"/></w:numPr></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="MyList"><w:basedOn w:val="ListNumber"/></w:style>
<w:style w:type="character" w:styleId="1Char"><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const styled = (style: string, text: string) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${run(text)}</w:p>`;
  const xml = doc(styled("1", "Введение"), styled("2", "Актуальность"), styled("1", "Теория"), styled("2", "Спрос"), styled("2", "Предложение"), p(run("Текст")), styled("MyList", "первый"), styled("MyList", "второй"));
  assert.equal(documentText(xml, listNumbering(numbering), styles), ["1 Введение", "1.1 Актуальность", "2 Теория", "2.1 Спрос", "2.2 Предложение", "Текст", "1) первый", "2) второй"].join("\n"));
});

test("DOCX: без numbering.xml формат неизвестен — маркер «•», а не выдуманный номер", () => {
  assert.equal(documentText(doc(li(7, 0, "а"), li(7, 0, "б"), li(8, 0, "в"))), "• а\n• б\n• в");
  // Неизвестный numId в известной нумерации — тоже маркер, а не падение.
  assert.equal(documentText(doc(li(9, 0, "x")), listNumbering(NUMBERING)), "• x");
});

test("DOCX: таблица — строки через « | », пустые ячейки на месте, объединённая ячейка добавляет пустые", () => {
  const xml = doc(
    p(run("Расписание консультаций")),
    tbl(tr(tc("Дата"), tc("Тема"), tc("Преподаватель")), tr(tc("01.10"), tc("Спрос"), tc("")), tr(tc("08.10"), tc(""), tc("Петров")), tr(tc("Праздник", 2), tc("—")), tr(tc(""), tc(""), tc(""))),
    p(run("После таблицы")),
  );
  assert.equal(documentText(xml), ["Расписание консультаций", "Дата | Тема | Преподаватель", "01.10 | Спрос | ", "08.10 |  | Петров", "Праздник |  | —", "После таблицы"].join("\n"));
});

test("DOCX: таблица-рамка из одной ячейки не склеивает абзацы; вложенная таблица — строками внутри", () => {
  const inner = tbl(tr(tc("a"), tc("b")));
  const xml = doc(tbl(tr(`<w:tc>${p(run("Первый абзац"))}${p(run("Второй абзац"))}${inner}</w:tc>`)));
  assert.equal(documentText(xml), "Первый абзац\nВторой абзац\na | b");
});

test("DOCX: w:tab — табуляция (но не позиции табуляции в w:pPr), w:br — перевод строки, удалённый текст и mc:Fallback пропущены", () => {
  const xml = doc(
    p(run("Имя"), "<w:r><w:tab/></w:r>", run("Оценка")),
    p(run("строка 1"), "<w:r><w:br/></w:r>", run("строка 2")),
    p(run("Было "), `<w:del w:id="1"><w:r><w:delText>удалено </w:delText></w:r></w:del>`, `<w:ins w:id="2">${run("вставлено")}</w:ins>`),
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><w:txbxContent>${p(run("Надпись"))}</w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${p(run("Надпись"))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r>${run("вокруг")}</w:p>`,
    p(`<w:r><w:instrText> PAGE </w:instrText></w:r>`, run("7")),
    p(),
    p(),
    p(run("после пустых")),
  );
  assert.equal(documentText(xml), "Имя\tОценка\nстрока 1\nстрока 2\nБыло вставлено\nНадпись\nвокруг\n7\n\nпосле пустых");
});

test("readDocx: останавливается по бюджету символов — complete=false и «показано только начало»", async () => {
  const paras = Array.from({ length: 2000 }, (_, i) => p(run(`Абзац номер ${i + 1} с каким-то текстом.`))).join("");
  const raw = await readDocx(memorySource({ "word/document.xml": doc(paras) }), 1000);
  assert.equal(raw.kind, "plain");
  if (raw.kind !== "plain") return;
  assert.equal(raw.complete, false);
  assert.ok(raw.text.length < 1100, `прочитано ${raw.text.length}`);
  const r = fitRaw(raw, 1000);
  assert.equal(r.truncated, true);
  assert.match(r.note ?? "", /^документ обрезан, показано только начало — первые \d+ символов$/);
});

test("readDocx: numbering.xml из архива, пустой документ — пометка", async () => {
  const raw = await readDocx(memorySource({ "word/document.xml": doc(li(1, 0, "первый"), li(1, 0, "второй")), "word/numbering.xml": NUMBERING }), 30_000);
  assert.deepEqual(fitRaw(raw, 30_000), { text: "1. первый\n2. второй", truncated: false });
  assert.deepEqual(fitRaw(await readDocx(memorySource({ "word/document.xml": doc(p()) }), 30_000), 30_000), {
    text: "",
    truncated: false,
    note: "в документе нет текста — пришли фото страниц",
  });
});

test("readDocx: бюджет набран посреди огромного абзаца или таблицы-рамки — накопленное не теряется", async () => {
  const huge = await readDocx(memorySource({ "word/document.xml": doc(p(run("ха ".repeat(100_000)))) }), 1000);
  assert.equal(huge.kind, "plain");
  if (huge.kind === "plain") {
    assert.equal(huge.complete, false);
    assert.ok(huge.text.startsWith("ха ха") && huge.text.length >= 1000 && huge.text.length < 70_000, `длина ${huge.text.length}`);
  }
  const frame = Array.from({ length: 500 }, (_, i) => p(run(`Абзац ${i + 1} внутри рамки.`))).join("");
  const framed = await readDocx(memorySource({ "word/document.xml": doc(tbl(tr(`<w:tc>${frame}</w:tc>`))) }), 1000);
  assert.equal(framed.kind, "plain");
  if (framed.kind === "plain") {
    assert.equal(framed.complete, false);
    assert.ok(framed.text.startsWith("Абзац 1 внутри рамки.\nАбзац 2 внутри рамки."), framed.text.slice(0, 60));
  }
});
