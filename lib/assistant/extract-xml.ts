import { XMLParser } from "fast-xml-parser";
import { clipText } from "./compact";

/*
 * Чистые парсеры Office Open XML для извлечения текста (docs/AI-CHAT.md §5): PPTX — слайды, XLSX — листы.
 * Без server-only и без распаковки zip: на вход — уже прочитанные XML-строки по именам файлов архива,
 * поэтому тесты гоняются на строках-фикстурах. Распаковка, лимиты байт и PDF/DOCX — в lib/assistant/extract.ts.
 *
 * preserveOrder: порядок узлов важен — в абзаце слайда чередуются a:r, a:br, a:fld, и без него перенос строки
 * оказался бы не на своём месте. Сравниваем локальные имена (без префикса): генераторы вольны в префиксах,
 * у некоторых .NET-библиотек лист — это x:worksheet/x:row/x:c.
 */

/** Кусок документа с заголовком: слайд, лист, страница. */
export type Section = { label: string; text: string };

type XNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Пробелы внутри a:t значимы («Привет, » + «мир»), а "007" в ячейке — текст, а не число 7.
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
});

/**
 * XML → дерево узлов. DOCTYPE вырезаем заранее: в OOXML его не бывает, а сущности из него — классический путь
 * к «миллиарду смешков». Обрезанный на полуслове XML (см. clipXml) парсер принимает — незакрытые теги в конце он
 * просто закрывает.
 */
export function parseXml(xml: string): XNode[] {
  const clean = xml.replace(/<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?\s*>/gi, "");
  return parser.parse(clean) as XNode[];
}

const tagOf = (n: XNode): string | null => Object.keys(n).find((k) => k !== ":@" && k !== "#text") ?? null;
const localName = (tag: string) => tag.slice(tag.indexOf(":") + 1);
const childrenOf = (n: XNode): XNode[] => {
  const t = tagOf(n);
  const c = t ? n[t] : null;
  return Array.isArray(c) ? (c as XNode[]) : [];
};
const attr = (n: XNode, name: string): string | null => {
  const a = n[":@"] as Record<string, unknown> | undefined;
  if (!a) return null;
  for (const [k, v] of Object.entries(a)) if (localName(k.slice(2)) === name) return String(v);
  return null;
};
const textOf = (n: XNode): string => (typeof n["#text"] === "string" ? (n["#text"] as string) : "");

/** Все потомки (в порядке документа) с локальным именем name. */
function findAll(nodes: XNode[], name: string, out: XNode[] = []): XNode[] {
  for (const n of nodes) {
    const t = tagOf(n);
    if (!t) continue;
    if (localName(t) === name) out.push(n);
    else findAll(childrenOf(n), name, out);
  }
  return out;
}

/** Текст всех потомков <t> (кроме пропущенных тегов) подряд, <br> — перевод строки. */
function collectText(nodes: XNode[], skip: ReadonlySet<string> = new Set()): string {
  let s = "";
  for (const n of nodes) {
    const t = tagOf(n);
    if (!t) continue;
    const name = localName(t);
    if (skip.has(name)) continue;
    if (name === "t") s += childrenOf(n).map(textOf).join("");
    else if (name === "br") s += "\n";
    else s += collectText(childrenOf(n), skip);
  }
  return s;
}

