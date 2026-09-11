import { firstName } from "@/lib/utils";
import type { PushTopic } from "@/lib/push/topics";

/** Что показать на экране телефона. url открывается по тапу (обработчик notificationclick в app/sw.ts). */
export type PushPayload = { title: string; body: string; url: string; tag: string };

/** События, о которых шлём пуш. Автор — уже готовое имя («Максим»); как его выбрать, решает вызывающий. */
export type PushEvent =
  | { kind: "news"; author: string; title?: string | null; body: string }
  | { kind: "homework"; id: string; author: string; subject: string | null; dueDate: string; title?: string | null; body: string }
  | { kind: "hw_due_moved"; id: string; author: string; subject: string | null; prevDueDate: string; dueDate: string }
  | { kind: "anon_question"; body: string }
  | { kind: "anon_answer"; author: string; body: string }
  | { kind: "poll"; author: string; question: string };

const MAX_BODY = 140;

/**
 * Знаки, которыми фраза заканчивается сама. Набор ОДИН на две функции: snippet срезает их с хвоста
 * перед своим многоточием, joinSentence по ним решает, нужна ли точка после заголовка. Пока наборы
 * расходились (у snippet не было «…» и «–»), обрезанный по слову «…список будет потом…» получал
 * второе многоточие: «потом……».
 */
const SENTENCE_END = ".,;:!?…—–-"; // дефис последним: внутри [] он иначе задал бы диапазон
/** Заголовок закончился знаком сам — своя точка не нужна. */
const ENDS_SENTENCE = new RegExp(`[${SENTENCE_END}]$`);
/** Хвост обрезанного текста: пробелы и та же пунктуация, к многоточию липнуть не должны. */
const TRAILING_PUNCTUATION = new RegExp(`[\\s${SENTENCE_END}]+$`);
/**
 * Заголовок считаем заголовком, только если в нём осталась буква (кириллица, латиница, любой алфавит)
 * или цифра. «.» и «?» — это не заголовок, а отсутствие заголовка, ровно как "" и "   "; зато «1)» и «§5»
 * осмысленны — в них есть цифра.
 */
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;
/**
 * Закрывающие кавычки пропускаем, когда ищем последний значащий символ: у «Пары отменили?» последний
 * символ — кавычка, а знак стоит внутри, и по-русски после «?»» и «!»» точка не ставится.
 * Закрывающую скобку НЕ пропускаем, и это не недосмотр: знак внутри скобок относится только к вставке,
 * само предложение ею не кончается — «(важно!)» точку как раз требует → «(важно!). Сбор в 9».
 * По той же причине «1)» получает точку: скобка ничего не закрыла в смысле пунктуации.
 */
