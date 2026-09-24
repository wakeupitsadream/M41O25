import "server-only";
import { shareBudget } from "./compact";
import { readDocx } from "./extract-docx";
import { cleanPlain, emptyResult, fitRaw, type ExtractResult, type Raw } from "./extract-fit";
import { decodeText } from "./extract-plain";
import { pdfRaw, type PdfPage, type PdfStop } from "./extract-pdf";
import { readPptx, readXlsx } from "./extract-xml";
import { ArchiveRejected, isCfb, openArchive, type PartSource } from "./extract-zip";

export type { ExtractResult } from "./extract-fit";

/*
 * Текст из документов, приложенных к сообщению помощника (docs/AI-CHAT.md §5). Фото сюда не попадают — они
 * уходят в модель картинкой. Тяжёлые библиотеки (pdf.js внутри unpdf, jszip) импортируются лениво: большинство
 * сообщений без документов, и холодный старт стрим-роута не должен за них платить.
 *
 * Память: DOCX/PPTX/XLSX распаковываются и разбираются потоком (extract-zip, extract-sax) под жёсткими потолками
 * реально распакованных байт — размерам из заголовков архива не верим, zip-бомба упирается в потолок и получает
 * пометку. Время: на все документы сообщения — общий дедлайн, недочитанное помечается и не держит ответ.
 */

/** Суммарный лимит извлечённого текста на сообщение: ~8500 токенов — дороже, чем весь остальной запрос. */
export const DOC_TEXT_LIMIT = 30_000;
/**
 * Дедлайн извлечения на все документы сообщения. Роут живёт 120 с, из них модели нужно до 100 (model.ts, TOTAL_MS) —
 * на чтение остаётся 20. Не успели — пометка «не успел», а не оборванный ответ и невозвращённая квота.
 */
export const EXTRACT_MS = 20_000;
/** pdf.js разбирает страницы по одной; дальше этого номера не идём даже при пустых страницах — время функции не резиновое. */
const PDF_MAX_PAGES = 300;
/**
 * Потолок реально распакованных байт одной части архива (лист, слайд, document.xml). Память от него не зависит —
 * разбор потоковый и останавливается по бюджету символов; он ограничивает только работу на разметке без текста
 * (миллион пустых отформатированных ячеек, бомба из нулей): 16 МБ такой разметки разбираются за 0,5–0,8 с.
 */
const PART_BYTES = 16 * 1024 * 1024;
/** Общий потолок распакованных байт на документ — все части вместе: 1000 слайдов по 100 КБ разметки дальше не читаем. */
const DOC_BYTES = 64 * 1024 * 1024;

export type ExtractInput = { mime: string; name: string; body: Buffer };

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

const none = (note?: string): Raw => ({ kind: "none", note });

const NOT_STARTED = "не успел прочитать файл — пришли его отдельным сообщением";

/**
 * Документ → сырой текст (разделы или сплошной) при бюджете limit символов. Читается один раз: подгонка под долю
 * бюджета — fitRaw, без повторного чтения. Никогда не бросает: битый или запароленный файл превращается в пометку
 * для модели («не удалось прочитать…»), и она честно скажет об этом студенту, а не промолчит.
 */
async function readDocument(input: ExtractInput, limit: number, deadline: number): Promise<Raw> {
  const kind = documentKind(input.mime, input.name);
  try {
    switch (kind) {
      case "pdf":
        return await readPdf(input.body, limit, deadline);
      case "docx":
      case "pptx":
      case "xlsx": {
        // Запароленный DOCX/XLSX — не zip, а контейнер CFB; JSZip сказал бы только «не нашёл каталог».
        if (isCfb(input.body)) return none("файл защищён паролем или сохранён в старом формате — сними пароль, пересохрани или пришли фото");
        const source: PartSource = await openArchive(input.body, { partBytes: PART_BYTES, totalBytes: DOC_BYTES, deadline });
        if (kind === "docx") return await readDocx(source, limit);
        if (kind === "pptx") return await readPptx(source, limit);
        return await readXlsx(source, limit);
      }
      case "text":
        return { kind: "plain", text: cleanPlain(decodeText(input.body)), complete: true };
      case "doc":
      case "xls":
      case "ppt":
        return none(LEGACY_NOTE[kind]);
      case "image":
        return none();
      default:
        return none("этот формат не читается — пришли PDF, DOCX, XLSX, PPTX, TXT или фото");
    }
  } catch (e) {
    const name = (e as { name?: string }).name ?? "";
    if (name === "PasswordException") return none("PDF защищён паролем — сними пароль или пришли фото страниц");
    if (e instanceof ArchiveRejected) return none(e.message);
    console.error("[assistant/extract]", input.name, e instanceof Error ? e.message : e);
    return none("не удалось прочитать файл — пересохрани его или пришли фото");
  }
}