// ---------- PPTX ----------

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Текст одного слайда: абзацы a:p построчно, пустые выброшены. */
export function slideText(xml: string): string {
  return findAll(parseXml(xml), "p")
    .map((p) => collectText(childrenOf(p)).replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Слайды презентации по порядку номеров файлов ppt/slides/slide{N}.xml (не по строкам: slide10 после slide9).
 * Метка — порядковый номер; слайды без текста (одна картинка) пропускаются, но номер свой сохраняют.
 */
export function slidesText(xmlByName: Record<string, string>): Section[] {
  return Object.keys(xmlByName)
    .map((name) => ({ name, n: Number(SLIDE_RE.exec(name)?.[1] ?? Number.NaN) }))
    .filter((f) => Number.isFinite(f.n))
    .sort((a, b) => a.n - b.n)
    .map((f, i) => ({ label: `Слайд ${i + 1}`, text: slideText(xmlByName[f.name]) }))
    .filter((s) => s.text);
}

// ---------- XLSX ----------

/** xl/sharedStrings.xml → массив строк по индексу. Фонетические подсказки (rPh, японский) в текст не идут. */
export function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  return findAll(parseXml(xml), "si").map((si) => collectText(childrenOf(si), new Set(["rPh", "phoneticPr"])));
}

/** "BC12" → 54 (номер колонки с нуля); без ссылки — null. */
export function columnIndex(ref: string | null): number | null {
  const m = ref ? /^([A-Z]+)\d*$/i.exec(ref) : null;
  if (!m) return null;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Дальний разрыв колонок (данные в A и в XFD) не должен превращаться в тысячи табуляций. */
const MAX_COLUMN_GAP = 30;

function cellValue(c: XNode, shared: readonly string[]): string {
  const type = attr(c, "t");
  const kids = childrenOf(c);
  const v = kids.filter((k) => tagOf(k) && localName(tagOf(k)!) === "v").map((k) => collectInner(k)).join("");
  switch (type) {
    case "s":
      return shared[Number(v)] ?? "";
    case "inlineStr":
      return collectText(kids);
    case "b":
      return v === "1" ? "ИСТИНА" : v === "0" ? "ЛОЖЬ" : v;
    default:
      // n (число, в том числе даты серийным числом), str (результат формулы), e (#ДЕЛ/0!) — как записано.
      return v;
  }
}

const collectInner = (n: XNode) => childrenOf(n).map(textOf).join("");

/**
 * Лист → строки через перевод строки, ячейки через табуляцию. Колонки ставим по ссылке r="C5", чтобы пропуски
 * не сдвигали значения влево; пустые хвосты и пустые строки выбрасываем. Табуляции и переводы внутри ячейки
 * заменяем пробелом — иначе таблица развалится.
 */
export function sheetText(xml: string, shared: readonly string[]): string {
  const rows: string[] = [];
  for (const row of findAll(parseXml(xml), "row")) {
    const cells: string[] = [];
    for (const c of childrenOf(row)) {
      const t = tagOf(c);
      if (!t || localName(t) !== "c") continue;
      const value = cellValue(c, shared).replace(/[\t\r\n]+/g, " ").trim();
      const col = columnIndex(attr(c, "r"));
      if (col !== null && col > cells.length) {
        const gap = Math.min(col - cells.length, MAX_COLUMN_GAP);
        for (let i = 0; i < gap; i++) cells.push("");
      }
      cells.push(value);
    }
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.length) rows.push(cells.join("\t"));
  }
  return rows.join("\n");
}

export type SheetRef = { name: string; path: string };

/** Путь из .rels относительно xl/: "worksheets/sheet1.xml", "/xl/worksheets/sheet1.xml" → "xl/worksheets/sheet1.xml". */
const resolveXlPath = (target: string) => (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`);

/**
 * Листы книги по порядку вкладок: имя из xl/workbook.xml, файл — через xl/_rels/workbook.xml.rels (r:id → Target).
 * Без rels — i-й лист считаем sheet{i+1}.xml (так пишут Excel и LibreOffice). Скрытые листы пропускаем: там обычно
 * справочники для формул, а не то, о чём спрашивает студент.
 */
export function workbookSheets(workbookXml: string | undefined, relsXml: string | undefined): SheetRef[] {
  if (!workbookXml) return [];
  const rels = new Map<string, string>();
  if (relsXml) for (const r of findAll(parseXml(relsXml), "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (id && target) rels.set(id, resolveXlPath(target));
  }
  return findAll(parseXml(workbookXml), "sheet").flatMap((s, i) => {
    const state = attr(s, "state");
    if (state === "hidden" || state === "veryHidden") return [];
    const rid = attr(s, "id");
    return [{ name: attr(s, "name") ?? `Лист ${i + 1}`, path: (rid && rels.get(rid)) || `xl/worksheets/sheet${i + 1}.xml` }];
  });
}

const SHEET_RE = /^xl\/worksheets\/sheet(\d+)\.xml$/;

/**
 * Какие листы читать и как их подписать: по порядку вкладок из workbook.xml («Лист 2: Посещаемость»), только
 * те, что реально есть в архиве (paths); без workbook.xml — по номерам файлов sheet{N}.xml. Отдельно от разбора
 * самих листов, чтобы extract.ts читал их из архива по одному и останавливался, набрав бюджет.
 */
export function sheetOrder(xmlByName: Record<string, string>, paths: readonly string[]): { label: string; path: string }[] {
  const present = new Set(paths);
  const refs = workbookSheets(xmlByName["xl/workbook.xml"], xmlByName["xl/_rels/workbook.xml.rels"]).filter((r) => present.has(r.path));
  const list: SheetRef[] = refs.length
    ? refs
    : paths
        .map((path) => ({ path, n: Number(SHEET_RE.exec(path)?.[1] ?? Number.NaN) }))
        .filter((f) => Number.isFinite(f.n))
        .sort((a, b) => a.n - b.n)
        .map((f) => ({ name: "", path: f.path }));
  return list.map((s, i) => ({ label: s.name ? `Лист ${i + 1}: ${s.name}` : `Лист ${i + 1}`, path: s.path }));
}

/** Листы книги с текстом целиком из уже прочитанных XML (пустые пропускаются). */
export function workbookText(xmlByName: Record<string, string>): Section[] {
  const shared = sharedStrings(xmlByName["xl/sharedStrings.xml"]);
  return sheetOrder(xmlByName, Object.keys(xmlByName))
    .map((s) => ({ label: s.label, text: sheetText(xmlByName[s.path], shared) }))
    .filter((s) => s.text);
}

// ---------- Обрезка ----------

/**
 * Огромный XML-файл читаем не целиком (extract.ts ограничивает байты), и чтобы хвост не рвал ячейку или строку
 * общих строк пополам, отрезаем всё после последнего закрытого элемента tag (с любым префиксом). Незакрытые
 * внешние теги парсер допускает, так что получаем валидное «начало листа». Ни одного целого элемента — пусто.
 */
export function cutAfterLast(xml: string, tag: string): string {
  const re = new RegExp(`</(?:[\\w.-]+:)?${tag}>`, "g");
  let end = -1;
  for (const m of xml.matchAll(re)) end = m.index + m[0].length;
  return end > 0 ? xml.slice(0, end) : "";
}

/** XML не длиннее max символов, обрезанный по границе элемента tag; короткий возвращается как есть. */
export const clipXml = (xml: string, max: number, tag: string): string => (xml.length <= max ? xml : cutAfterLast(xml.slice(0, max), tag));

/** «из 21 страницы», «из 40 страниц»: после «из» — родительный падеж, единственное число только на 1 (кроме 11). */
const genitive = (n: number, one: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : many);

export type SectionUnit = "slides" | "sheets" | "pages";
const UNIT_WORDS: Record<SectionUnit, [string, string]> = {
  slides: ["слайда", "слайдов"],
  sheets: ["листа", "листов"],
  pages: ["страницы", "страниц"],
};

/** Меньше этого остатка бюджета частичный кусок не добавляем: полстрочки листа модели не помогут, а токены съедят. */
const MIN_PARTIAL = 400;

/**
 * Разделы документа → текст в пределах limit символов. Разделы берутся целиком, пока влезают; следующий —
 * частично, если осталось заметное место. Пометка об обрезке говорит, сколько показано: «показаны первые 12 из
 * 40 страниц» — по ней модель честно скажет, что прочитала не всё. total — сколько разделов в документе всего:
 * PDF читается постранично и бросается, как только бюджет набран, так что прочитанных меньше, чем страниц.
 */
export function fitSections(
  sections: readonly Section[],
  limit: number,
  unit: SectionUnit,
  total = sections.length,
): { text: string; truncated: boolean; note?: string } {
  const withHeaders = total > 1 || unit !== "pages";
  const pieces = sections.map((s) => (withHeaders ? `— ${s.label} —\n${s.text}` : s.text));
  const all = pieces.join("\n\n");
  if (all.length <= limit && total <= sections.length) return { text: all, truncated: false };

  const out: string[] = [];
  let used = 0;
  for (const piece of pieces) {
    const sep = out.length ? 2 : 0;
    if (used + sep + piece.length <= limit) {
      out.push(piece);
      used += sep + piece.length;
      continue;
    }
    const room = limit - used - sep;
    if (room >= MIN_PARTIAL || out.length === 0) {
      out.push(clipText(piece, Math.max(room, 0)));
    }
    break;
  }
  const [one, many] = UNIT_WORDS[unit];
  // Один огромный лист «показаны первые 1 из 1» не объясняет ничего — говорим прямо, что видно только начало.
  const note = total === 1 ? "документ обрезан, показано только начало" : `документ обрезан, показаны первые ${out.length} из ${total} ${genitive(total, one, many)}`;
  return { text: out.join("\n\n"), truncated: true, note };
}
