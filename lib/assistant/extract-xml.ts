import { cutEmptyNote, cutNotes, type Raw, type Section } from "./extract-fit";
import { formatById, formatNumber, isoCellDate, type NumFormat } from "./extract-numfmt";
import { parseXmlString, SkipDepth, type SaxHandler, type SaxTag } from "./extract-sax";
import { resolvePart, type PartSource } from "./extract-zip";

/*
 * PPTX и XLSX → текст (docs/AI-CHAT.md §5). Части читаются потоком (extract-zip + extract-sax): обработчики ниже
 * держат только свой вывод и говорят «хватит», как только набран бюджет символов, — ни дерева XML, ни части
 * целиком в памяти. Источник частей — PartSource: настоящий архив или строки-фикстуры в тестах, код один.
 */

/** Потолок символов общих строк книги: ячейка может ссылаться на последнюю, поэтому храним их, а не бросаем. */
const SHARED_CHARS = 3_000_000;

// ---------- Таблицы (общие для PPTX и DOCX) ----------

type OpenTable = { rows: string[]; row: string[][] | null; cell: string[] | null; pad: number };

/**
 * Таблица → строки «ячейка | ячейка | ячейка». Пустые ячейки сохраняются: «08.10 |  | Петров» — иначе Петров
 * встал бы в колонку «Тема». Абзацы ячейки склеиваются пробелом. Строка из одной ячейки (таблица-рамка вокруг
 * всего текста — частый шаблон бланков) не склеивается: её абзацы остаются строками. Вложенная таблица уходит
 * строками в ячейку внешней. Строки таблицы верхнего уровня отдаются в onRow сразу по закрытию — таблица на
 * тысячи строк не копится в памяти, а pending позволяет обработчику остановиться посреди огромной ячейки.
 */
export class Tables {
  /** Символов в ещё не закрытой строке таблицы верхнего уровня. */
  pending = 0;
  private readonly stack: OpenTable[] = [];

  constructor(private readonly onRow: (line: string) => void) {}

  get inCell(): boolean {
    const t = this.stack.at(-1);
    return Boolean(t && t.cell);
  }
  openTable(): void {
    this.stack.push({ rows: [], row: null, cell: null, pad: 0 });
  }
  openRow(): void {
    const t = this.stack.at(-1);
    if (t) t.row = [];
  }
  openCell(): void {
    const t = this.stack.at(-1);
    if (t && t.row) {
      t.cell = [];
      t.pad = 0;
    }
  }
  /** Объединённая по горизонтали ячейка DOCX (w:gridSpan): за неё добавляем пустые, чтобы колонки не съехали. */
  span(n: number): void {
    const t = this.stack.at(-1);
    if (t && t.cell && n > 1) t.pad = Math.min(n - 1, 50);
  }
  addLine(line: string): void {
    const cell = this.stack.at(-1)?.cell;
    if (!cell) return;
    cell.push(line);
    this.pending += line.length + 1;
  }
  closeCell(): void {
    const t = this.stack.at(-1);
    if (t) finishCell(t);
  }
  closeRow(): void {
    const t = this.stack.at(-1);
    if (t) this.finishRow(t);
  }
  closeTable(): void {
    const t = this.stack.at(-1);
    if (!t) return;
    this.finishRow(t);
    this.stack.pop();
    if (this.inCell) for (const row of t.rows) this.addLine(row);
  }
  /** Бюджет набран посреди таблицы: закрыть все открытые, чтобы накопленные ячейки ушли в вывод. */
  closeAll(): void {
    while (this.stack.length) this.closeTable();
  }

  private finishRow(t: OpenTable): void {
    if (!t.row) return;
    finishCell(t);
    const cells = t.row;
    t.row = null;
    let lines: string[];
    if (cells.length === 1) lines = cells[0].filter(Boolean);
    else {
      const texts = cells.map((c) => c.filter(Boolean).join(" ").replace(/\s+/g, " ").trim());
      // Строка без единого значения ничего не говорит модели; пустые ячейки внутри строки остаются.
      lines = texts.some(Boolean) ? [texts.join(" | ")] : [];
    }
    if (this.stack.length === 1) {
      this.pending = 0;
      for (const line of lines) this.onRow(line);
    } else t.rows.push(...lines);
  }
}

