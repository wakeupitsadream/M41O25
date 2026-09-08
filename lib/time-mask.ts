/**
 * Маска времени ЧЧ:ММ для поля ввода без нативного `input[type="time"]`.
 * Нативное поле на iPhone с английской локалью системы показывает «8:30 AM» —
 * расписание вуза 24-часовое, и AM/PM только мешает. Здесь всегда 24 часа.
 */

/** Цифры из произвольного ввода, не больше четырёх. */
function digitsOf(raw: string): string {
  return raw.replace(/\D+/g, "").slice(0, 4);
}

/** Что показываем в поле, пока человек печатает: 830 → 8:30, 0830 → 08:30. */
export function maskTime(raw: string): string {
  const d = digitsOf(raw);
  if (d.length <= 2) return d;
  return `${d.slice(0, d.length - 2)}:${d.slice(d.length - 2)}`;
}

/**
 * Готовое значение для сервера: строго «ЧЧ:ММ» или пустая строка.
 * 8 → 08:00, 13 → 13:00, 830 → 08:30, 0830 → 08:30. Часы > 23 и минуты > 59 не проходят.
 */
export function toHm(raw: string): string {
  const d = digitsOf(raw);
  if (d.length === 0) return "";
  const h = d.length <= 2 ? Number(d) : Number(d.slice(0, d.length - 2));
  const m = d.length <= 2 ? 0 : Number(d.slice(d.length - 2));
  if (h > 23 || m > 59) return "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
