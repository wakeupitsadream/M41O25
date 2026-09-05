/**
 * Что считать существенной правкой записи ДЗ — от этого зависит, попадёт ли правка в ленту «Что нового».
 *
 * Существенно: другой предмет, другой дедлайн или другой текст (заголовок + задание). Правка опечатки — не событие:
 * после нормализации (регистр, пробелы, ё/е) расстояние Левенштейна между старым и новым текстом меньше
 * TYPO_EDIT_DISTANCE символов. Порог 4 выбран так, чтобы «сдедлайн» → «дедлайн», «к пятнице» → «к пятнице.»
 * и перестановка двух букв не шумели в ленте, а замена слова уже считалась правкой.
 * Исключение: любое изменение цифр (номера задач, страницы, даты) существенно всегда — «№ 214» → «№ 241» это другое задание.
 */
export const TYPO_EDIT_DISTANCE = 4;

export type HwEssentials = { title: string | null; body: string; dueDate: string; subjectId: string | null };

export type HwChangeKind = "subject" | "dueDate" | "text";

/** Регистр, ё/е и пробелы не считаются изменением текста. */
export const normalizeHwText = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

/**
 * Расстояние Левенштейна. Общий префикс и суффикс срезаются заранее: правка одного слова в длинном тексте
 * оставляет короткие «хвосты», и квадратичный проход почти не стоит. Если разница длин уже не меньше cap,
 * возвращаем её сразу — это нижняя граница расстояния, а вызывающему нужен только факт «не меньше cap».
 */
export function editDistance(a: string, b: string, cap = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) >= cap) return Math.abs(a.length - b.length);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const x = a.slice(start, endA);
  const y = b.slice(start, endB);
  if (!x.length) return y.length;
  if (!y.length) return x.length;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

const fullText = (h: HwEssentials) => normalizeHwText(`${h.title ?? ""}\n${h.body}`);
const digitsOf = (s: string) => s.replace(/\D+/g, "");

/** Список того, что существенно изменилось; пустой список — правка опечатки или ничего не менялось. */
export function hwChangeKinds(before: HwEssentials, after: HwEssentials): HwChangeKind[] {
  const kinds: HwChangeKind[] = [];
  if ((before.subjectId ?? null) !== (after.subjectId ?? null)) kinds.push("subject");
  if (before.dueDate !== after.dueDate) kinds.push("dueDate");
  const a = fullText(before);
  const b = fullText(after);
  if (a !== b && (digitsOf(a) !== digitsOf(b) || editDistance(a, b, TYPO_EDIT_DISTANCE) >= TYPO_EDIT_DISTANCE)) kinds.push("text");
  return kinds;
}

export const isSubstantialHwChange = (before: HwEssentials, after: HwEssentials) => hwChangeKinds(before, after).length > 0;

const KIND_LABEL: Record<HwChangeKind, string> = { subject: "предмет", dueDate: "дедлайн", text: "текст" };

/** «дедлайн», «дедлайн и текст», «предмет, дедлайн и текст» — для строки в ленте. */
export function describeHwChanges(kinds: HwChangeKind[]): string {
  const labels = kinds.map((k) => KIND_LABEL[k]);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} и ${labels[labels.length - 1]}`;
}