function finishCell(t: OpenTable): void {
  if (!t.row || !t.cell) return;
  t.row.push(t.cell);
  for (let i = 0; i < t.pad; i++) t.row.push([]);
  t.cell = null;
}

// ---------- .rels ----------

class RelsHandler implements SaxHandler {
  readonly targets = new Map<string, string>();
  constructor(private readonly baseDir: string) {}
  open(name: string, tag: SaxTag): void {
    if (name !== "Relationship" || tag.attr("TargetMode") === "External") return;
    const id = tag.attr("Id");
    const target = tag.attr("Target");
    if (id && target) this.targets.set(id, resolvePart(this.baseDir, target));
  }
}

/** rId → путь части. relsPath — «папка/_rels/часть.rels», цели в нём относительно baseDir. */
export async function readRels(source: PartSource, relsPath: string, baseDir: string): Promise<Map<string, string>> {
  const h = new RelsHandler(baseDir);
  await source.parse(relsPath, h);
  return h.targets;
}

const inDir = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** «ppt/slides/slide3.xml» → [«ppt/slides», «ppt/slides/_rels/slide3.xml.rels»]. */
const relsOf = (part: string): [string, string] => {
  const k = part.lastIndexOf("/");
  const dir = k === -1 ? "" : part.slice(0, k);
  return [dir, inDir(dir, `_rels/${part.slice(k + 1)}.rels`)];
};

/** Главная часть пакета по _rels/.rels (officeDocument); без него — привычный путь. */
export async function mainPart(source: PartSource, usual: string): Promise<string> {
  if (source.has(usual)) return usual;
  const h = new (class implements SaxHandler {
    found: string | null = null;
    open(name: string, tag: SaxTag) {
      if (name === "Relationship" && !this.found && /\/officeDocument$/.test(tag.attr("Type") ?? "")) this.found = tag.attr("Target");
    }
  })();
  await source.parse("_rels/.rels", h);
  return h.found ? resolvePart("", h.found) : usual;
}

// ---------- PPTX ----------

type SlideItem = string | { graphic: "diagram" | "chart"; rid: string | null };

const clean = (s: string) =>
  s
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .trim();

/**
 * Слайд → абзацы a:p построчно (пустые выброшены), таблицы a:tbl — строками через « | », SmartArt и диаграммы —
 * ссылками (r:dm, r:id), которые readPptx разрешает через slideN.xml.rels. mc:Fallback — копия содержимого
 * для старых программ, пропускаем.
 */
class SlideHandler implements SaxHandler {
  readonly items: SlideItem[] = [];
  done = false;
  private stopping = false;
  private chars = 0;
  private para: string | null = null;
  private inT = false;
  private uri = "";
  private readonly skip = new SkipDepth(new Set(["Fallback"]));
  private readonly tables = new Tables((row) => this.push(row));

  constructor(private readonly budget: number) {}

  private push(item: SlideItem) {
    this.items.push(item);
    if (typeof item === "string") this.chars += item.length + 1;
    this.check();
  }

  private closePara(): void {
    const line = clean(this.para ?? "");
    this.para = null;
    if (this.tables.inCell) this.tables.addLine(line);
    else if (line) this.push(line);
    this.check();
  }

  /** Бюджет набран (с учётом незакрытого абзаца и таблицы) — отдать накопленное и остановиться. */
  private check(): void {
    if (this.stopping || this.chars + this.tables.pending + (this.para?.length ?? 0) <= this.budget) return;
    this.stopping = true;
    if (this.para !== null) this.closePara();
    this.tables.closeAll();
    this.done = true;
  }

  open(name: string, tag: SaxTag): void {
    if (this.skip.open(name)) return;
    switch (name) {
      case "p":
        this.para = "";
        break;
      case "t":
        this.inT = this.para !== null;
        break;
      case "br":
        if (this.para !== null) this.para += "\n";
        break;
      case "tbl":
        this.tables.openTable();
        break;
      case "tr":
        this.tables.openRow();
        break;
      case "tc":
        this.tables.openCell();
        break;
      case "graphicData":
        this.uri = tag.attr("uri") ?? "";
        break;
      case "relIds":
        if (this.uri.endsWith("/diagram")) this.push({ graphic: "diagram", rid: tag.attr("dm") });
        break;
      case "chart":
        if (this.uri.endsWith("/chart")) this.push({ graphic: "chart", rid: tag.attr("id") });
        break;
    }
  }

