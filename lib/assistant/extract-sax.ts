/*
 * Потоковый разбор XML для извлечения текста из OOXML (docs/AI-CHAT.md §5). Зачем свой: дерево (fast-xml-parser,
 * mammoth) стоит в десятки раз больше самого XML, и 40 МБ document.xml клали функцию по памяти, хотя из них нужны
 * первые 30 000 символов. Здесь XML приходит кусками прямо из распаковки, события отдаются обработчику, а он
 * хранит только свой вывод и говорит «хватит» (done) — дальше не распаковываем и не разбираем.
 *
 * Это не валидирующий парсер, а токенизатор ровно под OOXML: теги, атрибуты, текст, пять стандартных сущностей и
 * числовые ссылки. DOCTYPE, комментарии и инструкции пропускаются; сущности из DOCTYPE не раскрываются никогда —
 * «миллиард смешков» невозможен по построению. Имена отдаются локальными (без префикса): генераторы вольны в
 * префиксах, у некоторых .NET-библиотек лист — это x:worksheet/x:row/x:c.
 */

export interface SaxTag {
  /** Значение атрибута по локальному имени (r:id → "id"), сущности раскрыты; нет атрибута — null. */
  attr(local: string): string | null;
}

export interface SaxHandler {
  open?(name: string, tag: SaxTag): void;
  close?(name: string): void;
  /** Текст между тегами, сущности раскрыты. Может приходить несколькими кусками подряд. */
  text?(s: string): void;
  /** true — обработчику больше ничего не нужно: разбор и распаковка останавливаются. */
  readonly done?: boolean;
}

/**
 * Самый длинный тег, комментарий или CDATA, которого ждём целиком. В настоящих документах теги — сотни байт;
 * мегабайт без «>» — это не документ, а попытка заставить нас копить буфер. Дальше такой часть не разбираем.
 */
const MAX_TOKEN = 1024 * 1024;

export const localName = (q: string): string => {
  const k = q.indexOf(":");
  return k === -1 ? q : q.slice(k + 1);
};

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,4});/g, (whole, body: string) => {
    if (body[0] !== "#") return NAMED[body] ?? whole;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    // Суррогаты и нули в XML недопустимы; битую ссылку лучше выбросить, чем уронить String.fromCodePoint.
    if (!(code > 0 && code <= 0x10ffff) || (code >= 0xd800 && code <= 0xdfff)) return "";
    return String.fromCodePoint(code);
  });
}

const ATTR_RE = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Атрибуты разбираются лениво: обработчикам нужны атрибуты у единиц тегов из тысяч. */
class Tag implements SaxTag {
  private map: Map<string, string> | null = null;
  constructor(private readonly raw: string) {}
  attr(local: string): string | null {
    if (!this.map) {
      this.map = new Map();
      for (const m of this.raw.matchAll(ATTR_RE)) {
        // xmlns:r="…" дал бы локальное имя "r" и спутался бы с атрибутом ячейки r="A1".
        if (m[1] === "xmlns" || m[1].startsWith("xmlns:")) continue;
        const key = localName(m[1]);
        if (!this.map.has(key)) this.map.set(key, decodeEntities(m[2] ?? m[3] ?? ""));
      }
    }
    return this.map.get(local) ?? null;
  }
}

/**
 * Конец открывающего тега: первый «>» вне кавычек (в значениях атрибутов «>» законен). -1 — тег ещё не дочитан.
 * Посимвольно, а не indexOf по кавычкам: поиск кавычки до конца буфера на каждом теге сделал бы разбор квадратичным.
 */
function tagEnd(s: string, from: number): number {
  let quote = 0;
  for (let i = from; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 34 || c === 39) quote = c;
    else if (c === 62) return i;
  }
  return -1;
}

/** Конец объявления <!DOCTYPE …> с внутренним подмножеством […] или без него; -1 — не дочитано. */
function declEnd(s: string, from: number): number {
  const gt = s.indexOf(">", from);
  const br = s.indexOf("[", from);
  if (br !== -1 && (gt === -1 || br < gt)) {
    const m = /\]\s*>/g;
    m.lastIndex = br;
    const r = m.exec(s);
    return r ? r.index + r[0].length : -1;
  }
  return gt === -1 ? -1 : gt + 1;
}

export class SaxParser {
  private buf = "";
  /** Тег или комментарий длиннее MAX_TOKEN: разбор брошен, остаток части не прочитан. */
  overflow = false;

  constructor(private readonly h: SaxHandler) {}

