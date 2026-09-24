import type { Raw, Section } from "./extract-fit";

/*
 * PDF: что делать с уже вытащенным текстом страниц (docs/AI-CHAT.md §5). Сам pdf.js — в extract.ts (server-only),
 * здесь чистая логика: какие страницы — сканы, и что сказать модели. Типичный случай — курсовая с набранным
 * титулом и отсканированными страницами: без пометки модель видела четыре строки титула и отвечала, что задач
 * в файле нет, вместо того чтобы попросить фото.
 */

/** Меньше — во всём документе нет текстового слоя (скан): колонтитулы и номера страниц дают пару десятков символов. */
const SCAN_PDF_MIN_CHARS = 50;
/** Меньше значимых символов на странице — страница без текста (скан или картинка). «Приложение А» — уже текст. */
const SCAN_PAGE_MIN_CHARS = 10;

/** Номер страницы в колонтитуле: «12», «- 12 -», «стр. 12», «Page 3 of 10». */
const PAGE_NUMBER = /^(?:стр(?:аница)?\.?|с\.|page|p\.)?\s*[-–—]?\s*\d{1,4}(?:\s*(?:из|of|\/)\s*\d{1,4})?\s*[-–—]?$/i;
/** Водяные знаки сканеров-приложений: на скане это единственный «текст» страницы. */
const SCANNER_MARK = /camscanner|scanned with|scanned by|adobe scan|clearscanner|отсканирован|сканировано/i;

export type PdfPage = { n: number; text: string };
/** Почему чтение страниц остановилось: набран бюджет, потолок страниц, дедлайн; null — прочитаны все. */
export type PdfStop = "budget" | "max" | "time" | null;

/**
 * Значимые символы каждой страницы: без колонтитулов и водяных знаков — строк, которые повторяются на половине
 * страниц и больше (на скане «Scanned with CamScanner» — единственная строка каждой страницы), без номеров
 * страниц и пробелов. Только для решения «скан или нет»: в текст для модели страница идёт как есть.
 */
export function meaningfulChars(pages: readonly PdfPage[]): number[] {
  const lines = pages.map((p) => [
    ...new Set(
      p.text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
  ]);
  const freq = new Map<string, number>();
  for (const page of lines) for (const l of page) freq.set(l, (freq.get(l) ?? 0) + 1);
  const boilerplate = (l: string) => {
    const f = freq.get(l) ?? 0;
    return (pages.length >= 2 && f >= 2 && f * 2 >= pages.length) || PAGE_NUMBER.test(l) || SCANNER_MARK.test(l);
  };
  return lines.map((page) =>
    page
      .filter((l) => !boilerplate(l))
      .join("")
      .replace(/\s/g, "").length,
  );
}

/** [2, 3, 4, 7, 9, 10] → «2–4, 7, 9–10»; длинный список обрывается многоточием — модели хватит начала. */
export function pageRanges(ns: readonly number[], maxRanges = 6): string {
  const ranges: string[] = [];
  for (let i = 0; i < ns.length; ) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    ranges.push(i === j ? String(ns[i]) : `${ns[i]}–${ns[j]}`);
    i = j + 1;
  }
  return ranges.length > maxRanges ? `${ranges.slice(0, maxRanges).join(", ")}, …` : ranges.join(", ");
}

/**
 * Прочитанные страницы (1…read по порядку) → сырой документ. Весь документ без текста — просьба прислать фото.
 * Часть страниц без текста — пометка «страниц без текста (вероятно, сканы): N из M (стр. …)»; M — все страницы
 * документа, если прочитаны все, иначе честно «из K прочитанных».
 */
export function pdfRaw(pages: readonly PdfPage[], numPages: number, stop: PdfStop): Raw {
  const read = pages.length;
  const meaningful = meaningfulChars(pages);
  const total = meaningful.reduce((a, b) => a + b, 0);
  if (total < SCAN_PDF_MIN_CHARS) {
    if (stop === "time") return { kind: "none", note: "не успел прочитать файл — пришли его отдельным сообщением" };
    return { kind: "none", note: "в этом PDF нет текста — пришли страницы фото" };
  }
  const sections: Section[] = pages.filter((p) => p.text).map((p) => ({ label: `Страница ${p.n}`, n: p.n, text: p.text }));
  const blank = pages.filter((_, i) => meaningful[i] < SCAN_PAGE_MIN_CHARS).map((p) => p.n);
  const notes: string[] = [];
  if (blank.length) {
    const of = read >= numPages ? String(numPages) : `${read} прочитанных`;
    notes.push(`страниц без текста (вероятно, сканы): ${blank.length} из ${of} (стр. ${pageRanges(blank)}) — пришли их фото`);
  }
  if (stop === "time") notes.push("не успел дочитать файл — прочитана только часть");
  return { kind: "sections", sections, unit: "pages", total: numPages, read, notes };
}
