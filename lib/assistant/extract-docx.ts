import { cutEmptyNote, cutNotes, type Raw } from "./extract-fit";
import { parseXmlString, SkipDepth, type SaxHandler, type SaxTag } from "./extract-sax";
import { mainPart, Tables } from "./extract-xml";
import type { PartSource } from "./extract-zip";

/*
 * DOCX → текст своим потоковым разбором word/document.xml (docs/AI-CHAT.md §5) — вместо mammoth, который строил
 * дерево всего документа (в 35–75 раз больше самого XML) ради первых 30 000 символов и терял структуру.
 * Абзацы — строками; w:tab — табуляция, w:br — перевод строки; таблицы — «ячейка | ячейка» с пустыми ячейками;
 * автонумерация списков — по word/numbering.xml, как её видит студент («3. Инфляция»), чтобы «ответь на вопрос 3»
 * попадало в третий вопрос, а не в третий абзац. Разбор останавливается, как только набран бюджет символов.
 */

type Level = { fmt: string; text: string | null; start: number };
type Levels = Map<number, Level>;
type NumDef = { abstractId: string; starts: Map<number, number>; levels: Levels };

/** word/numbering.xml: abstractNum (уровни: формат, шаблон «%1.», старт) и num (ссылка на abstractNum + переопределения). */
class NumberingHandler implements SaxHandler {
  readonly abstracts = new Map<string, Levels>();
  readonly nums = new Map<string, NumDef>();
  /** abstractNum со ссылкой на стиль списка (numStyleLink) → имя стиля; определение уровней — у abstractNum с тем же styleLink. */
  readonly styleLinks = new Map<string, string>();
  readonly styleOwners = new Map<string, string>();
  /** «abstractNumId|styleId» → уровень: заголовки, связанные со списком через стиль, находят свой уровень так. */
  readonly levelStyles = new Map<string, number>();
  private abstractId: string | null = null;
  private num: NumDef | null = null;
  private overrideLvl: number | null = null;
  private level: Level | null = null;
  private levelIdx = 0;

  open(name: string, tag: SaxTag): void {
    const val = tag.attr("val");
    switch (name) {
      case "abstractNum":
        this.abstractId = tag.attr("abstractNumId");
        if (this.abstractId !== null) this.abstracts.set(this.abstractId, new Map());
        break;
      case "num":
        this.num = { abstractId: "", starts: new Map(), levels: new Map() };
        this.nums.set(tag.attr("numId") ?? "", this.num);
        break;
      case "abstractNumId":
        if (this.num && val !== null) this.num.abstractId = val;
        break;
      case "lvlOverride":
        this.overrideLvl = Number(tag.attr("ilvl") ?? 0) || 0;
        break;
      case "startOverride":
        if (this.num && this.overrideLvl !== null && val !== null) this.num.starts.set(this.overrideLvl, Number(val) || 0);
        break;
      case "lvl":
        this.levelIdx = Number(tag.attr("ilvl") ?? 0) || 0;
        this.level = { fmt: "decimal", text: null, start: 1 };
        break;
      case "start":
        if (this.level && val !== null) this.level.start = Number(val) || 0;
        break;
      case "numFmt":
        if (this.level && val !== null) this.level.fmt = val;
        break;
      case "lvlText":
        if (this.level) this.level.text = val;
        break;
      case "pStyle":
        if (this.level && this.abstractId !== null && this.overrideLvl === null && val) this.levelStyles.set(`${this.abstractId}|${val}`, this.levelIdx);
        break;
      case "numStyleLink":
        if (this.abstractId !== null && val) this.styleLinks.set(this.abstractId, val);
        break;
      case "styleLink":
        if (this.abstractId !== null && val) this.styleOwners.set(val, this.abstractId);
        break;
    }
  }

  close(name: string): void {
    switch (name) {
      case "lvl":
        if (this.level) {
          // Уровень внутри lvlOverride заменяет уровень abstractNum только для этого num.
          if (this.num && this.overrideLvl !== null) this.num.levels.set(this.levelIdx, this.level);
          else if (this.abstractId !== null) this.abstracts.get(this.abstractId)?.set(this.levelIdx, this.level);
        }
        this.level = null;
        break;
      case "lvlOverride":
        this.overrideLvl = null;
        break;
      case "abstractNum":
        this.abstractId = null;
        break;
      case "num":
        this.num = null;
        break;
    }
  }
}

