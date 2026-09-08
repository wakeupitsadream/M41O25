/**
 * Черновик и офлайн-очередь домашки. Главный сценарий: студент пишет задание прямо на паре, а сети в аудитории нет.
 * Ничего из набранного не должно теряться, поэтому:
 *  - пока запись не отправлена, она лежит в localStorage черновиком (raspison.hw.draft.v1);
 *  - если отправка упала из-за сети, запись уходит в очередь (raspison.hw.queue.v1) и отправляется сама, когда связь появится.
 *
 * Здесь только чистая логика (разбор ошибки, сериализация, дедупликация) плюс тонкие обёртки над localStorage,
 * безопасные вне браузера. UI — components/hw/quick-add-form.tsx и components/hw/hw-outbox.tsx.
 */
import { pluralRu } from "@/lib/utils";

/** Ключи в пространстве raspison.* (см. components/features/clear-local.tsx). Версия в имени: чужой формат просто игнорируется. */
export const DRAFT_KEY = "raspison.hw.draft.v1";
export const QUEUE_KEY = "raspison.hw.queue.v1";

/** Черновик старше суток — это вчерашняя пара, восстанавливать его уже незачем. */
export const DRAFT_TTL_MS = 24 * 60 * 60_000;
/** Запись, не ушедшая за неделю, протухла вместе с дедлайном. */
export const QUEUE_TTL_MS = 7 * 24 * 60 * 60_000;
/** Окно, в котором сервер считает повторную отправку тем же самым ДЗ, а не второй записью. */
export const DEDUP_WINDOW_MS = 10 * 60_000;
/** Больше в очереди не копим: столько неотправленных записей — уже не «нет сети», а что-то сломалось. */
export const QUEUE_MAX = 20;

/** Очередь поменялась — окно узнаёт об этом событием, чтобы плашка обновилась без перезагрузки. */
export const QUEUE_EVENT = "raspison:hw-queue";

export type HwDraft = {
  /** Черновик принадлежит человеку: на общем телефоне чужой текст показывать нельзя. */
  userId: string;
  body: string;
  title: string;
  subjectId: string | null;
  /** Своя дата; null — дедлайн считается по расписанию (следующая пара предмета). */
  dueOverride: string | null;
  savedAt: number;
};

export type QueuedHw = {
  /** Ключ идемпотентности: повторная отправка того же ключа не должна создать вторую запись. */
  key: string;
  userId: string;
  body: string;
  title: string;
  subjectId: string | null;
  dueDate: string;
  lessonId: string | null;
  attachmentIds: string[];
  queuedAt: number;
  tries: number;
  /** Сервер ответил отказом (не сеть) — сам такую запись больше не шлём, только по кнопке. */
  lastError: string | null;
};

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isoOrNull = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/* ─── Черновик ─────────────────────────────────────────────────────────────── */

export const isEmptyDraft = (d: Pick<HwDraft, "body" | "title">) => !d.body.trim() && !d.title.trim();

/**
 * Разбор сохранённого черновика: чужой (другой userId), протухший или битый — как будто его нет.
 * Стирает такой черновик уже вызывающий (readDraft): здесь только чистая логика.
 */
export function parseDraft(raw: string | null, userId: string, now: number): HwDraft | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const savedAt = typeof o.savedAt === "number" ? o.savedAt : 0;
  if (str(o.userId) !== userId) return null;
  if (!savedAt || now - savedAt > DRAFT_TTL_MS) return null;
  const draft: HwDraft = {
    userId,
    body: str(o.body),
    title: str(o.title),
    subjectId: typeof o.subjectId === "string" ? o.subjectId : null,
    dueOverride: isoOrNull(o.dueOverride),
    savedAt,
  };
  return isEmptyDraft(draft) ? null : draft;
}

/* ─── Очередь ──────────────────────────────────────────────────────────────── */

const parseEntry = (v: unknown): QueuedHw | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const key = str(o.key);
  const userId = str(o.userId);
  const body = str(o.body);
  const dueDate = isoOrNull(o.dueDate);
  if (!key || !userId || !body.trim() || !dueDate) return null;
  return {
    key,
    userId,
    body,
    title: str(o.title),
    subjectId: typeof o.subjectId === "string" ? o.subjectId : null,
    dueDate,
    lessonId: typeof o.lessonId === "string" ? o.lessonId : null,
    attachmentIds: Array.isArray(o.attachmentIds) ? o.attachmentIds.filter((x): x is string => typeof x === "string") : [],
    queuedAt: typeof o.queuedAt === "number" ? o.queuedAt : 0,
    tries: typeof o.tries === "number" ? o.tries : 0,
    lastError: typeof o.lastError === "string" ? o.lastError : null,
  };
};

/** Битые элементы выкидываем поштучно: одна испорченная запись не должна ронять всю очередь. */
export function parseQueue(raw: string | null): QueuedHw[] {
  if (!raw) return [];
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(v)) return [];
  return v.map(parseEntry).filter((e): e is QueuedHw => e !== null);
}

export const serializeQueue = (list: QueuedHw[]) => JSON.stringify(list);

/** Протухшее прочь. Чужие записи не трогаем: человек мог просто перезайти, и они дождутся его. */
export const pruneQueue = (list: QueuedHw[], now: number) => list.filter((e) => now - e.queuedAt <= QUEUE_TTL_MS);

