/**
 * Разбор списка людей, вставленного из беседы: «Фамилия Имя Отчество» по строке,
 * необязательный второй столбец — дата рождения. Чистые функции: одинаково работают
 * в предпросмотре на клиенте и в server action при сохранении.
 */

/** Больше строк за раз не разбираем: список группы — это десятки, а не тысячи. */
export const MAX_LINES = 300;
/** Столько человек максимум добавляем одним нажатием. */
export const MAX_PEOPLE = 100;
/** Год-заглушка, когда в списке указаны только день и месяц: в приложении видно лишь ДД.ММ. */
export const NO_YEAR = 2000;

export type BirthdayNote = "none" | "ok" | "no-year" | "bad";

export type PersonLine = {
  /** Порядковый номер непустой строки, 1-based — чтобы показать в предпросмотре, о какой строке речь. */
  line: number;
  raw: string;
  fullName: string;
  /** Нормализованное ФИО для сравнения: регистр, ё→е, лишние пробелы. */
  key: string;
  birthday: string | null;
  birthdayNote: BirthdayNote;
  birthdayRaw: string | null;
  status: "new" | "exists" | "dupe";
  /** Как человек записан в группе (если уже есть). */
  existingName?: string;
};

export type ParseIssue = { line: number; raw: string; reason: string };

export type ImportPlan = {
  people: PersonLine[];
  issues: ParseIssue[];
  counts: { parsed: number; add: number; exists: number; dupe: number; issues: number };
};

const SPACES = /[\s\u00a0\u2000-\u200b\u202f\u2060\ufeff]+/g;
const QUOTES = /[«»„“”"']/g;
const DASHES = /[‐‑‒–—―]/g;

/** ФИО к канону: ё→е, кавычки и разные дефисы прочь, регистр вниз, пробелы схлопнуты. */
export const normalizeFullName = (value: string): string =>
  value
    .replace(QUOTES, "")
    .replace(DASHES, "-")
    .replace(SPACES, " ")
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s*-\s*/g, "-");

/** Написание для базы: те же кавычки и пробелы прибраны, но регистр как ввели. */
export const cleanFullName = (value: string): string =>
  value.replace(QUOTES, "").replace(SPACES, " ").trim().replace(/^[.,;:]+|[,;:]+$/g, "").trim();

const daysInMonth = (y: number, m: number) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

const iso = (y: number, m: number, d: number): string | null => {
  if (m < 1 || m > 12 || d < 1 || y < 1900 || y > 2100) return null;
  if (d > daysInMonth(y, m)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * Дата рождения из второго столбца: ДД.ММ.ГГГГ, ДД.ММ (год-заглушка) и ГГГГ-ММ-ДД.
 * Разделителем годится точка, слэш или дефис. Непонятная дата — не ошибка строки: `bad`, человек добавится без ДР.
 */
export const parseBirthday = (value: string | null | undefined): { birthday: string | null; note: BirthdayNote } => {
  const raw = (value ?? "").replace(SPACES, " ").trim().replace(DASHES, "-");
  if (!raw) return { birthday: null, note: "none" };
  const isoMatch = raw.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})$/);
  if (isoMatch) {
    const d = iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    return d ? { birthday: d, note: "ok" } : { birthday: null, note: "bad" };
  }
  const full = raw.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (full) {
    const d = iso(Number(full[3]), Number(full[2]), Number(full[1]));
    return d ? { birthday: d, note: "ok" } : { birthday: null, note: "bad" };
  }
  const short = raw.match(/^(\d{1,2})[.\-/](\d{1,2})\.?$/);
  if (short) {
    const d = iso(NO_YEAR, Number(short[2]), Number(short[1]));
    return d ? { birthday: d, note: "no-year" } : { birthday: null, note: "bad" };
  }
  return { birthday: null, note: "bad" };
};

const DATE_LIKE = /^\d{1,2}[.\-/]\d{1,2}([.\-/]\d{2,4})?\.?$|^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/;

/**
 * Текст → строки. Переводы строки и «;» разделяют всегда; запятая тоже разделяет,
 * но кусок после неё, похожий на дату, приклеивается к предыдущему как второй столбец
 * («Иванов Иван, 01.02.2000» — это один человек, а не два).
 */