const CLOSING_QUOTES = /[»”"]+$/;

/** Короткая выжимка текста: одна строка, без обрыва посреди слова, с многоточием если не влезло. */
export function snippet(text: string, max = MAX_BODY): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(TRAILING_PUNCTUATION, "")}…`;
}

/** Точка после начала фразы — только если знака там ещё нет; последний значащий символ ищем мимо кавычек. */
const withPeriod = (head: string): string => (ENDS_SENTENCE.test(head.replace(CLOSING_QUOTES, "")) ? head : `${head}.`);

/**
 * Склейка «заголовок записи + текст» в одну строку. Точку добавляем, только если заголовок сам не кончается
 * знаком: у записей сплошь и рядом «Зачёт?» или «Контрольная.», и жёсткое `. ` давало «Зачёт?. Повторить главы».
 * Знак ищем не по последнему символу, а по последнему значащему — закрывающие кавычки пропускаем (CLOSING_QUOTES).
 * Заголовка может не быть вовсе (пустая строка, пробелы, одни знаки препинания) — тогда остаётся только текст.
 */
export function joinSentence(head: string | null | undefined, tail: string): string {
  const h = head?.trim();
  if (!h || !HAS_WORD_CHAR.test(h)) return tail;
  return `${withPeriod(h)} ${tail}`;
}

/**
 * Склейка «имя автора + фраза». Отдельно от joinSentence, и намеренно: правило HAS_WORD_CHAR к имени неприменимо.
 * Для заголовка записи «.» или «…» — это отсутствие заголовка, а ник человек задаёт себе сам, и «🔥» или «!!!» —
 * настоящее имя. Через joinSentence автор молча исчезал бы из тела, а в уведомлении о переносе дедлайна он только
 * там и есть. Пунктуацию при этом не удваиваем: «Батут!» даёт «Батут! Было 15 сентября», а не «Батут!. Было …».
 * Пустое имя (или одни пробелы) — единственный случай, когда остаётся одна фраза, без ведущей точки.
 */
export function joinAuthor(name: string, tail: string): string {
  const n = name.trim();
  return n ? `${withPeriod(n)} ${tail}` : tail;
}

/** Имя в заголовке: ник, если человек его задал, иначе имя из «Фамилия Имя». */
export const pushAuthorName = (user: { fullName: string; nickname: string | null }): string => user.nickname?.trim() || firstName(user.fullName);

const HUSHING = "гкхжчшщ";

/**
 * Родительный падеж имени для «Новость от ___». Русские имена склоняются по нескольким простым правилам;
 * ник латиницей или что-то нераспознаваемое оставляем как есть — лучше «Новость от Nick», чем выдуманное окончание.
 */
export function genitiveName(name: string): string {
  const n = name.trim();
  const last = n.slice(-1).toLowerCase();
  if (!/[а-яё]/.test(last)) return n;
  const stem = n.slice(0, -1);
  if (last === "й" || last === "ь") return `${stem}я`; // Андрей → Андрея, Игорь → Игоря
  if (last === "я") return `${stem}и`; // Илья → Ильи, Мария → Марии
  if (last === "а") return `${stem}${HUSHING.includes(stem.slice(-1).toLowerCase()) ? "и" : "ы"}`; // Ольга → Ольги, Анна → Анны
  if ("оеёуыиэю".includes(last)) return n; // Данилу, Отто и прочее не трогаем
  return `${n}а`; // Максим → Максима
}

const TOPIC_BY_KIND: Record<PushEvent["kind"], PushTopic> = {
  news: "news",
  homework: "homework",
  hw_due_moved: "homework",
  anon_question: "questions",
  anon_answer: "questions",
  poll: "polls",
};

export const topicOf = (kind: PushEvent["kind"]): PushTopic => TOPIC_BY_KIND[kind];

const MONTHS_GENITIVE = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

/**
 * «2026-09-15» → «15 сентября», с withYear — «15 сентября 2026». Своя таблица месяцев, а не Date и Intl: дата
 * уже посчитана в поясе группы, и превращать её обратно в Date на сервере в UTC — верный способ получить соседний
 * день. Без «сегодня»/«завтра»: уведомление лежит на экране блокировки до утра, и к моменту прочтения «завтра»
 * означало бы уже другой день. Непонятную строку возвращаем как есть — лучше сырая дата, чем «0 undefined».
 * Год по умолчанию не печатаем — в дедлайне ближайших недель он только шум. Просит его тот, у кого на руках
 * ВТОРАЯ дата и год с чем сравнить: функция чистая, «какой сейчас год» ей знать неоткуда и гадать она не должна.
 */
export function dueDateLabel(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS_GENITIVE[Number(m) - 1];
  const day = Number(d);
  if (!month || !Number.isInteger(day) || day < 1 || day > 31) return iso;
  return withYear && /^\d{4}$/.test(y) ? `${day} ${month} ${y}` : `${day} ${month}`;
}

/** Год из «2026-09-15» — только чтобы сравнить две даты между собой. У строки без года (мусор) — null. */
const isoYear = (iso: string): string | null => (/^\d{4}-/.test(iso) ? iso.slice(0, 4) : null);

/** Заголовок — что случилось, тело — начало текста. Имя приложения iOS подставит сам, дублировать не нужно. */
export function buildNotification(event: PushEvent): PushPayload {
  switch (event.kind) {
    case "news":
      return {
        title: `Новость от ${genitiveName(event.author)}`,
        body: snippet(joinSentence(event.title, event.body)),
        url: "/group/news",
        tag: "news",
      };
    case "homework": {
      // Дедлайн — первым словом: заголовок на экране блокировки обрезается примерно на 40 символах, а решение
      // «делать сегодня или можно потом» принимают по дате. Предмет уезжает в хвост и теряется первым — переживём:
      // название вроде «Основы российской государственности» узнаётся и обрезанным. В теле его не дублируем,
      // там нужнее сам текст задания. Пустой предмет (short_name стёрли руками) — тот же случай, что и его отсутствие.
      // Имя автора — в тело и без глагола: «добавил/добавила» пришлось бы угадывать, а «Максим: …» верно для любого.
      // Года в дате тут нет, и это граница сознательная: дата ОДНА, сравнить её не с чем, а «текущий год» чистой
      // функции знать неоткуда — Date и таймзоны сюда не тянем. Год появляется только там, где дат две (перенос).
      const subject = event.subject?.trim();
      const due = `Задали к ${dueDateLabel(event.dueDate)}`;
      return {
        title: subject ? `${due}: ${subject}` : due,
        body: snippet(`${event.author}: ${joinSentence(event.title, event.body)}`),
        url: `/hw/${event.id}`,
        tag: "homework",
      };
    }
    case "hw_due_moved": {
      // Продолжение серии «Задали к 15 сентября: Матан»: тот же порядок (сначала дата, потом предмет) и тот же
      // безличный глагол — пола в профиле нет, а «перенёс/перенесла» пришлось бы угадывать.
      // Слово «Домашку» обязательно: в приложении есть и расписание, и домашка, а «Перенесли на 22 сентября:
      // Матан» без него читается как перенос ПАРЫ — ровно то, чего человек испугается зря.
      // «Домашку перенесли на » плюс самая длинная дата («30 сентября 2026», 16 символов) — это 37 символов,
      // поэтому новая дата целиком помещается в те примерно 40, что видно на экране блокировки; обрезаться
      // может только хвост названия предмета.
      const subject = event.subject?.trim();
      // Годы разные — печатаем год у ОБЕИХ дат. Без него 28 декабря 2026 → 3 января 2027 читалось как «Перенесли
      // на 3 января. Было 28 декабря», то есть переносом на девять месяцев назад вместо недели вперёд, а 15 сентября
      // 2026 → 15 сентября 2027 давало две одинаковые даты подряд. Сравнение чистое: обе даты на руках, «сегодня»
      // для него не нужно. Годы совпали — год не показываем, он в дедлайне ближайших недель только шум.
      const withYear = isoYear(event.prevDueDate) !== isoYear(event.dueDate);
      const moved = `Домашку перенесли на ${dueDateLabel(event.dueDate, withYear)}`;
      return {
        title: subject ? `${moved}: ${subject}` : moved,
        // Старый дедлайн — в теле: без него не видно, ближе стало или дальше. Даты совпали целиком — «Было» опускаем
        // и оставляем одно имя: сказать тут нечего, а «…перенесли на 15 сентября. Было 15 сентября» выглядит поломкой.
        // Такой пуш не должен уходить вовсе, но решает это отправляющая сторона, а текст ломаться не обязан.
        // Имя приклеиваем joinAuthor, а не joinSentence: ник «🔥» или «!!!» — настоящее имя, и терять его нельзя.
        body: snippet(
          event.dueDate === event.prevDueDate ? event.author : joinAuthor(event.author, `Было ${dueDateLabel(event.prevDueDate, withYear)}`),
        ),
        url: `/hw/${event.id}`,
        // Свой тег, не общий с «Задали». Затирания на экране блокировки он не предотвращает: lib/push/send.ts
        // дописывает к тегу время отправки, так что уникальным выходит любой, и одно уведомление не заменяет другое
        // ни при каком теге. Тег тут — вид события: по нему пуш узнаётся в логах и в DevTools, и если серию когда-то
        // понадобится схлопывать (убрать суффикс времени), «Перенесли» будет схлопываться отдельно от «Задали».
        tag: "homework-due",
      };
    }
    case "anon_question":
      return { title: "Анонимный вопрос", body: snippet(event.body), url: "/group/questions", tag: "questions" };
    case "anon_answer":
      // Без «ответил/ответила»: пола в профиле нет, а половине группы такой заголовок был бы неверен.
      return { title: `Ответ от ${genitiveName(event.author)}`, body: snippet(event.body), url: "/group/questions", tag: "questions" };
    case "poll":
      return { title: `Опрос от ${genitiveName(event.author)}`, body: snippet(event.question), url: "/group/polls", tag: "polls" };
  }
}