  close(name: string): void {
    if (this.skip.close()) return;
    switch (name) {
      case "t":
        this.inT = false;
        break;
      case "p":
        this.closePara();
        break;
      case "tc":
        this.tables.closeCell();
        break;
      case "tr":
        this.tables.closeRow();
        break;
      case "tbl":
        this.tables.closeTable();
        break;
      case "graphicData":
        this.uri = "";
        break;
    }
  }

  text(s: string): void {
    if (!this.inT || this.para === null) return;
    this.para += s;
    this.check();
  }
}

/** Данные SmartArt (ppt/diagrams/dataN.xml): текст узлов — абзацы a:p внутри dgm:pt/dgm:t. */
class DiagramHandler implements SaxHandler {
  readonly lines: string[] = [];
  done = false;
  private chars = 0;
  private para: string | null = null;
  private inT = false;
  constructor(private readonly budget: number) {}
  open(name: string): void {
    if (name === "p") this.para = "";
    else if (name === "t") this.inT = this.para !== null;
    else if (name === "br" && this.para !== null) this.para += "\n";
  }
  close(name: string): void {
    if (name === "t") this.inT = false;
    else if (name === "p") this.closePara();
  }
  text(s: string): void {
    if (!this.inT || this.para === null) return;
    this.para += s;
    if (this.chars + this.para.length > this.budget) this.closePara();
  }
  private closePara(): void {
    const line = clean(this.para ?? "");
    this.para = null;
    if (line) {
      this.lines.push(line);
      this.chars += line.length + 1;
    }
    if (this.chars > this.budget) this.done = true;
  }
}

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

/** Текст одного слайда из XML-строки (без SmartArt — у строки нет архива со связями). Для тестов и отладки. */
export function slideText(xml: string): string {
  const h = new SlideHandler(Number.POSITIVE_INFINITY);
  parseXmlString(xml, h);
  return h.items.filter((i): i is string => typeof i === "string").join("\n");
}

/**
 * Презентация → слайды по номерам файлов ppt/slides/slide{N}.xml (не по строкам: slide10 после slide9). Метка —
 * порядковый номер; слайд без текста (одна картинка) пропускается, но номер свой сохраняет. Читаем по одному и
 * бросаем, как только набран бюджет: остальные попадут в «показаны первые N из M». Текст SmartArt — из данных
 * схемы; если их нет или они не читаются, модель хотя бы узнает, что на слайде схема.
 */
export async function readPptx(source: PartSource, limit: number): Promise<Raw> {
  const slides = source.names
    .map((name) => ({ name, n: Number(SLIDE_RE.exec(name)?.[1] ?? Number.NaN) }))
    .filter((f) => Number.isFinite(f.n))
    .sort((a, b) => a.n - b.n);
  const sections: Section[] = [];
  let chars = 0;
  let read = 0;
  for (const [i, f] of slides.entries()) {
    // Общий потолок распаковки или время кончились — дальше читать нечем, остальное уйдёт в «показаны первые N из M».
    if (chars > limit || source.timedOut || source.cut === "total") break;
    const n = i + 1;
    const h = new SlideHandler(limit - chars);
    const r = await source.parse(f.name, h);
    // Не распаковано ни байта (время или общий потолок) — слайд не прочитан и в «первые N» не идёт.
    if (r.cut && r.cut !== "part" && r.bytes === 0) break;
    read = n;
    const lines: string[] = [];
    let rels: Map<string, string> | null = null;
    for (const item of h.items) {
      if (typeof item === "string") {
        lines.push(item);
        continue;
      }
      if (item.graphic === "chart") {
        lines.push(`[на слайде ${n} диаграмма — её данные не прочитаны]`);
        continue;
      }
      if (!rels) {
        const [dir, relsPath] = relsOf(f.name);
        rels = await readRels(source, relsPath, dir);
      }
      const data = item.rid ? rels.get(item.rid) : undefined;
      const dh = new DiagramHandler(limit - chars);
      if (data) await source.parse(data, dh);
      if (dh.lines.length) lines.push(...dh.lines);
      else lines.push(`[на слайде ${n} схема — её текст не прочитан]`);
    }
    const text = lines.join("\n");
    if (text) {
      sections.push({ label: `Слайд ${n}`, n, text });
      chars += text.length;
    }
  }
  if (sections.length === 0) return { kind: "none", note: cutEmptyNote(source.cut) ?? "в презентации нет текста — пришли фото слайдов" };
  return { kind: "sections", sections, unit: "slides", total: slides.length, read, notes: cutNotes(source.cut) };
}

