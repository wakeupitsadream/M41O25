import "server-only";
import type JSZip from "jszip";
import { clipText, shareBudget } from "./compact";
import { cutAfterLast, fitSections, sharedStrings, sheetOrder, sheetText, slidesText, type Section } from "./extract-xml";

/*
 * Текст из документов, приложенных к сообщению помощника (docs/AI-CHAT.md §5). Фото сюда не попадают — они
 * уходят в модель картинкой. Тяжёлые библиотеки (pdf.js внутри unpdf, mammoth, jszip) импортируются лениво:
 * большинство сообщений без документов, и холодный старт стрим-роута не должен за них платить.
 */

/** Суммарный лимит извлечённого текста на сообщение: ~8500 токенов — дороже, чем весь остальной запрос. */
export const DOC_TEXT_LIMIT = 30_000;
/** Меньше — считаем, что текстового слоя нет (скан): колонтитулы и номера страниц дают пару десятков символов. */
const SCAN_PDF_MIN_CHARS = 50;
/** pdf.js разбирает страницы по одной; дальше этого номера не идём даже при пустых страницах — время функции не резиновое. */
const PDF_MAX_PAGES = 300;
/**
 * Защита от zip-бомбы: 4 МБ архива, распакованные в гигабайт XML, положили бы функцию по памяти. Настоящие
 * документы с картинками весят в распакованном виде десятки мегабайт, и почти всё — сами картинки, которые мы не читаем.
 */
const MAX_UNZIPPED_BYTES = 120 * 1024 * 1024;
/** Сколько байт XML читаем из одного листа или слайда: из 3 МБ разметки выходит заведомо больше 30 000 символов текста. */
const PART_XML_BYTES = 3 * 1024 * 1024;
/** Общие строки книги нужны целиком (ячейка может ссылаться на последнюю), поэтому потолок выше. */
const SHARED_XML_BYTES = 16 * 1024 * 1024;
/** mammoth читает word/document.xml целиком; больше — это не конспект, а книга, и её всё равно пришлось бы резать. */
const DOCX_XML_BYTES = 40 * 1024 * 1024;

export type ExtractInput = { mime: string; name: string; body: Buffer };
export type ExtractResult = { text: string; truncated: boolean; note?: string };

export type DocumentKind = "image" | "pdf" | "docx" | "pptx" | "xlsx" | "text" | "doc" | "xls" | "ppt" | "unknown";

const BY_MIME: Record<string, DocumentKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "text/plain": "text",
  "text/csv": "text",
  "text/markdown": "text",
};

const BY_EXT: Record<string, DocumentKind> = {
  pdf: "pdf",
  docx: "docx",
  pptx: "pptx",
  xlsx: "xlsx",
  doc: "doc",
  xls: "xls",
  ppt: "ppt",
  txt: "text",
  csv: "text",
  md: "text",
};

/** Тип документа по mime из базы, а при общем mime (octet-stream от некоторых браузеров) — по расширению имени. */
export function documentKind(mime: string, name: string): DocumentKind {
  if (mime.startsWith("image/")) return "image";
  const byMime = BY_MIME[mime.toLowerCase()];
  if (byMime) return byMime;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return BY_EXT[ext] ?? "unknown";
}

const LEGACY_NOTE: Record<"doc" | "xls" | "ppt", string> = {
  doc: "старый формат .doc не читается — сохрани как .docx или пришли фото страниц",
  xls: "старый формат .xls не читается — сохрани как .xlsx или пришли фото таблицы",
  ppt: "старый формат .ppt не читается — сохрани как .pptx или пришли фото слайдов",
};

const empty = (note: string): ExtractResult => ({ text: "", truncated: false, note });

/** Обрезка сплошного текста (DOCX, TXT) — по символам: страниц у них нет, а слово «страница» соврало бы. */
function fitPlain(text: string, limit: number): ExtractResult {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[^\S\n]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (clean.length <= limit) return { text: clean, truncated: false };
  const shown = clipText(clean, limit);
  return { text: shown, truncated: true, note: `документ обрезан, показаны первые ${shown.length} из ${clean.length} символов` };
}

/**
 * Текст одного документа в пределах limit символов. Никогда не бросает: битый или запароленный файл превращается
 * в пометку для модели («не удалось прочитать…»), и она честно скажет об этом студенту, а не промолчит.
 */