/** Добавление идемпотентно по ключу: тот же ключ заменяет запись, а не удваивает её. */
export function addToQueue(list: QueuedHw[], entry: QueuedHw): QueuedHw[] {
  const next = [...list.filter((e) => e.key !== entry.key), entry];
  return next.length > QUEUE_MAX ? next.slice(next.length - QUEUE_MAX) : next;
}

export const removeFromQueue = (list: QueuedHw[], key: string) => list.filter((e) => e.key !== key);

export const markQueueFailed = (list: QueuedHw[], key: string, error: string) =>
  list.map((e) => (e.key === key ? { ...e, tries: e.tries + 1, lastError: error } : e));

export const markQueueRetry = (list: QueuedHw[], key: string) => list.map((e) => (e.key === key ? { ...e, tries: e.tries + 1, lastError: null } : e));

export const myQueue = (list: QueuedHw[], userId: string) => list.filter((e) => e.userId === userId);

/**
 * Что отправлять. Сама собой уходит только та запись, что ещё не получала отказ от сервера:
 * «слишком много записей за час» бесконечно повторять бессмысленно — такие шлём только по кнопке.
 */
export const queueToSend = (list: QueuedHw[], userId: string, manual: boolean) => myQueue(list, userId).filter((e) => manual || e.lastError === null);

/** «1 запись ждёт отправки», «2 записи ждут отправки». */
export const queueLabel = (n: number) => `${n} ${pluralRu(n, "запись", "записи", "записей")} ${n === 1 ? "ждёт" : "ждут"} отправки`;

/* ─── Ошибка сети ──────────────────────────────────────────────────────────── */

/**
 * Server action без сети падает не нашей ошибкой, а исключением fetch: в Safari это TypeError «Load failed»,
 * в Chrome — «Failed to fetch», а если запрос оборвался на середине потока, Next говорит про «unexpected response».
 * Всё это значит одно: до сервера не дошло или ответ потерялся — данные можно смело откладывать.
 */
const OFFLINE_PATTERNS = [
  /failed to fetch/i,
  /fetch failed/i,
  /load failed/i,
  /networkerror/i,
  /network request failed/i,
  /network ?error/i,
  /unexpected response was received from the server/i,
  /internet connection appears to be offline/i,
  /connection (?:was )?(?:lost|closed|reset|refused)/i,
  /net::err/i,
  /timed? ?out/i,
  /aborted/i,
];

/** `online` — обычно navigator.onLine; он врёт на wifi без интернета («сеть есть»), поэтому смотрим ещё и на текст ошибки. */
export function isOfflineError(err: unknown, online = true): boolean {
  if (!online) return true;
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : typeof err === "string" ? err : "";
  if (!msg) return false;
  return OFFLINE_PATTERNS.some((re) => re.test(msg));
}

/* ─── Дедупликация на сервере ──────────────────────────────────────────────── */

export type HwIdentity = { body: string; dueDate: string; subjectId: string | null };

/** Две отправки — одно и то же ДЗ, если совпали текст, дедлайн и предмет (автора сверяет вызывающий). */
export const sameHwEntry = (a: HwIdentity, b: HwIdentity) =>
  a.dueDate === b.dueDate && (a.subjectId ?? null) === (b.subjectId ?? null) && a.body.trim() === b.body.trim();

/**
 * Ключ идемпотентности живёт только на телефоне (колонки под него нет, миграции запрещены), поэтому сервер
 * узнаёт повтор по содержимому: та же запись того же автора за последние DEDUP_WINDOW_MS. Это ловит и
 * самый неприятный случай — когда запрос дошёл, а ответ по дороге потерялся, и телефон честно шлёт его снова.
 */
export function findRecentDuplicate<T extends HwIdentity & { id: string; createdAt: Date }>(rows: T[], input: HwIdentity, now: number): T | null {
  return rows.find((r) => now - r.createdAt.getTime() <= DEDUP_WINDOW_MS && sameHwEntry(r, input)) ?? null;
}

/* ─── localStorage ─────────────────────────────────────────────────────────── */

/** Приватный режим Safari и переполнение квоты не должны ронять форму — все обращения через try/catch. */
const store = (): Storage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

const read = (key: string) => {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

const write = (key: string, value: string) => {
  try {
    store()?.setItem(key, value);
  } catch {
    /* нет места или приватный режим — черновик просто не сохранится */
  }
};

const drop = (key: string) => {
  try {
    store()?.removeItem(key);
  } catch {}
};

export const readDraft = (userId: string, now = Date.now()): HwDraft | null => {
  const raw = read(DRAFT_KEY);
  const draft = parseDraft(raw, userId, now);
  // Чужой или протухший черновик стираем сразу: на общем телефоне он не должен пережить смену человека.
  if (raw && !draft) drop(DRAFT_KEY);
  return draft;
};

export const saveDraft = (draft: HwDraft) => (isEmptyDraft(draft) ? drop(DRAFT_KEY) : write(DRAFT_KEY, JSON.stringify(draft)));
export const clearDraft = () => drop(DRAFT_KEY);

/** Ключ идемпотентности отложенной записи. randomUUID есть в Safari с iOS 15.4; на всякий случай — запасной вариант. */
export const newQueueKey = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export const readQueue = () => parseQueue(read(QUEUE_KEY));

/** Пишем очередь и сообщаем окну — плашка «ждёт отправки» обновляется без перезагрузки. */
export const writeQueue = (list: QueuedHw[]) => {
  if (list.length) write(QUEUE_KEY, serializeQueue(list));
  else drop(QUEUE_KEY);
  try {
    window.dispatchEvent(new Event(QUEUE_EVENT));
  } catch {}
};