// ---------- XLSX ----------

/** xl/sharedStrings.xml → строки по индексу. Фонетические подсказки (rPh, японский) в текст не идут. */
class SharedStringsHandler implements SaxHandler {
  readonly strings: string[] = [];
  /** Строки сверх потолка не храним — ячейки с ними окажутся пустыми, а модель получит пометку. */
  capped = false;
  private chars = 0;
  private cur: string | null = null;
  private inT = false;
  private readonly skip = new SkipDepth(new Set(["rPh", "phoneticPr"]));
  constructor(private readonly maxChars: number) {}
  open(name: string): void {
    if (this.skip.open(name)) return;
    if (name === "si") this.cur = "";
    else if (name === "t") this.inT = this.cur !== null;
  }
  close(name: string): void {
    if (this.skip.close()) return;
    if (name === "t") this.inT = false;
    else if (name === "si" && this.cur !== null) {
      this.chars += this.cur.length;
      if (this.chars > this.maxChars) this.capped = true;
      this.strings.push(this.capped ? "" : this.cur);
      this.cur = null;
    }
  }
  text(s: string): void {
    if (!this.inT || this.cur === null || this.capped) return;
    this.cur += s;
    // Одна строка на сотни мегабайт не должна копиться до закрытия si.
    if (this.chars + this.cur.length > this.maxChars) this.capped = true;
  }
}

export function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const h = new SharedStringsHandler(SHARED_CHARS);
  parseXmlString(xml, h);
  return h.strings;
}

/** Форматы ячеек книги: s ячейки → cellXfs[s].numFmtId → код формата (xl/styles.xml). */
export class CellStyles {
  private readonly cache = new Map<number, NumFormat>();
  constructor(
    private readonly xfs: readonly number[] = [],
    private readonly custom: ReadonlyMap<number, string> = new Map(),
  ) {}
  format(s: string | null): NumFormat {
    const i = s === null ? 0 : Number(s);
    let f = this.cache.get(i);
    if (!f) {
      f = formatById(this.xfs[i] ?? 0, this.custom);
      this.cache.set(i, f);
    }
    return f;
  }
}

class StylesHandler implements SaxHandler {
  readonly xfs: number[] = [];
  readonly custom = new Map<number, string>();
  private inCellXfs = false;
  open(name: string, tag: SaxTag): void {
    if (name === "cellXfs") this.inCellXfs = true;
    else if (name === "xf" && this.inCellXfs) this.xfs.push(Number(tag.attr("numFmtId") ?? 0) || 0);
    else if (name === "numFmt") {
      const id = Number(tag.attr("numFmtId"));
      const code = tag.attr("formatCode");
      if (Number.isFinite(id) && code !== null) this.custom.set(id, code);
    }
  }
  close(name: string): void {
    if (name === "cellXfs") this.inCellXfs = false;
  }
}