export async function extractText(input: ExtractInput, limit = DOC_TEXT_LIMIT): Promise<ExtractResult> {
  const kind = documentKind(input.mime, input.name);
  try {
    switch (kind) {
      case "pdf":
        return await pdfText(input.body, limit);
      case "docx":
        return await docxText(input.body, limit);
      case "pptx":
        return await pptxText(input.body, limit);
      case "xlsx":
        return await xlsxText(input.body, limit);
      case "text":
        return fitPlain(decodeText(input.body), limit);
      case "doc":
      case "xls":
      case "ppt":
        return empty(LEGACY_NOTE[kind]);
      case "image":
        return { text: "", truncated: false };
      default:
        return empty("этот формат не читается — пришли PDF, DOCX, XLSX, PPTX, TXT или фото");
    }
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "PasswordException") return empty("PDF защищён паролем — сними пароль или пришли фото страниц");
    if (e instanceof TooLargeError) return empty(e.message);
    console.error("[assistant/extract]", input.name, e instanceof Error ? e.message : e);
    return empty("не удалось прочитать файл — пересохрани его или пришли фото");
  }
}

/** Документу, которому досталось меньше этого, место не выделяем: обрывок в пару строк только запутает модель. */
const MIN_DOC_SHARE = 300;

/**
 * Документы одного сообщения в общем бюджете limit (docs/AI-CHAT.md §5: 30 000 символов на сообщение).
 * Сначала каждый читается как если бы был один, потом бюджет делится поровну с переливом (shareBudget):
 * конспект на страницу и книга на 300 страниц — конспект целиком, книге остальное. Кому досталось меньше
 * прочитанного, перечитываем с его долей — так пометка «показаны первые N страниц» остаётся точной.
 */
export async function extractDocuments(files: readonly ExtractInput[], limit = DOC_TEXT_LIMIT): Promise<ExtractResult[]> {
  const full: ExtractResult[] = [];
  for (const f of files) full.push(await extractText(f, limit));
  const shares = shareBudget(
    full.map((r) => r.text.length),
    limit,
  );
  const out: ExtractResult[] = [];
  for (const [i, r] of full.entries()) {
    if (shares[i] >= r.text.length) out.push(r);
    else if (shares[i] < MIN_DOC_SHARE) out.push(empty(`не поместился: на одно сообщение — до ${limit.toLocaleString("ru-RU")} символов текста документов, пришли его отдельно`));
    else out.push(await extractText(files[i], shares[i]));
  }
  return out;
}

class TooLargeError extends Error {}

/**
 * TXT/CSV: UTF-8, а если в нём битые последовательности — это почти наверняка Windows-1251 из «Блокнота»
 * (конспект, сохранённый на старом компьютере колледжа). BOM убираем.
 */
function decodeText(body: Buffer): string {
  const utf8 = body.toString("utf8").replace(/^﻿/, "");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("windows-1251").decode(body);
  } catch {
    return utf8;
  }
}

// ---------- PDF ----------

type PdfTextItem = { str?: string; hasEOL?: boolean };

/**
 * PDF постранично через pdf.js (unpdf): читаем, пока не набран бюджет, — книга на 300 страниц не должна
 * разбираться целиком ради первых 30 000 символов. Переводы строк — по hasEOL, пробелы схлопываем, как unpdf.
 */