/** Текст одного документа в пределах limit символов. */
export async function extractText(input: ExtractInput, limit = DOC_TEXT_LIMIT, deadline = Date.now() + EXTRACT_MS): Promise<ExtractResult> {
  return fitRaw(await readDocument(input, limit, deadline), limit);
}

/** Документу, которому досталось меньше этого, место не выделяем: обрывок в пару строк только запутает модель. */
const MIN_DOC_SHARE = 300;

/**
 * Документы одного сообщения в общем бюджете limit (docs/AI-CHAT.md §5: 30 000 символов на сообщение) и общем
 * дедлайне. Каждый читается ОДИН раз, как если бы был один; потом бюджет делится поровну с переливом (shareBudget):
 * конспект на страницу и книга на 300 страниц — конспект целиком, книге остальное. Кому досталось меньше
 * прочитанного, подгоняем уже прочитанное под его долю (fitRaw) — пометка «показаны первые N страниц» остаётся
 * точной, а документ не разбирается второй раз. Документы, до которых не дошло время, получают пометку.
 */
export async function extractDocuments(files: readonly ExtractInput[], limit = DOC_TEXT_LIMIT, deadline = Date.now() + EXTRACT_MS): Promise<ExtractResult[]> {
  const raws: Raw[] = [];
  for (const f of files) raws.push(Date.now() < deadline ? await readDocument(f, limit, deadline) : none(NOT_STARTED));
  const full = raws.map((r) => fitRaw(r, limit));
  const shares = shareBudget(
    full.map((r) => r.text.length),
    limit,
  );
  return raws.map((raw, i) => {
    if (shares[i] >= full[i].text.length) return full[i];
    if (shares[i] < MIN_DOC_SHARE) return emptyResult(`не поместился: на одно сообщение — до ${limit.toLocaleString("ru-RU")} символов текста документов, пришли его отдельно`);
    return fitRaw(raw, shares[i]);
  });
}

// ---------- PDF ----------

type PdfTextItem = { str?: string; hasEOL?: boolean };

/**
 * PDF постранично через pdf.js (unpdf): читаем, пока не набран бюджет и не вышло время, — книга на 300 страниц не
 * должна разбираться целиком ради первых 30 000 символов. Переводы строк — по hasEOL, пробелы схлопываем, как unpdf.
 */
async function readPdf(body: Buffer, limit: number, deadline: number): Promise<Raw> {
  const { getDocumentProxy } = await import("unpdf");
  // Копия: pdf.js забирает (detach) переданный буфер, а Buffer из хранилища может быть срезом общего пула.
  const pdf = await getDocumentProxy(new Uint8Array(body));
  try {
    const pages: PdfPage[] = [];
    let chars = 0;
    let stop: PdfStop = null;
    for (let n = 1; n <= pdf.numPages; n++) {
      if (chars > limit) stop = "budget";
      else if (n > PDF_MAX_PAGES) stop = "max";
      else if (Date.now() >= deadline) stop = "time";
      if (stop) break;
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const raw = (content.items as PdfTextItem[])
        .filter((i) => typeof i.str === "string")
        .map((i) => `${i.str}${i.hasEOL ? "\n" : ""}`)
        .join("");
      const text = raw.replace(/[^\S\n]+/g, " ").replace(/ ?\n ?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      page.cleanup();
      chars += text.length;
      pages.push({ n, text });
    }
    return pdfRaw(pages, pdf.numPages, stop);
  } finally {
    await pdf.loadingTask.destroy();
  }
}
