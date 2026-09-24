/*
 * Числа XLSX так, как их видит студент в Excel (docs/AI-CHAT.md §5). В ячейке лежит голое число: дата 24.09.2026 —
 * это 46289, время пары 9:00 — 0.375, 85 % — 0.85. Что это дата или процент, говорит только стиль ячейки
 * (s → xl/styles.xml cellXfs → numFmtId → код формата). Без этого модель назвала бы студенту неверные даты.
 * Чистые функции без распаковки — тесты на значениях.
 */

export type NumFormat =
  | { kind: "general" }
  | { kind: "percent"; decimals: number }
  | { kind: "datetime"; date: boolean; time: boolean; seconds: boolean; elapsed: boolean };

const GENERAL: NumFormat = { kind: "general" };

/**
 * Встроенные форматы (ECMA-376, 18.8.30): 9–10 — проценты, 14–22 и 45–47 — даты и время. 27–36 и 50–58 —
 * локальные даты восточноазиатских локалей; в русском Excel не встречаются, но если придут — это тоже даты.
 */
const BUILTIN: Record<number, string> = {
  9: "0%",
  10: "0.00%",
  14: "dd.mm.yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "dd.mm.yyyy h:mm",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mm:ss.0",
};
for (const id of [27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 50, 51, 52, 53, 54, 55, 56, 57, 58]) BUILTIN[id] = "yyyy-mm-dd";

/**
 * Код формата → что показывать. Смотрим только первую секцию (положительные числа). Выбрасываем то, что не про
 * число: строки в кавычках, экранированные символы, заполнители _x и *x, цвета и локали в [скобках] (кроме
 * [h] [m] [s] — это «прошедшее время»), AM/PM. Остались d/y — дата; h/s — время; m — минуты, если стоит рядом
 * с h или перед s, иначе месяц.
 */
export function classifyFormat(code: string | null | undefined): NumFormat {
  if (!code) return GENERAL;
  const first = code.split(";")[0];
  const elapsed = /\[(h+|m+|s+)\]/i.test(first);
  const bare = first
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/[_*]./g, "")
    .replace(/\[[^\]]*\]/g, (m) => (/^\[(h+|m+|s+)\]$/i.test(m) ? m.slice(1, -1) : ""))
    .replace(/am\/pm|a\/p/gi, "")
    .toLowerCase();
  if (bare === "general" || bare === "@") return GENERAL;
  const letters = bare.replace(/[^dmyhs]/g, "");
  if (letters) {
    let date = /[dy]/.test(letters);
    let time = /[hs]/.test(letters);
    // m: минуты, если рядом h (перед) или s (после), иначе месяц.
    for (let i = 0; i < letters.length; i++) {
      if (letters[i] !== "m") continue;
      let j = i;
      while (j < letters.length && letters[j] === "m") j++;
      const minutes = (i > 0 && letters[i - 1] === "h") || letters[j] === "s";
      if (minutes) time = true;
      else date = true;
      i = j - 1;
    }
    return { kind: "datetime", date, time, seconds: letters.includes("s"), elapsed };
  }
  if (bare.includes("%")) {
    const frac = /\.([0#?]+)/.exec(bare);
    return { kind: "percent", decimals: frac ? frac[1].length : 0 };
  }
  return GENERAL;
}

/** Формат по numFmtId: сначала пользовательские из numFmts (они могут переопределить встроенные), потом встроенные. */
export function formatById(id: number, custom: ReadonlyMap<number, string>): NumFormat {
  return classifyFormat(custom.get(id) ?? BUILTIN[id]);
}

/** Плавающий шум (0.30000000000000004) — до 10 значащих цифр; целые не трогаем: номер зачётки не должен округлиться. */
export function plainNumber(raw: string): string {
  const n = Number(raw);
  if (!raw.trim() || !Number.isFinite(n)) return raw;
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(10)));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Самая поздняя дата Excel — 31.12.9999; дальше Excel сам показывает «####», и мы отдаём число как есть. */
const MAX_SERIAL = 2958465;

/**
 * Серийный номер дня → ДД.ММ.ГГГГ. Система 1900: день 1 — 01.01.1900, и Excel считает 1900 високосным (ошибка
 * Lotus 1-2-3, сохранённая ради совместимости), так что день 60 — несуществующее 29.02.1900, а с 61-го база —
 * 30.12.1899. Система 1904 (workbook.xml date1904, старые книги с Mac): день 0 — 01.01.1904, без этой ошибки.
 */
export function serialDate(day: number, date1904: boolean): string {
  if (date1904) return isoToRu(new Date(Date.UTC(1904, 0, 1 + day)));
  if (day === 0) return "00.01.1900";
  if (day === 60) return "29.02.1900";
  return isoToRu(new Date(Date.UTC(1899, 11, day < 60 ? 31 + day : 30 + day)));
}

const isoToRu = (d: Date) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;

/** Значение ячейки с числом по её формату: дата, время, процент или число без плавающего шума. */
export function formatNumber(raw: string, fmt: NumFormat, date1904: boolean): string {
  const n = Number(raw);
  if (fmt.kind === "general" || !raw.trim() || !Number.isFinite(n)) return plainNumber(raw);
  if (fmt.kind === "percent") return `${(n * 100).toFixed(fmt.decimals)} %`;
  if (n < 0 || n > MAX_SERIAL + 1) return plainNumber(raw);

  let day = Math.floor(n);
  let secs = Math.round((n - day) * 86400);
  // 23:59:59,6 со временем — это 0:00 следующих суток; без времени в формате день не переносим.
  if (secs >= 86400 && (fmt.time || fmt.elapsed)) {
    day += 1;
    secs -= 86400;
  }
  const hh = Math.floor(secs / 3600);
  const mm = Math.floor((secs % 3600) / 60);
  const ss = secs % 60;
  const tail = fmt.seconds ? `:${pad(ss)}` : "";
  // [h]:mm — прошедшее время: часы не сворачиваются в сутки (46:30 — это 46 часов, а не 22:30).
  if (fmt.elapsed) return `${day * 24 + hh}:${pad(mm)}${tail}`;
  const time = `${hh}:${pad(mm)}${tail}`;
  if (!fmt.date) return time;
  const date = serialDate(day, date1904);
  return fmt.time ? `${date} ${time}` : date;
}

/** ISO-дата из ячейки t="d" (редкие генераторы пишут даты строкой) → ДД.ММ.ГГГГ[ ЧЧ:ММ]. */
export function isoCellDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(raw.trim());
  if (!m) return raw;
  const date = `${m[3]}.${m[2]}.${m[1]}`;
  if (!m[4] || (m[4] === "00" && m[5] === "00" && (m[6] ?? "00") === "00")) return date;
  return `${date} ${Number(m[4])}:${m[5]}${m[6] && m[6] !== "00" ? `:${m[6]}` : ""}`;
}