async function pdfText(body: Buffer, limit: number): Promise<ExtractResult> {
  const { getDocumentProxy } = await import("unpdf");
  // Копия: pdf.js забирает (detach) переданный буфер, а Buffer из хранилища может быть срезом общего пула.
  const pdf = await getDocumentProxy(new Uint8Array(body));
  try {
    const pages: Section[] = [];
    let chars = 0;
    const last = Math.min(pdf.numPages, PDF_MAX_PAGES);
    for (let n = 1; n <= last && chars <= limit; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const raw = (content.items as PdfTextItem[])
        .filter((i) => typeof i.str === "string")
        .map((i) => `${i.str}${i.hasEOL ? "\n" : ""}`)
        .join("");
      const text = raw.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      page.cleanup();
      chars += text.length;
      pages.push({ label: `Страница ${n}`, text });
    }
    const readAll = pages.length === pdf.numPages;
    if (chars < SCAN_PDF_MIN_CHARS && (readAll || pages.length >= PDF_MAX_PAGES)) return empty("в этом PDF нет текста — пришли страницы фото");
    // Пустые страницы (картинки, разделители) в текст не идут, но в счёт «показаны N из M» — идут.
    const withText = pages.filter((p) => p.text);
    const fitted = fitSections(withText, limit, "pages", withText.length + (pdf.numPages - pages.length));
    return fitted;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// ---------- DOCX ----------

async function docxText(body: Buffer, limit: number): Promise<ExtractResult> {
  const zip = await openZip(body);
  const size = unzippedSize(zip, "word/document.xml");
  if (size !== null && size > DOCX_XML_BYTES) throw new TooLargeError("документ слишком большой — пришли нужные страницы отдельным файлом или фото");
  const mammoth = (await import("mammoth")).default;
  const { value } = await mammoth.extractRawText({ buffer: body });
  return fitPlain(value, limit);
}

// ---------- PPTX / XLSX ----------

async function pptxText(body: Buffer, limit: number): Promise<ExtractResult> {
  const zip = await openZip(body);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const files: Record<string, string> = {};
  for (const n of names) files[n] = await readPart(zip, n, PART_XML_BYTES, "p");
  const slides = slidesText(files);
  if (slides.length === 0) return empty("в презентации нет текста — пришли фото слайдов");
  return fitSections(slides, limit, "slides");
}

async function xlsxText(body: Buffer, limit: number): Promise<ExtractResult> {
  const zip = await openZip(body);
  const files: Record<string, string> = {};
  for (const n of ["xl/workbook.xml", "xl/_rels/workbook.xml.rels"]) if (zip.file(n)) files[n] = await readPart(zip, n, PART_XML_BYTES, "sheet");
  const shared = sharedStrings(await readPart(zip, "xl/sharedStrings.xml", SHARED_XML_BYTES, "si"));
  const order = sheetOrder(
    files,
    Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)),
  );
  // Листы читаем по одному и бросаем, когда текста уже больше бюджета: остальные попадут в «показаны N из M».
  const sheets: Section[] = [];
  let chars = 0;
  for (const s of order) {
    if (chars > limit) break;
    const text = sheetText(await readPart(zip, s.path, PART_XML_BYTES, "row"), shared);
    chars += text.length;
    if (text) sheets.push({ label: s.label, text });
  }
  if (sheets.length === 0) return empty("в таблице нет данных — пришли фото или другой файл");
  return fitSections(sheets, limit, "sheets", sheets.length + Math.max(0, order.length - sheets.length));
}

// ---------- zip ----------

async function openZip(body: Buffer): Promise<JSZip> {
  const JSZipCtor = (await import("jszip")).default;
  const zip = await JSZipCtor.loadAsync(body);
  let total = 0;
  for (const f of Object.values(zip.files)) total += unzippedSizeOf(f) ?? 0;
  if (total > MAX_UNZIPPED_BYTES) throw new TooLargeError("файл после распаковки слишком большой — пришли нужную часть отдельно или фото");
  return zip;
}

/** Размер после распаковки из центрального каталога zip: поле приватное у JSZip, но стабильно во всей ветке 3.x. */
const unzippedSizeOf = (f: JSZip.JSZipObject): number | null => {
  const size = (f as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  return typeof size === "number" ? size : null;
};

const unzippedSize = (zip: JSZip, name: string) => {
  const f = zip.file(name);
  return f ? unzippedSizeOf(f) : null;
};

/**
 * Часть архива как текст, не больше maxBytes: распаковываем потоком и бросаем, набрав лимит, — лист на 200 МБ
 * разметки не должен распаковываться целиком ради первых строк. Если пришлось оборвать — отрезаем хвост после
 * последнего целого элемента tag (обрыв посреди UTF-8 или атрибута парсер не простит).
 */
async function readPart(zip: JSZip, name: string, maxBytes: number, tag: string): Promise<string> {
  const f = zip.file(name);
  if (!f) return "";
  const size = unzippedSizeOf(f);
  if (size !== null && size <= maxBytes) return f.async("string");
  // Поток JSZip — readable-stream 2.x без async-итератора, поэтому на событиях; pause() останавливает распаковку.
  const chunks: Buffer[] = [];
  let got = 0;
  let cut = false;
  await new Promise<void>((resolve, reject) => {
    const s = f.nodeStream("nodebuffer");
    s.on("data", (chunk: Buffer) => {
      if (cut) return;
      chunks.push(chunk);
      got += chunk.length;
      if (got >= maxBytes) {
        cut = true;
        s.pause();
        resolve();
      }
    });
    s.on("end", () => resolve());
    s.on("error", reject);
  });
  const text = Buffer.concat(chunks).subarray(0, maxBytes).toString("utf8");
  return cut ? cutAfterLast(text, tag) : text;
}
