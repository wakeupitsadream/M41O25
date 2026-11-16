/**
 * Вёрстка PNG-карточки дня (app/api/share/day/route.tsx). Холст 1080×1350 фиксированный, а satori не умеет «ужать,
 * если не влезло»: всё, что ниже края, обрезается молча. С осени 2026 в дне до шести пар, а названия длинные
 * («Элективные дисциплины по физической культуре и спорту» — четыре строки крупным шрифтом), поэтому плотность
 * выбираем заранее по оценке высоты списка. Чистая функция — проверяется тестом, а не глазами на каждом расписании.
 */
export type ShareDensity = {
  /** Кегль названия пары, подписи под ним, времени начала и времени конца. */
  title: number;
  sub: number;
  time: number;
  end: number;
  /** Ширина колонки времени и высота цветной полоски предмета. */
  timeCol: number;
  bar: number;
  /** Вертикальный отступ внутри карточки пары и расстояние между карточками. */
  padY: number;
  gap: number;
  /** Сколько строк названия и подписи показываем; null — сколько есть. */
  titleLines: number | null;
  subLines: number | null;
};

/** Больше пар на карточку не кладём: в сетке филиала их шесть, запас — на случай подгрупп в одном слоте. */
export const SHARE_MAX_LESSONS = 7;

/** От просторной (как было всегда) к самой плотной; в двух последних длинные тексты обрезаются многоточием. */
export const SHARE_DENSITIES: ShareDensity[] = [
  { title: 40, sub: 26, time: 40, end: 26, timeCol: 150, bar: 88, padY: 26, gap: 20, titleLines: null, subLines: null },
  { title: 34, sub: 23, time: 36, end: 24, timeCol: 136, bar: 76, padY: 20, gap: 16, titleLines: null, subLines: null },
  { title: 30, sub: 21, time: 32, end: 22, timeCol: 122, bar: 66, padY: 16, gap: 12, titleLines: 2, subLines: 1 },
  { title: 28, sub: 20, time: 30, end: 20, timeCol: 114, bar: 60, padY: 12, gap: 10, titleLines: 2, subLines: 1 },
];

/** Высота под список пар: холст минус поля, шапка, отступ под ней и подвал с небольшим зазором. */
export const SHARE_LIST_HEIGHT = 948;
/** Ширина контента холста (1080 минус поля по 72) и горизонтальные расходы внутри карточки пары. */
const CONTENT_WIDTH = 936;
export const SHARE_CARD_PAD_X = 32;
export const SHARE_CARD_GAP_X = 28;
export const SHARE_BAR_WIDTH = 8;
/**
 * Ширина символа Unbounded Bold в долях кегля. По готовым карточкам в среднем 0,78 у названия и 0,65 у подписи,
 * но строка из широких букв («Элективные дисциплины») выходит шире средней — берём с запасом: лишняя строка
 * в оценке даст чуть более плотную вёрстку, а недостающая — обрезанный низ карточки.
 */
const TITLE_EM = 0.84;
const SUB_EM = 0.7;
const TITLE_LINE = 1.15;
const SUB_LINE = 1.24;

/** Сколько строк займёт текст при жадном переносе по словам (и после дефиса) и ширине в maxChars символов. */
export function wrappedLines(text: string, maxChars: number): number {
  const width = Math.max(1, Math.floor(maxChars));
  let lines = 0;
  let used = 0;
  // «Социально-экономическая» переносится после дефиса — считаем его местом разрыва.
  for (const word of text.replace(/-(?=\S)/g, "- ").trim().split(/\s+/).filter(Boolean)) {
    if (used > 0 && used + 1 + word.length <= width) {
      used += 1 + word.length;
      continue;
    }
    // Слово длиннее строки переносится посимвольно: занимает несколько строк, остаток — начало следующей.
    lines += Math.ceil(word.length / width);
    used = word.length % width || width;
  }
  return Math.max(1, lines);
}

/** Ширина колонки с названием пары при данной плотности. */
export const shareTextWidth = (d: ShareDensity) => CONTENT_WIDTH - 2 * SHARE_CARD_PAD_X - d.timeCol - SHARE_BAR_WIDTH - 2 * SHARE_CARD_GAP_X;

/** Оценка высоты списка пар при данной плотности. */
export function shareListHeight(lessons: { title: string; sub: string }[], d: ShareDensity): number {
  const width = shareTextWidth(d);
  const cards = lessons.map((l) => {
    const titleLines = Math.min(wrappedLines(l.title, width / (d.title * TITLE_EM)), d.titleLines ?? Infinity);
    const subLines = l.sub ? Math.min(wrappedLines(l.sub, width / (d.sub * SUB_EM)), d.subLines ?? Infinity) : 0;
    const text = titleLines * d.title * TITLE_LINE + (subLines ? 8 + subLines * d.sub * SUB_LINE : 0);
    return 2 * d.padY + 2 + Math.max(d.bar, text);
  });
  return cards.reduce((a, b) => a + b, 0) + d.gap * Math.max(0, lessons.length - 1);
}

/** Самая просторная плотность, при которой список помещается; если не помещается ни одна — самая плотная. */
export function shareDensity(lessons: { title: string; sub: string }[]): ShareDensity {
  return SHARE_DENSITIES.find((d) => shareListHeight(lessons, d) <= SHARE_LIST_HEIGHT) ?? SHARE_DENSITIES[SHARE_DENSITIES.length - 1];
}

/** «ауд. 215», но «Спорт. зал» без «ауд.»: приставка нужна только номеру аудитории. */
export const roomLabel = (room: string | null | undefined): string | null => {
  const r = room?.trim();
  if (!r) return null;
  return /^\d/.test(r) ? `ауд. ${r}` : r;
};
