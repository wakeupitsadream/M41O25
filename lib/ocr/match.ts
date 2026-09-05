/**
 * Сопоставление названия предмета из скана со справочником группы.
 * Чистые функции без базы — покрыты lib/ocr/match.test.ts.
 */

export type SubjectRef = { id: string; name: string; shortName: string | null; aliases?: string[] };

export type MatchKind = "exact" | "alias" | "fuzzy";
export type SubjectMatch = { id: string; kind: MatchKind } | null;

/** Нижний регистр, ё→е, всё кроме букв и цифр — в одиночные пробелы. */
export const normalizeTitle = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

/** Биграммы по словам (без склейки через пробел): «англ яз» → [ан, нг, гл, яз]. Однобуквенное слово — само по себе. */
export function bigrams(s: string): string[] {
  const out: string[] = [];
  for (const w of normalizeTitle(s).split(" ")) {
    if (!w) continue;
    if (w.length === 1) out.push(w);
    for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2));
  }
  return out;
}

/** Коэффициент Дайса по мультимножествам биграмм: 0..1, устойчив к опечаткам («Матиматический» ↔ «Математический»). */
export function diceSimilarity(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (!ba.length || !bb.length) return 0;
  const pool = new Map<string, number>();
  for (const g of bb) pool.set(g, (pool.get(g) ?? 0) + 1);
  let common = 0;
  for (const g of ba) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      common++;
      pool.set(g, n - 1);
    }
  }
  return (2 * common) / (ba.length + bb.length);
}

/**
 * Сокращение по началам слов: «Англ. яз.» ↔ «Английский язык», «Матан» ↔ «Математический анализ»
 * (одно слово запроса может быть склейкой начал соседних слов: «мат»+«ан»).
 * Куски не короче 2 букв (первый кусок одиночного слова — не короче 3), всего букв в запросе не меньше 4 и хотя бы одно
 * слово запроса от 3 букв: «ИЯ» так не пройдёт.
 */
export function abbreviationMatches(query: string, candidate: string): boolean {
  const q = normalizeTitle(query).split(" ").filter(Boolean);
  const c = normalizeTitle(candidate).split(" ").filter(Boolean);
  if (!q.length || !c.length) return false;
  if (q.join("").length < 4) return false;
  if (!q.some((w) => w.length >= 3)) return false;
  // q[qi] — начало c[j] либо склейка начал c[j..k]; слова запроса идут в порядке слов кандидата, лишние слова кандидата пропускаются.
  const firstMin = q.length > 1 ? 2 : 3;
  const fits = (qi: number, ci: number): boolean => {
    if (qi === q.length) return true;
    for (let j = ci; j < c.length; j++) {
      for (let k = j; k < c.length; k++) if (splitAsPrefixes(q[qi], c, j, k, firstMin) && fits(qi + 1, k + 1)) return true;
    }
    return false;
  };
  return fits(0, 0);
}

/** word раскладывается ровно на начала слов c[j..k]: каждый кусок ≥ 2 букв, первый ≥ firstMin. */
function splitAsPrefixes(word: string, c: string[], j: number, k: number, firstMin: number, depth = 0): boolean {
  const minLen = depth === 0 ? firstMin : 2;
  if (j === k) return word.length >= minLen && c[j].startsWith(word);
  for (let len = minLen; len <= Math.min(word.length, c[j].length); len++) {
    if (!c[j].startsWith(word.slice(0, len))) break;
    if (splitAsPrefixes(word.slice(len), c, j + 1, k, firstMin, depth + 1)) return true;
  }
  return false;
}

/** Балл похожести запроса на одно написание: 1 при сокращении по началам слов, иначе Дайс. */
export function fuzzyScore(query: string, candidate: string): number {
  if (abbreviationMatches(query, candidate)) return 1;
  return diceSimilarity(query, candidate);
}

const FUZZY_THRESHOLD = 0.6;
const FUZZY_MARGIN = 0.1;

const spellings = (s: SubjectRef) => [s.name, s.shortName ?? "", ...(s.aliases ?? [])].filter(Boolean);

/**
 * Точное совпадение с названием/коротким именем/алиасом → короткое имя как отдельное слово → вхождение → начало →
 * нечёткое сравнение. Нечёткий кандидат принимается только с отрывом от второго: «Микроэконом.» при двух экономиках — null.
 */
export function matchSubjectDetailed(title: string, subjects: SubjectRef[]): SubjectMatch {
  const t = normalizeTitle(title);
  if (!t) return null;
  const exact = subjects.find((s) => normalizeTitle(s.name) === t || (s.shortName && normalizeTitle(s.shortName) === t));
  if (exact) return { id: exact.id, kind: "exact" };
  const byAlias = subjects.find((s) => (s.aliases ?? []).some((a) => normalizeTitle(a) === t));
  if (byAlias) return { id: byAlias.id, kind: "alias" };
  // Короткое имя — только как целое слово и от 3 символов: «ИЯ» не должно цеплять «История».
  const tokens = new Set(t.split(" "));
  const byShort = subjects.filter((s) => s.shortName && normalizeTitle(s.shortName).length >= 3 && tokens.has(normalizeTitle(s.shortName)));
  if (byShort.length === 1) return { id: byShort[0].id, kind: "exact" };
  const contains = subjects.filter((s) => t.length >= 5 && (normalizeTitle(s.name).includes(t) || t.includes(normalizeTitle(s.name))));
  if (contains.length === 1) return { id: contains[0].id, kind: "exact" };
  const head = t.slice(0, 6);
  const prefix = subjects.filter((s) => head.length >= 5 && normalizeTitle(s.name).startsWith(head));
  if (prefix.length === 1) return { id: prefix[0].id, kind: "exact" };

  const scored = subjects
    .map((s) => ({ id: s.id, score: Math.max(0, ...spellings(s).map((sp) => fuzzyScore(t, sp))) }))
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (!best || best.score < FUZZY_THRESHOLD) return null;
  if (second && best.score - second.score < FUZZY_MARGIN) return null;
  return { id: best.id, kind: "fuzzy" };
}

export function matchSubject(title: string, subjects: SubjectRef[]): string | null {
  return matchSubjectDetailed(title, subjects)?.id ?? null;
}

/** Есть ли написание title среди name/shortName/aliases предмета (после нормализации). */
export const hasSpelling = (s: SubjectRef, title: string) => {
  const t = normalizeTitle(title);
  return Boolean(t) && spellings(s).some((sp) => normalizeTitle(sp) === t);
};

export const MAX_ALIASES = 20;
export const MAX_ALIAS_LENGTH = 120;

/**
 * Автообучение: строки черновика, привязанные к предмету под другим написанием, дают новые алиасы.
 * Возвращает только предметы, у которых что-то добавилось; дубли по нормализованному виду отброшены, потолок MAX_ALIASES.
 */
export function aliasesToLearn(items: { subjectId: string | null; title: string }[], subjects: SubjectRef[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of subjects) {
    const known = new Set(spellings(s).map(normalizeTitle));
    const fresh: string[] = [];
    for (const it of items) {
      if (it.subjectId !== s.id) continue;
      const title = it.title.trim().slice(0, MAX_ALIAS_LENGTH);
      const t = normalizeTitle(title);
      if (!t || known.has(t)) continue;
      known.add(t);
      fresh.push(title);
    }
    const room = MAX_ALIASES - (s.aliases?.length ?? 0);
    if (fresh.length && room > 0) out.set(s.id, fresh.slice(0, room));
  }
  return out;
}