export const splitLines = (text: string): string[] => {
  const out: string[] = [];
  for (const chunk of text.replace(/\r/g, "").split(/[\n;]/)) {
    const parts = chunk.split(",");
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].replace(/[\u00a0\u2000-\u200b\u202f\u2060\ufeff]/g, " ");
      const trimmed = part.trim();
      if (!trimmed) continue;
      if (i > 0 && out.length > 0 && DATE_LIKE.test(trimmed)) {
        out[out.length - 1] = `${out[out.length - 1]} — ${trimmed}`;
        continue;
      }
      out.push(part.replace(/^\s+|\s+$/g, ""));
    }
  }
  return out;
};

/** Убрать нумерацию и маркеры списка: «1.», «1)», «12 -», «- », «•». */
export const stripBullet = (line: string): string =>
  line
    .replace(/^\s*[-–—•*·]+\s*/, "")
    .replace(/^\s*№?\s*\d{1,3}\s*[.)\]:–—-]*\s+/, "")
    .replace(/^\s*№?\s*\d{1,3}\s*[.)\]]\s*/, "")
    .trim();

/** Разделить строку на ФИО и второй столбец: таб, « — » или дата в хвосте. */
export const splitColumns = (line: string): { name: string; extra: string | null } => {
  const tab = line.indexOf("\t");
  if (tab >= 0) return { name: line.slice(0, tab), extra: line.slice(tab + 1).trim() || null };
  const dash = line.match(/\s+[-–—]\s+/);
  if (dash && dash.index !== undefined) {
    return { name: line.slice(0, dash.index), extra: line.slice(dash.index + dash[0].length).trim() || null };
  }
  const tail = line.match(/\s+(\d{1,2}[.\-/]\d{1,2}(?:[.\-/]\d{2,4})?\.?|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*$/);
  if (tail && tail.index !== undefined) return { name: line.slice(0, tail.index), extra: tail[1] };
  return { name: line, extra: null };
};

const LETTERS = /\p{L}/u;
const NAME_OK = /^[\p{L}\s'’.-]+$/u;

/** Похоже ли на ФИО: только буквы, апострофы и дефисы, от 2 букв, не длиннее пяти слов. */
const nameIssue = (name: string): string | null => {
  if (!name || !LETTERS.test(name)) return "не похоже на имя";
  if (/\d/.test(name)) return "не похоже на имя: цифры";
  if (!NAME_OK.test(name)) return "не похоже на имя: лишние символы";
  const letters = name.match(/\p{L}/gu)?.length ?? 0;
  if (letters < 2) return "слишком короткое имя";
  if (name.length > 80 || name.split(/\s+/).length > 5) return "слишком длинная строка";
  return null;
};

/**
 * Разбор вставленного списка с учётом того, кто уже есть в группе.
 * `existing` — все люди группы (включая удалённых): второй раз того же человека не заводим.
 */
export const planPeopleImport = (text: string, existing: readonly { fullName: string }[] = []): ImportPlan => {
  const known = new Map<string, string>();
  for (const u of existing) known.set(normalizeFullName(u.fullName), u.fullName);

  const people: PersonLine[] = [];
  const issues: ParseIssue[] = [];
  const seen = new Set<string>();
  const lines = splitLines(text);

  for (let i = 0; i < lines.length && i < MAX_LINES; i++) {
    const raw = lines[i];
    const line = i + 1;
    const stripped = stripBullet(raw);
    if (!stripped) continue;
    const { name, extra } = splitColumns(stripped);
    const fullName = cleanFullName(name);
    const bad = nameIssue(fullName);
    if (bad) {
      issues.push({ line, raw: raw.trim(), reason: bad });
      continue;
    }
    const { birthday, note } = parseBirthday(extra);
    const key = normalizeFullName(fullName);
    const existingName = known.get(key);
    const status = existingName ? "exists" : seen.has(key) ? "dupe" : "new";
    if (status === "new") seen.add(key);
    people.push({ line, raw: raw.trim(), fullName, key, birthday, birthdayNote: note, birthdayRaw: extra, status, existingName });
  }
  if (lines.length > MAX_LINES) {
    issues.push({ line: MAX_LINES + 1, raw: "", reason: `строк больше ${MAX_LINES}, остальные не читаем` });
  }

  const counts = {
    parsed: people.length,
    add: people.filter((p) => p.status === "new").length,
    exists: people.filter((p) => p.status === "exists").length,
    dupe: people.filter((p) => p.status === "dupe").length,
    issues: issues.length,
  };
  return { people, issues, counts };
};