/** Стили из XML-строки styles.xml — для тестов. */
export function cellStyles(xml: string): CellStyles {
  const h = new StylesHandler();
  parseXmlString(xml, h);
  return new CellStyles(h.xfs, h.custom);
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

type Cell = { ref: string | null; type: string | null; style: string | null; v: string; inline: string };

/**
 * Лист → строки через перевод строки, ячейки через табуляцию. Колонки ставим по ссылке r="C5", чтобы пропуски
 * не сдвигали значения влево; пустые хвосты и пустые строки выбрасываем. Табуляции и переводы внутри ячейки
 * заменяем пробелом — иначе таблица развалится. Числа — по формату ячейки: даты, время, проценты.
 */
class SheetHandler implements SaxHandler {
  readonly rows: string[] = [];
  done = false;
  private chars = 0;
  /** Символов в незакрытой строке: строка на миллион ячеек или ячейка на сотни мегабайт тоже упираются в бюджет. */
  private rowLen = 0;
  private cells: string[] | null = null;
  private cell: Cell | null = null;
  private inV = false;
  private inT = false;
  private readonly skip = new SkipDepth(new Set(["rPh", "phoneticPr", "f", "extLst"]));

  constructor(
    private readonly shared: readonly string[],
    private readonly styles: CellStyles,
    private readonly date1904: boolean,
    private readonly budget: number,
  ) {}

  open(name: string, tag: SaxTag): void {
    if (this.skip.open(name)) return;
    switch (name) {
      case "row":
        this.cells = [];
        this.rowLen = 0;
        break;
      case "c":
        if (this.cells) this.cell = { ref: tag.attr("r"), type: tag.attr("t"), style: tag.attr("s"), v: "", inline: "" };
        break;
      case "v":
        this.inV = this.cell !== null;
        break;
      case "t":
        this.inT = this.cell !== null;
        break;
    }
  }

  close(name: string): void {
    if (this.skip.close()) return;
    switch (name) {
      case "v":
        this.inV = false;
        break;
      case "t":
        this.inT = false;
        break;
      case "c":
        this.closeCell();
        this.check();
        break;
      case "row":
        this.closeRow();
        break;
    }
  }

  text(s: string): void {
    if (!this.cell) return;
    if (this.inV) this.cell.v += s;
    else if (this.inT) this.cell.inline += s;
    else return;
    this.check();
  }

  private closeCell(): void {
    if (this.cell && this.cells) this.place(this.cells, this.cell);
    this.cell = null;
  }

  private closeRow(): void {
    const cells = this.cells ?? [];
    this.cells = null;
    this.rowLen = 0;
    while (cells.length && cells[cells.length - 1] === "") cells.pop();
    if (cells.length) {
      const line = cells.join("\t");
      this.rows.push(line);
      this.chars += line.length + 1;
    }
    if (this.chars > this.budget) this.done = true;
  }

  private check(): void {
    const open = this.rowLen + (this.cell ? this.cell.v.length + this.cell.inline.length : 0);
    if (this.done || this.chars + open <= this.budget) return;
    this.closeCell();
    this.closeRow();
    this.done = true;
  }

  private place(cells: string[], c: Cell): void {
    const value = this.value(c)
      .replace(/[\t\r\n]+/g, " ")
      .trim();
    const col = columnIndex(c.ref);
    if (col !== null && col > cells.length) {
      const gap = Math.min(col - cells.length, MAX_COLUMN_GAP);
      for (let i = 0; i < gap; i++) cells.push("");
      this.rowLen += gap;
    }
    cells.push(value);
    this.rowLen += value.length + 1;
  }

  private value(c: Cell): string {
    switch (c.type) {
      case "s":
        return this.shared[Number(c.v)] ?? "";
      case "inlineStr":
        return c.inline;
      case "b":
        return c.v === "1" ? "ИСТИНА" : c.v === "0" ? "ЛОЖЬ" : c.v;
      case "d":
        return isoCellDate(c.v);
      case "str":
      case "e":
        // Результат формулы строкой и ошибки (#ДЕЛ/0!) — как записаны.
        return c.v;
      default:
        return c.v ? formatNumber(c.v, this.styles.format(c.style), this.date1904) : "";
    }
  }
}

/** Лист из XML-строки — для тестов. */
export function sheetText(xml: string, shared: readonly string[], styles = new CellStyles(), date1904 = false): string {
  const h = new SheetHandler(shared, styles, date1904, Number.POSITIVE_INFINITY);
  parseXmlString(xml, h);
  return h.rows.join("\n");
}

type WorkbookSheet = { name: string; rid: string | null; hidden: boolean };

class WorkbookHandler implements SaxHandler {
  readonly sheets: WorkbookSheet[] = [];
  date1904 = false;
  open(name: string, tag: SaxTag): void {
    if (name === "sheet") {
      const state = tag.attr("state");
      this.sheets.push({ name: tag.attr("name") ?? "", rid: tag.attr("id"), hidden: state === "hidden" || state === "veryHidden" });
    } else if (name === "workbookPr") {
      const v = tag.attr("date1904");
      this.date1904 = v === "1" || v === "true";
    }
  }
}

const SHEET_RE = /^xl\/worksheets\/sheet(\d+)\.xml$/;

/**
 * Какие листы читать и как их подписать: по порядку вкладок из workbook.xml («Лист 2: Посещаемость»), файл —
 * через xl/_rels/workbook.xml.rels (r:id → Target), без rels i-я вкладка — sheet{i+1}.xml (так пишут Excel и
 * LibreOffice). Только те, что реально есть в архиве. Скрытые листы пропускаем: там обычно справочники для
 * формул, а не то, о чём спрашивает студент. Без workbook.xml — по номерам файлов sheet{N}.xml.
 */
export function sheetOrder(sheets: readonly WorkbookSheet[], rels: ReadonlyMap<string, string>, paths: readonly string[]): { label: string; path: string }[] {
  const present = new Set(paths);
  const refs = sheets
    .map((s, i) => ({ ...s, path: (s.rid && rels.get(s.rid)) || `xl/worksheets/sheet${i + 1}.xml` }))
    .filter((s) => !s.hidden && present.has(s.path));
  const list = refs.length
    ? refs
    : paths
        .map((path) => ({ path, name: "", n: Number(SHEET_RE.exec(path)?.[1] ?? Number.NaN) }))
        .filter((f) => Number.isFinite(f.n))
        .sort((a, b) => a.n - b.n);
  return list.map((s, i) => ({ label: s.name ? `Лист ${i + 1}: ${s.name}` : `Лист ${i + 1}`, path: s.path }));
}

/**
 * Книга → листы по порядку вкладок. Листы читаем по одному и бросаем, когда текста уже больше бюджета: остальные
 * попадут в «показаны первые N из M». Пустой лист просмотрен, но в текст не идёт — и обрезкой не считается.
 */
export async function readXlsx(source: PartSource, limit: number): Promise<Raw> {
  const workbookPath = await mainPart(source, "xl/workbook.xml");
  const [xlDir, relsPath] = relsOf(workbookPath);
  const wb = new WorkbookHandler();
  await source.parse(workbookPath, wb);
  const rels = await readRels(source, relsPath, xlDir);
  const st = new StylesHandler();
  await source.parse(inDir(xlDir, "styles.xml"), st);
  const sh = new SharedStringsHandler(SHARED_CHARS);
  await source.parse(inDir(xlDir, "sharedStrings.xml"), sh);

  const styles = new CellStyles(st.xfs, st.custom);
  const order = sheetOrder(
    wb.sheets,
    rels,
    source.names.filter((n) => !xlDir || n.startsWith(`${xlDir}/`)),
  );
  const sections: Section[] = [];
  let chars = 0;
  let read = 0;
  for (const [i, s] of order.entries()) {
    // Общий потолок распаковки или время кончились — дальше читать нечем, остальное уйдёт в «показаны первые N из M».
    if (chars > limit || source.timedOut || source.cut === "total") break;
    const h = new SheetHandler(sh.strings, styles, wb.date1904, limit - chars);
    const r = await source.parse(s.path, h);
    if (r.cut && r.cut !== "part" && r.bytes === 0) break;
    read = i + 1;
    const text = h.rows.join("\n");
    chars += text.length;
    if (text) sections.push({ label: s.label, n: i + 1, text });
  }
  const notes = cutNotes(source.cut);
  if (sh.capped) notes.push("общих строк книги слишком много — часть ячеек показана пустой");
  if (sections.length === 0) return { kind: "none", note: cutEmptyNote(source.cut) ?? "в таблице нет данных — пришли фото или другой файл" };
  return { kind: "sections", sections, unit: "sheets", total: order.length, read, notes };
}