  get stopped(): boolean {
    return this.overflow || Boolean(this.h.done);
  }

  write(chunk: string): void {
    if (this.stopped) return;
    const s = this.buf ? this.buf + chunk : chunk;
    const used = this.run(s);
    this.buf = used < s.length ? s.slice(used) : "";
    if (this.buf.length > MAX_TOKEN) {
      this.overflow = true;
      this.buf = "";
    }
  }

  /** Конец данных: хвостовой текст без закрывающего тега отдаём, недописанный тег выбрасываем. */
  end(): void {
    if (!this.stopped && this.buf && this.buf[0] !== "<") this.h.text?.(decodeEntities(this.buf));
    this.buf = "";
  }

  /** Разбирает s насколько может; возвращает позицию первого не разобранного символа (начало недочитанного токена). */
  private run(s: string): number {
    const h = this.h;
    const n = s.length;
    let i = 0;
    while (i < n) {
      if (h.done) return n;
      if (s.charCodeAt(i) !== 60 /* < */) {
        const lt = s.indexOf("<", i);
        let end = lt === -1 ? n : lt;
        if (lt === -1) {
          // Текст может оборваться посреди «&amp;» — хвост от последнего «&» без «;» ждёт следующего куска.
          const amp = s.lastIndexOf("&", n - 1);
          if (amp >= i && n - amp < 12 && s.indexOf(";", amp) === -1) end = amp;
        }
        if (end > i) h.text?.(decodeEntities(s.slice(i, end)));
        i = end;
        if (lt === -1) return i;
        continue;
      }
      if (i + 1 >= n) return i;
      const c = s.charCodeAt(i + 1);
      if (c === 47 /* / */) {
        const gt = s.indexOf(">", i + 2);
        if (gt === -1) return i;
        h.close?.(localName(s.slice(i + 2, gt).trim()));
        i = gt + 1;
      } else if (c === 33 /* ! */) {
        if (n - i < 9 && ("<![CDATA[".startsWith(s.slice(i)) || "<!--".startsWith(s.slice(i)))) return i;
        if (s.startsWith("<!--", i)) {
          const e = s.indexOf("-->", i + 4);
          if (e === -1) return i;
          i = e + 3;
        } else if (s.startsWith("<![CDATA[", i)) {
          const e = s.indexOf("]]>", i + 9);
          if (e === -1) return i;
          h.text?.(s.slice(i + 9, e));
          i = e + 3;
        } else {
          const e = declEnd(s, i + 2);
          if (e === -1) return i;
          i = e;
        }
      } else if (c === 63 /* ? */) {
        const e = s.indexOf("?>", i + 2);
        if (e === -1) return i;
        i = e + 2;
      } else {
        const gt = tagEnd(s, i + 1);
        if (gt === -1) return i;
        const selfClosing = s.charCodeAt(gt - 1) === 47;
        const body = s.slice(i + 1, selfClosing ? gt - 1 : gt);
        const ws = body.search(/\s/);
        const name = localName(ws === -1 ? body : body.slice(0, ws));
        h.open?.(name, new Tag(ws === -1 ? "" : body.slice(ws)));
        if (selfClosing && !h.done) h.close?.(name);
        i = gt + 1;
      }
    }
    return i;
  }
}

/** Разбор XML-строки целиком — для небольших частей и тестов на фикстурах. */
export function parseXmlString(xml: string, h: SaxHandler): void {
  const p = new SaxParser(h);
  p.write(xml);
  p.end();
}

/**
 * Обработчик-помощник: пропускает поддеревья с заданными локальными именами. mc:Fallback — копия того же
 * содержимого для старых программ (надпись в DOCX лежит и в mc:Choice, и в mc:Fallback), без пропуска текст
 * задвоился бы.
 */
export class SkipDepth {
  private depth = 0;
  constructor(private readonly names: ReadonlySet<string>) {}
  /** Сейчас внутри пропускаемого поддерева — текст игнорировать. */
  get active(): boolean {
    return this.depth > 0;
  }
  /** Вызывать на каждом open; true — элемент внутри пропускаемого поддерева (или сам пропускается). */
  open(name: string): boolean {
    if (this.depth > 0 || this.names.has(name)) {
      this.depth++;
      return true;
    }
    return false;
  }
  /** Вызывать на каждом close; true — закрытие внутри пропускаемого поддерева. */
  close(): boolean {
    if (this.depth > 0) {
      this.depth--;
      return true;
    }
    return false;
  }
}
