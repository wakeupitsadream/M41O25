/*
 * Чистые помощники «ужать для модели»: обрезка текста и JSON-результатов инструментов, короткие даты.
 * Без server-only — гоняются под node:test и нужны и инструментам, и контексту, и извлечению документов.
 */

/** Потолок ответа одного инструмента (docs/AI-CHAT.md §6): ~1100 токенов, чтобы два круга инструментов не съели бюджет. */
export const TOOL_RESULT_LIMIT = 4000;

/**
 * Обрезка текста до max символов с «…». Режем по пробелу или переводу строки, если он недалеко от границы:
 * слово пополам модель читает хуже, чем на пару символов более короткий текст.
 */
export function clipText(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return "…".slice(0, Math.max(0, max));
  const head = text.slice(0, max - 1);
  const cut = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  return `${cut > max * 0.85 ? head.slice(0, cut) : head}…`;
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const clipStrings = (v: Json, max: number): Json => {
  if (typeof v === "string") return clipText(v, max);
  if (Array.isArray(v)) return v.map((x) => clipStrings(x, max));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clipStrings(x, max)]));
  return v;
};

const longestString = (v: Json): number => {
  if (typeof v === "string") return v.length;
  if (Array.isArray(v)) return v.reduce<number>((m, x) => Math.max(m, longestString(x)), 0);
  if (v && typeof v === "object") return Object.values(v).reduce<number>((m, x) => Math.max(m, longestString(x)), 0);
  return 0;
};

/** undefined в JSON не попадает, а в сравнениях длины мешает: приводим к чистому JSON-значению один раз. */
const toJson = (v: unknown): Json => JSON.parse(JSON.stringify(v ?? null)) as Json;

/**
 * Результат инструмента → JSON не длиннее limit. Невалидный JSON (обрезанный посередине) модель прочитала бы
 * наугад, поэтому режем по элементам списка listKey: оставляем столько первых, сколько влезает, и добавляем
 * поле truncated с пометкой «показаны N из M» — модель скажет, что сузить. Если не влезает даже первый элемент
 * (огромное задание) — укорачиваем в нём строки.
 */
export function fitJson(value: Record<string, unknown>, listKey: string, limit = TOOL_RESULT_LIMIT): string {
  const base = toJson(value) as { [k: string]: Json };
  const full = JSON.stringify(base);
  if (full.length <= limit) return full;

  const list = Array.isArray(base[listKey]) ? (base[listKey] as Json[]) : null;
  const note = (shown: number, total: number) => `показаны первые ${shown} из ${total} — сузи запрос (период, предмет, limit)`;
  const withItems = (items: Json[], shown: number, total: number) => JSON.stringify({ ...base, [listKey]: items, truncated: note(shown, total) });

  if (list && list.length > 0) {
    // Бинарный поиск наибольшего k: длина растёт монотонно с числом элементов.
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (withItems(list.slice(0, mid), mid, list.length).length <= limit) lo = mid;
      else hi = mid - 1;
    }
    if (lo > 0) return withItems(list.slice(0, lo), lo, list.length);

    // Ни один элемент целиком не влез: первый элемент с укороченными строками.
    const first = list[0];
    let lo2 = 20;
    let hi2 = longestString(first);
    let best: string | null = null;
    while (lo2 <= hi2) {
      const mid = Math.floor((lo2 + hi2) / 2);
      const s = withItems([clipStrings(first, mid)], 1, list.length);
      if (s.length <= limit) {
        best = s;
        lo2 = mid + 1;
      } else hi2 = mid - 1;
    }
    if (best) return best;
  }

  // Без списка (или не помогло) — укорачиваем строки всего объекта.
  let lo3 = 20;
  let hi3 = longestString(base);
  let best3: string | null = null;
  while (lo3 <= hi3) {
    const mid = Math.floor((lo3 + hi3) / 2);
    const s = JSON.stringify({ ...(clipStrings(base, mid) as object), truncated: "текст укорочен" });
    if (s.length <= limit) {
      best3 = s;
      lo3 = mid + 1;
    } else hi3 = mid - 1;
  }
  return best3 ?? JSON.stringify({ error: "Данных слишком много — сузи запрос" });
}

/**
 * Деление бюджета символов между документами «поровну с переливом»: каждому не больше его длины, недобранное
 * малыми уходит большим. Порядок результата — как у lengths.
 */
export function shareBudget(lengths: readonly number[], limit: number): number[] {
  const alloc = lengths.map(() => 0);
  let left = Math.max(0, limit);
  const order = lengths.map((len, i) => ({ len: Math.max(0, len), i })).sort((a, b) => a.len - b.len);
  order.forEach(({ len, i }, k) => {
    alloc[i] = Math.min(len, Math.floor(left / (order.length - k)));
    left -= alloc[i];
  });
  return alloc;
}

// ---------- Даты для модели ----------

const WEEKDAYS_SHORT = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"] as const;
const WEEKDAYS_LONG = ["воскресенье", "понедельник", "вторник", "среда", "четверг", "пятница", "суббота"] as const;

/**
 * День недели календарной даты YYYY-MM-DD. Через Date.UTC: дата уже в поясе группы (todayIso), пересчитывать
 * её в пояс сервера нельзя — в полночь по Оренбургу это ещё вчера по UTC.
 */
export function weekdayRu(iso: string, long = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  const i = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (long ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[i] ?? "";
}

/** «24.09» — коротко для контекста; год модели не нужен, он есть в строке «сегодня». */
export const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