const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
const roman = (n: number) => {
  let out = "";
  for (const [v, s] of ROMAN)
    while (n >= v) {
      out += s;
      n -= v;
    }
  return out;
};
/** Word в «а, б, в» пропускает ё, й, ъ, ы, ь; после «я» идут «аа, бб…» — как и латинские буквы. */
const RU_LETTERS = "абвгдежзиклмнопрстуфхцчшщэюя";
const EN_LETTERS = "abcdefghijklmnopqrstuvwxyz";
const letter = (n: number, abc: string) => abc[(n - 1) % abc.length].repeat(Math.floor((n - 1) / abc.length) + 1);

function formatCounter(n: number, fmt: string): string {
  if (n < 1 && fmt !== "decimal" && fmt !== "decimalZero") return String(n);
  switch (fmt) {
    case "decimalZero":
      return n < 10 ? `0${n}` : String(n);
    case "lowerLetter":
      return letter(n, EN_LETTERS);
    case "upperLetter":
      return letter(n, EN_LETTERS).toUpperCase();
    case "russianLower":
      return letter(n, RU_LETTERS);
    case "russianUpper":
      return letter(n, RU_LETTERS).toUpperCase();
    case "lowerRoman":
      return roman(n).toLowerCase();
    case "upperRoman":
      return roman(n);
    default:
      // decimal и экзотика (ordinal, cardinalText, восточные счёты): номер цифрой понятнее модели, чем «•».
      return String(n);
  }
}

/**
 * Счётчики списков документа: по numId + уровень. Пункт уровня L увеличивает свой счётчик и сбрасывает все более
 * глубокие — вложенный список после нового пункта верхнего уровня снова начинается с 1.
 */
export class ListNumbering {
  private readonly counters = new Map<string, number[]>();
  constructor(private readonly defs: NumberingHandler = new NumberingHandler()) {}

  private abstractOf(numId: string): string | null {
    const num = this.defs.nums.get(numId);
    if (!num) return null;
    const link = this.defs.styleLinks.get(num.abstractId);
    return link ? (this.defs.styleOwners.get(link) ?? num.abstractId) : num.abstractId;
  }

  private level(numId: string, ilvl: number): Level | null {
    const own = this.defs.nums.get(numId)?.levels.get(ilvl);
    if (own) return own;
    const abstractId = this.abstractOf(numId);
    return abstractId === null ? null : (this.defs.abstracts.get(abstractId)?.get(ilvl) ?? null);
  }

  /** Уровень списка, к которому привязан стиль абзаца (w:lvl/w:pStyle) — так Word нумерует «Заголовок 1», «Заголовок 2». */
  levelForStyle(numId: string, styleId: string): number | null {
    const abstractId = this.abstractOf(numId);
    return abstractId === null ? null : (this.defs.levelStyles.get(`${abstractId}|${styleId}`) ?? null);
  }

  private start(numId: string, ilvl: number): number {
    return this.defs.nums.get(numId)?.starts.get(ilvl) ?? this.level(numId, ilvl)?.start ?? 1;
  }

  /** Метка очередного пункта: «3.», «1.2.», «б)», «•»; numId "0" — нумерация снята, метки нет. */
  next(numId: string, ilvl: number): string {
    if (numId === "0") return "";
    const lvl = this.level(numId, ilvl);
    const fmt = lvl?.fmt ?? "bullet";
    const counters = this.counters.get(numId) ?? [];
    this.counters.set(numId, counters);
    counters.length = Math.min(counters.length, ilvl + 1);
    if (fmt === "none") return "";
    if (fmt === "bullet") return "•";
    counters[ilvl] = counters[ilvl] === undefined ? this.start(numId, ilvl) : counters[ilvl] + 1;
    const template = lvl?.text ?? `%${ilvl + 1}.`;
    return template
      .replace(/%([1-9])/g, (_, d: string) => {
        const k = Number(d) - 1;
        if (k > ilvl) return "";
        const value = counters[k] ?? this.start(numId, k);
        return formatCounter(value, this.level(numId, k)?.fmt ?? "decimal");
      })
      .trim();
  }
}

/** Нумерация из XML-строки numbering.xml — для тестов. */
export function listNumbering(xml: string | undefined): ListNumbering {
  const h = new NumberingHandler();
  if (xml) parseXmlString(xml, h);
  return new ListNumbering(h);
}

