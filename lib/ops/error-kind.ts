/**
 * Чистая логика экрана ошибки: чем на самом деле вызван сбой и что сказать после самопроверки связи.
 *
 * Вынесено из компонента, потому что цена вранья тут высокая. Однажды экран сказал «Нет сети» на 500-ку
 * с preview-деплоя (в Preview убрали `DATABASE_URL`, а установленная на телефон PWA смотрела именно туда) —
 * человек полчаса искал поломку в своём вайфае. «Нет сети» имеет право появиться, только когда браузер
 * прямо говорит, что сети нет; всё остальное — поломка сервера, и её надо называть своим именем.
 */

/** Рабочий адрес. Только с него ставят приложение на телефон; preview-копии живут на raspison-git-*.vercel.app. */
export const PROD_HOST = "raspison.vercel.app";

export type ErrorKind =
  /** Браузер знает, что сети нет. */
  | "offline"
  /** Сеть есть, но запрос до сервера не дошёл или оборвался. */
  | "server-error"
  /** Всё прочее: в production Next прячет текст серверной ошибки, гадать по нему нечего. */
  | "unknown";

/** Тексты браузеров про оборванный запрос. Сами по себе они НЕ означают «нет сети»: так же выглядит мёртвый сервер. */
const NETWORK_MESSAGE = /Failed to fetch|Load failed|NetworkError|fetch failed|ERR_INTERNET_DISCONNECTED/i;

/** `online` — это `navigator.onLine`; `undefined` (сервер, старый браузер) считаем «сеть, скорее всего, есть». */
export function classifyError(input: { online?: boolean; message?: string | null }): ErrorKind {
  if (input.online === false) return "offline";
  if (input.message && NETWORK_MESSAGE.test(input.message)) return "server-error";
  return "unknown";
}

export type ErrorCopy = { title: string; hint: string };

export function errorCopy(kind: ErrorKind): ErrorCopy {
  if (kind === "offline") return { title: "Нет сети", hint: "Действие не отправлено. Появится связь — повтори." };
  if (kind === "server-error") return { title: "Сервер не ответил", hint: "Сеть есть, а ответа нет. Повтори через минуту или проверь связь кнопкой ниже." };
  return { title: "Что-то пошло не так", hint: "Похоже, сломалось на сервере, а не у тебя. Повтори; если повторяется — передай админу код ошибки." };
}

/** Итог запроса к `/api/health`: `reached: false` — ответа не было вообще (сеть, таймаут, мёртвый сервер). */
export type ProbeOutcome = { reached: false } | { reached: true; status: number; env?: string | null; branch?: string | null };

export type ProbeVerdict = { tone: "ok" | "warn" | "bad"; text: string };

/** Словами: что именно показала самопроверка. Ответ сервера отделяем от «рабочее ли это приложение». */
export function probeVerdict(outcome: ProbeOutcome): ProbeVerdict {
  if (!outcome.reached) return { tone: "bad", text: "Сервер недоступен — запрос не дошёл. Похоже, дело в связи или сервер лежит." };
  if (outcome.status >= 500) return { tone: "bad", text: `Сервер отвечает ошибкой ${outcome.status} — поломка на сервере. Передай админу код ошибки.` };
  if (outcome.env && outcome.env !== "production") {
    const branch = outcome.branch ? ` (ветка ${outcome.branch})` : "";
    return { tone: "warn", text: `Связь есть, но это тестовая копия${branch}, а не рабочее приложение. Открой ${PROD_HOST} в браузере и поставь ярлык оттуда.` };
  }
  if (outcome.status !== 200) return { tone: "warn", text: `Сервер отвечает (${outcome.status}) — значит, дело не в связи. Передай админу код ошибки.` };
  return { tone: "ok", text: "Сервер отвечает — дело не в связи. Передай админу код ошибки." };
}
