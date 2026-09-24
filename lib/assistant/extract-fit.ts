import { clipText } from "./compact";

/*
 * Подгонка извлечённого текста под бюджет символов (docs/AI-CHAT.md §5). Документ читается ОДИН раз в сырое
 * представление (Raw: разделы или сплошной текст плюс что осталось недочитанным), а обрезать его под долю бюджета
 * можно сколько угодно раз без повторного чтения — extractDocuments сначала меряет все документы при полном бюджете,
 * потом делит бюджет и подгоняет каждый под свою долю.
 */

/** Кусок документа с заголовком: слайд, лист, страница. n — его номер в документе (1…total), пустые тоже считаются. */
export type Section = { label: string; text: string; n?: number };

export type SectionUnit = "slides" | "sheets" | "pages";

export type ExtractResult = { text: string; truncated: boolean; note?: string };

export type Raw =
  /** Текста нет: картинка, скан, старый формат, ошибка — note объясняет модели почему. */
  | { kind: "none"; note?: string }
  /** DOCX, TXT — уже чистый текст. complete = false — дочитать не дали бюджет, потолок распаковки или время. */
  | { kind: "plain"; text: string; complete: boolean; notes?: string[] }
  /**
   * PDF, PPTX, XLSX. sections — только разделы с текстом; total — сколько разделов в документе всего; read — сколько
   * из них просмотрено по порядку (пустые тоже): остальные не читались, потому что бюджет уже набран.
   */
  | { kind: "sections"; sections: Section[]; unit: SectionUnit; total: number; read: number; notes?: string[] };

export const emptyResult = (note?: string): ExtractResult => (note ? { text: "", truncated: false, note } : { text: "", truncated: false });

const joinNotes = (...notes: (string | undefined)[]): string | undefined => {
  const list = notes.filter((n): n is string => Boolean(n));
  return list.length ? list.join("; ") : undefined;
};

const withNotes = (r: ExtractResult, notes: readonly string[] | undefined): ExtractResult => {
  const note = joinNotes(r.note, ...(notes ?? []));
  return note ? { ...r, note } : r;
};

/** Пометка о недочитанной части архива: потолок распаковки (zip-бомба или правда огромный файл) или время. */
export function cutNotes(reason: "part" | "total" | "time" | null): string[] {
  if (!reason) return [];
  return [reason === "time" ? "не успел дочитать файл — прочитана только часть" : "часть файла не прочитана: после распаковки он слишком большой"];
}

/** То же, когда из-за этого не прочитано вообще ничего. */
export function cutEmptyNote(reason: "part" | "total" | "time" | null): string | undefined {
  if (!reason) return undefined;
  return reason === "time" ? "не успел прочитать файл — пришли его отдельным сообщением" : "файл после распаковки слишком большой — пришли нужную часть отдельно или фото";
}

/** Сырой документ → текст не длиннее limit с пометками. Чистая функция: зовётся на каждую долю бюджета. */
export function fitRaw(raw: Raw, limit: number): ExtractResult {
  switch (raw.kind) {
    case "none":
      return emptyResult(raw.note);
    case "plain":
      return withNotes(fitPlain(raw.text, limit, raw.complete), raw.notes);
    case "sections":
      return withNotes(fitSections(raw.sections, limit, raw.unit, raw.total, raw.read), raw.notes);
  }
}

/**
 * Пробелы подряд → один, хвостовые пробелы строк и лишние пустые строки — прочь. Табуляции остаются: в DOCX это
 * w:tab, в TSV/CSV из «Блокнота» — границы колонок, без них таблица слипнется.
 */
export const cleanPlain = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n\t]+/g, " ")
    .replace(/ +(?=\n)|(?<=\n) +/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/**
 * Обрезка сплошного текста (DOCX, TXT) — по символам: страниц у них нет, а слово «страница» соврало бы. Текст уже
 * чистый (читатель DOCX нормализует абзацы, TXT проходит cleanPlain): здесь пробелы не трогаем, иначе пустая ячейка
 * таблицы «08.10 |  | Петров» схлопнулась бы. complete = false: документ дочитан не до конца, и сколько в нём
 * всего — неизвестно, так и говорим.
 */
export function fitPlain(text: string, limit: number, complete = true): ExtractResult {
  if (text.length <= limit && complete) return { text, truncated: false };
  const shown = clipText(text, limit);
  const note = complete
    ? `документ обрезан, показаны первые ${shown.length} из ${text.length} символов`
    : `документ обрезан, показано только начало — первые ${shown.length} символов`;
  return { text: shown, truncated: true, note };
}

/** «из 21 страницы», «из 40 страниц»: после «из» — родительный падеж, единственное число только на 1 (кроме 11). */
const genitive = (n: number, one: string, many: string) => (n % 10 === 1 && n % 100 !== 11 ? one : many);

const UNIT_WORDS: Record<SectionUnit, { one: string; many: string; last: string }> = {
  slides: { one: "слайда", many: "слайдов", last: "последний показан" },
  sheets: { one: "листа", many: "листов", last: "последний показан" },
  pages: { one: "страницы", many: "страниц", last: "последняя показана" },
};

/** Меньше этого остатка бюджета частичный кусок не добавляем: полстрочки листа модели не помогут, а токены съедят. */
const MIN_PARTIAL = 400;

/**
 * Разделы документа → текст в пределах limit символов. Разделы берутся целиком, пока влезают; следующий —
 * частично, если осталось заметное место. Пометка об обрезке говорит, докуда показано: «показаны первые 12 из
 * 40 страниц» — по ней модель честно скажет, что прочитала не всё. Номер «первые N» — номер последнего показанного
 * раздела в документе, а не число непустых: пустые страницы между ними тоже просмотрены.
 * total — разделов в документе всего, read — сколько из них просмотрено (PDF и книга бросаются, как только бюджет
 * набран). Документ не обрезан, только если всё просмотрено и всё влезло.
 */
export function fitSections(
  sections: readonly Section[],
  limit: number,
  unit: SectionUnit,
  total = sections.length,
  read = total,
): ExtractResult {
  const withHeaders = total > 1 || unit !== "pages";
  const pieces = sections.map((s) => (withHeaders ? `— ${s.label} —\n${s.text}` : s.text));
  const all = pieces.join("\n\n");
  if (all.length <= limit && read >= total) return { text: all, truncated: false };

  const out: string[] = [];
  let used = 0;
  let partial = false;
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
      partial = true;
    }
    break;
  }
  const words = UNIT_WORDS[unit];
  // Всё, что прочитано, влезло — показано до последнего просмотренного раздела (хвост из пустых тоже просмотрен).
  const shownUpTo = out.length === sections.length && !partial ? read : (sections[out.length - 1]?.n ?? out.length);
  let note: string;
  // Один огромный лист «показаны первые 1 из 1» не объясняет ничего — говорим прямо, что видно только начало.
  if (total <= 1) note = "документ обрезан, показано только начало";
  else if (shownUpTo >= total) note = `документ обрезан: из ${total} ${genitive(total, words.one, words.many)} ${words.last} не целиком`;
  else note = `документ обрезан, показаны первые ${shownUpTo} из ${total} ${genitive(total, words.one, words.many)}`;
  return { text: out.join("\n\n"), truncated: true, note };
}