type StyleNum = { numId: string | null; ilvl: number | null; basedOn: string | null };

/**
 * word/styles.xml: нумерация, заданная стилем абзаца. Word так нумерует заголовки курсовой («1.1 Понятие спроса»)
 * и стиль «Нумерованный список»: у самих абзацев numPr нет, он в стиле или в его родителе (basedOn).
 */
class ParaStylesHandler implements SaxHandler {
  readonly styles = new Map<string, StyleNum>();
  private cur: StyleNum | null = null;
  private inPPr = false;
  private readonly skip = new SkipDepth(new Set(["pPrChange", "rPr", "tblPr", "trPr", "tcPr", "tblStylePr"]));

  open(name: string, tag: SaxTag): void {
    if (this.skip.open(name)) return;
    if (name === "style") {
      this.cur = tag.attr("type") === "paragraph" ? { numId: null, ilvl: null, basedOn: null } : null;
      if (this.cur) this.styles.set(tag.attr("styleId") ?? "", this.cur);
      return;
    }
    if (!this.cur) return;
    if (name === "basedOn") this.cur.basedOn = tag.attr("val");
    else if (name === "pPr") this.inPPr = true;
    else if (this.inPPr && name === "numId") this.cur.numId = tag.attr("val");
    else if (this.inPPr && name === "ilvl") this.cur.ilvl = Math.min(Number(tag.attr("val")) || 0, 8);
  }

  close(name: string): void {
    if (this.skip.close()) return;
    if (name === "pPr") this.inPPr = false;
    else if (name === "style") this.cur = null;
  }

  /** numId и уровень стиля с учётом родителей: ближайший заданный побеждает. */
  resolve(styleId: string): { numId: string | null; ilvl: number | null } {
    let numId: string | null = null;
    let ilvl: number | null = null;
    let id: string | null = styleId;
    for (let depth = 0; id !== null && depth < 10; depth++) {
      const st = this.styles.get(id);
      if (!st) break;
      numId ??= st.numId;
      ilvl ??= st.ilvl;
      id = st.basedOn;
    }
    return { numId, ilvl };
  }
}

type Para = { text: string; numId: string | null; ilvl: number | null; style: string | null };

/**
 * Поддеревья без видимого текста документа: mc:Fallback (копия надписи для старых Word — иначе текст задвоится),
 * свойства прогона, удалённый и перенесённый-отсюда текст рецензирования, старые версии свойств.
 */
const DOCX_SKIP = new Set(["Fallback", "rPr", "del", "moveFrom", "pPrChange", "rPrChange", "sectPrChange", "instrText", "delText"]);

/**
 * word/document.xml → строки. Абзацы складываются в стек: надпись (w:txbxContent) — абзацы внутри прогона внешнего
 * абзаца, и внутренние выводятся раньше внешнего. Пустые абзацы подряд схлопываются в одну пустую строку.
 * Бюджет считается вместе с незакрытыми абзацами и ячейками: абзац на 400 МБ в одном w:t или таблица-рамка вокруг
 * всего документа останавливают разбор так же, как обычный текст, и накопленное не теряется (check).
 */
class DocumentHandler implements SaxHandler {
  readonly lines: string[] = [];
  done = false;
  private stopping = false;
  private chars = 0;
  private readonly paras: Para[] = [];
  private inRun = 0;
  private inPPr = 0;
  private inT = false;
  private readonly skip = new SkipDepth(DOCX_SKIP);
  private readonly tables = new Tables((row) => this.deliver(row));

  constructor(
    private readonly numbering: ListNumbering,
    private readonly budget: number,
    private readonly styles: ParaStylesHandler = new ParaStylesHandler(),
  ) {}

  private get para(): Para | undefined {
    return this.paras.at(-1);
  }

  private deliver(line: string): void {
    if (this.tables.inCell) this.tables.addLine(line);
    else if (line || (this.lines.length > 0 && this.lines.at(-1) !== "")) {
      this.lines.push(line);
      this.chars += line.length + 1;
    }
    this.check();
  }

  private closePara(): void {
    const p = this.paras.pop();
    if (!p) return;
    const text = p.text.replace(/[^\S\n\t]+/g, " ").replace(/^ +| +$/g, "");
    const label = this.label(p);
    this.deliver(label ? `${label} ${text}`.trimEnd() : text);
  }

