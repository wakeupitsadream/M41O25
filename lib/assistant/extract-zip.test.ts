import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readDocx } from "./extract-docx";
import { fitRaw } from "./extract-fit";
import { readPptx, readXlsx } from "./extract-xml";
import { ArchiveRejected, isCfb, openArchive, resolvePart } from "./extract-zip";
import type { SaxHandler } from "./extract-sax";

const LIMITS = { partBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, deadline: Number.POSITIVE_INFINITY };

async function zip(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const z = new JSZip();
  for (const [name, data] of Object.entries(files)) z.file(name, data);
  return z.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/**
 * Подделка заголовков: записать части name «размер после распаковки» = size и в центральном каталоге, и в
 * локальном заголовке — ровно то, что делает zip-бомба, чтобы пройти проверку по заявленным размерам.
 */
function forgeSize(buf: Buffer, name: string, size: number): Buffer {
  const out = Buffer.from(buf);
  let patched = 0;
  for (let i = 0; i + 46 <= out.length; i++) {
    if (out.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLen = out.readUInt16LE(i + 28);
    if (out.toString("utf8", i + 46, i + 46 + nameLen) !== name) continue;
    out.writeUInt32LE(size, i + 24);
    out.writeUInt32LE(size, out.readUInt32LE(i + 42) + 22);
    patched++;
  }
  assert.equal(patched, 1, `в архиве нет ${name}`);
  return out;
}

const counter = (): SaxHandler & { tags: number } => ({
  tags: 0,
  open() {
    this.tags++;
  },
});

test("zip-бомба с подделанным размером: распаковка упирается в потолок реальных байт, а не в заявленные 1000", async () => {
  // 8 МБ пустых тегов сжимаются в десятки КБ; заявляем 1000 байт.
  const bomb = forgeSize(await zip({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${"<row/>".repeat(1_400_000)}</sheetData></worksheet>` }), "xl/worksheets/sheet1.xml", 1000);
  assert.ok(bomb.length < 200_000, `архив ${bomb.length} байт`);
  const a = await openArchive(bomb, { ...LIMITS, partBytes: 1024 * 1024 });
  const h = counter();
  const r = await a.parse("xl/worksheets/sheet1.xml", h);
  assert.equal(r.complete, false);
  assert.equal(r.cut, "part");
  assert.ok(r.bytes <= 1024 * 1024, `распаковано ${r.bytes}`);
  assert.equal(a.cut, "part");
  assert.ok(h.tags > 100_000 && h.tags < 200_000, `тегов ${h.tags}`);

  // Весь путь XLSX: понятная пометка вместо падения.
  const raw = await readXlsx(await openArchive(bomb, { ...LIMITS, partBytes: 1024 * 1024 }), 30_000);
  assert.deepEqual(fitRaw(raw, 30_000), { text: "", truncated: false, note: "файл после распаковки слишком большой — пришли нужную часть отдельно или фото" });
});

test("общий потолок документа: вторая часть недочитана, хотя каждая по отдельности в потолке части", async () => {
  const part = `<r>${"<c/>".repeat(400_000)}</r>`; // 1,6 МБ
  const a = await openArchive(await zip({ "a.xml": part, "b.xml": part }), { ...LIMITS, partBytes: 2 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 });
  const first = await a.parse("a.xml", counter());
  assert.equal(first.complete, true);
  const second = await a.parse("b.xml", counter());
  assert.equal(second.complete, false);
  assert.equal(second.cut, "total");
  assert.ok(a.used <= 2 * 1024 * 1024);
});

test("архив из тысяч пустых записей (больше 10 000) отвергается до JSZip — каталог не раздувает память", async () => {
  const z = new JSZip();
  for (let i = 0; i <= 10_000; i++) z.file(`ppt/slides/slide${i}.xml`, "");
  const buf = await z.generateAsync({ type: "nodebuffer", compression: "STORE" });
  await assert.rejects(openArchive(buf, LIMITS), ArchiveRejected);
});

test("исключение в обработчике — отказ промиса, а не падение процесса из setImmediate", async () => {
  const a = await openArchive(await zip({ "a.xml": "<r><x/></r>" }), LIMITS);
  await assert.rejects(
    a.parse("a.xml", {
      open(name) {
        if (name === "x") throw new Error("сломанный обработчик");
      },
    }),
    /сломанный обработчик/,
  );
});

test("дедлайн: часть не читается, причина — время", async () => {
  const a = await openArchive(await zip({ "a.xml": "<r/>" }), { ...LIMITS, deadline: Date.now() - 1 });
  const r = await a.parse("a.xml", counter());
  assert.deepEqual([r.complete, r.cut, a.cut, a.timedOut], [false, "time", "time", true]);
});

test("заявленный размер больше настоящего: JSZip ругается в конце, но прочитанное под нашим потолком — настоящее", async () => {
  const buf = forgeSize(await zip({ "a.xml": "<r><t>привет</t></r>" }), "a.xml", 5000);
  const a = await openArchive(buf, LIMITS);
  let text = "";
  const r = await a.parse("a.xml", { text: (s) => (text += s) });
  assert.equal(r.complete, true);
  assert.equal(text, "привет");
});

test("DOCX, собранный jszip: таблица с пустыми ячейками и нумерованный список", async () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const run = (t: string) => `<w:r><w:t>${t}</w:t></w:r>`;
  const li = (t: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(t)}</w:p>`;
  const cell = (t: string) => `<w:tc>${t ? `<w:p>${run(t)}</w:p>` : "<w:p/>"}</w:tc>`;
  const body = [
    `<w:p>${run("Вопросы к экзамену")}</w:p>`,
    li("Понятие спроса"),
    li("Эластичность"),
    `<w:tbl><w:tr>${cell("Дата")}${cell("Тема")}${cell("Преподаватель")}</w:tr><w:tr>${cell("08.10")}${cell("")}${cell("Петров")}</w:tr></w:tbl>`,
  ].join("");
  const buf = await zip({
    "[Content_Types].xml": "<Types/>",
    "_rels/.rels": `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`,
    "word/numbering.xml": `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
  });
  const r = fitRaw(await readDocx(await openArchive(buf, LIMITS), 30_000), 30_000);
  assert.deepEqual(r, { text: "Вопросы к экзамену\n1. Понятие спроса\n2. Эластичность\nДата | Тема | Преподаватель\n08.10 |  | Петров", truncated: false });
});

test("XLSX, собранный jszip: даты, время и проценты по стилям", async () => {
  const buf = await zip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="График" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/styles.xml": `<styleSheet><cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="20"/><xf numFmtId="9"/></cellXfs></styleSheet>`,
    "xl/sharedStrings.xml": `<sst><si><t>Дата</t></si><si><t>Начало</t></si><si><t>Посещаемость</t></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row><row r="2"><c r="A2" s="1"><v>46289</v></c><c r="B2" s="2"><v>0.375</v></c><c r="C2" s="3"><v>0.85</v></c></row></sheetData></worksheet>`,
  });
  const r = fitRaw(await readXlsx(await openArchive(buf, LIMITS), 30_000), 30_000);
  assert.deepEqual(r, { text: "— Лист 1: График —\nДата\tНачало\tПосещаемость\n24.09.2026\t9:00\t85 %", truncated: false });
});

test("PPTX, собранный jszip: SmartArt читается через связи слайда", async () => {
  const buf = await zip({
    "ppt/slides/slide1.xml": `<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Этапы</a:t></a:r></a:p></p:txBody></p:sp><p:graphicFrame><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/diagram"><dgm:relIds xmlns:dgm="d" r:dm="rId2"/></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
    "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="rId2" Target="../diagrams/data1.xml"/></Relationships>`,
    "ppt/diagrams/data1.xml": `<dgm:dataModel xmlns:dgm="d" xmlns:a="a"><dgm:ptLst><dgm:pt><dgm:t><a:p><a:r><a:t>Анализ</a:t></a:r></a:p></dgm:t></dgm:pt><dgm:pt><dgm:t><a:p><a:r><a:t>Синтез</a:t></a:r></a:p></dgm:t></dgm:pt></dgm:ptLst></dgm:dataModel>`,
  });
  const r = fitRaw(await readPptx(await openArchive(buf, LIMITS), 30_000), 30_000);
  assert.deepEqual(r, { text: "— Слайд 1 —\nЭтапы\nАнализ\nСинтез", truncated: false });
});

test("isCfb и resolvePart", () => {
  assert.equal(isCfb(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1])), true);
  assert.equal(isCfb(Buffer.from("PK\x03\x04")), false);
  assert.equal(resolvePart("ppt/slides", "../diagrams/data1.xml"), "ppt/diagrams/data1.xml");
  assert.equal(resolvePart("xl", "/xl/worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
  assert.equal(resolvePart("xl", "./worksheets/sheet1.xml"), "xl/worksheets/sheet1.xml");
  assert.equal(resolvePart("", "word/document.xml"), "word/document.xml");
});