  /**
   * Метка нумерации абзаца: numPr самого абзаца, а чего в нём нет — из стиля (и его родителей). Уровень без ilvl —
   * тот, к которому стиль привязан в numbering.xml (w:lvl/w:pStyle), иначе нулевой.
   */
  private label(p: Para): string {
    const st = p.style !== null && (p.numId === null || p.ilvl === null) ? this.styles.resolve(p.style) : null;
    const numId = p.numId ?? st?.numId ?? null;
    if (numId === null) return "";
    const ilvl = p.ilvl ?? st?.ilvl ?? (p.style !== null ? this.numbering.levelForStyle(numId, p.style) : null) ?? 0;
    return this.numbering.next(numId, ilvl);
  }

  /** Бюджет набран — закрываем всё открытое (абзацы, ячейки, таблицы), чтобы накопленное дошло до вывода, и стоп. */
  private check(): void {
    if (this.stopping) return;
    let open = this.tables.pending;
    for (const p of this.paras) open += p.text.length;
    if (this.chars + open <= this.budget) return;
    this.stopping = true;
    while (this.paras.length) this.closePara();
    this.tables.closeAll();
    this.done = true;
  }

  open(name: string, tag: SaxTag): void {
    if (this.skip.open(name)) return;
    const p = this.para;
    switch (name) {
      case "p":
        this.paras.push({ text: "", numId: null, ilvl: null, style: null });
        break;
      case "pPr":
        this.inPPr++;
        break;
      case "numId":
        if (this.inPPr && p) p.numId = tag.attr("val");
        break;
      case "ilvl":
        if (this.inPPr && p) p.ilvl = Math.min(Number(tag.attr("val")) || 0, 8);
        break;
      case "pStyle":
        if (this.inPPr && p) p.style = tag.attr("val");
        break;
      case "r":
        this.inRun++;
        break;
      case "t":
        this.inT = this.inRun > 0 && !this.inPPr;
        break;
      case "tab":
        // w:tab в w:pPr/w:tabs — позиция табуляции, а не символ: учитываем только внутри прогона.
        if (this.inRun && !this.inPPr && p) p.text += "\t";
        break;
      case "br":
      case "cr":
        if (this.inRun && !this.inPPr && p) p.text += "\n";
        break;
      case "noBreakHyphen":
        if (this.inRun && p) p.text += "-";
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
      case "gridSpan":
        this.tables.span(Number(tag.attr("val")) || 1);
        break;
    }
  }

  close(name: string): void {
    if (this.skip.close()) return;
    switch (name) {
      case "pPr":
        this.inPPr = Math.max(0, this.inPPr - 1);
        break;
      case "r":
        this.inRun = Math.max(0, this.inRun - 1);
        break;
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
    }
  }

  text(s: string): void {
    const p = this.para;
    if (!this.inT || !p || this.skip.active) return;
    p.text += s;
    this.check();
  }
}

/** Текст document.xml из XML-строки — для тестов. */
export function documentText(xml: string, numbering = new ListNumbering(), stylesXml?: string): string {
  const styles = new ParaStylesHandler();
  if (stylesXml) parseXmlString(stylesXml, styles);
  const h = new DocumentHandler(numbering, Number.POSITIVE_INFINITY, styles);
  parseXmlString(xml, h);
  return h.lines.join("\n").trim();
}

/** DOCX → сплошной текст. complete = false, если остановились по бюджету, потолку распаковки или времени. */
export async function readDocx(source: PartSource, limit: number): Promise<Raw> {
  const docPath = await mainPart(source, "word/document.xml");
  const dir = docPath.includes("/") ? docPath.slice(0, docPath.lastIndexOf("/")) : "";
  const inDir = (name: string) => (dir ? `${dir}/${name}` : name);
  const nh = new NumberingHandler();
  await source.parse(inDir("numbering.xml"), nh);
  const sh = new ParaStylesHandler();
  await source.parse(inDir("styles.xml"), sh);
  const h = new DocumentHandler(new ListNumbering(nh), limit, sh);
  const r = await source.parse(docPath, h);
  if (!r.found) return { kind: "none", note: "не удалось прочитать файл — пересохрани его или пришли фото" };
  const text = h.lines.join("\n").trim();
  if (!text) return { kind: "none", note: cutEmptyNote(source.cut) ?? "в документе нет текста — пришли фото страниц" };
  return { kind: "plain", text, complete: r.complete, notes: cutNotes(source.cut) };
}
