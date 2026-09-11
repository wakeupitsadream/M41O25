import { firstName } from "@/lib/utils";
import type { PushTopic } from "@/lib/push/topics";

/** Что показать на экране телефона. url открывается по тапу (обработчик notificationclick в app/sw.ts). */
export type PushPayload = { title: string; body: string; url: string; tag: string };

/** События, о которых шлём пуш. Автор — уже готовое имя («Максим»); как его выбрать, решает вызывающий. */
export type PushEvent =
  | { kind: "news"; author: string; title?: string | null; body: string }
  | { kind: "anon_question"; body: string }
  | { kind: "anon_answer"; author: string; body: string }
  | { kind: "poll"; author: string; question: string };

const MAX_BODY = 140;

/** Короткая выжимка текста: одна строка, без обрыва посреди слова, с многоточием если не влезло. */
export function snippet(text: string, max = MAX_BODY): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const kept = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${kept.replace(/[\s.,;:!?—-]+$/, "")}…`;
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

export const topicOf = (kind: PushEvent["kind"]): PushTopic => (kind === "news" ? "news" : kind === "poll" ? "polls" : "questions");

/** Заголовок — что случилось, тело — начало текста. Имя приложения iOS подставит сам, дублировать не нужно. */
export function buildNotification(event: PushEvent): PushPayload {
  switch (event.kind) {
    case "news":
      return {
        title: `Новость от ${genitiveName(event.author)}`,
        body: snippet(event.title ? `${event.title}. ${event.body}` : event.body),
        url: "/group/news",
        tag: "news",
      };
    case "anon_question":
      return { title: "Анонимный вопрос", body: snippet(event.body), url: "/group/questions", tag: "questions" };
    case "anon_answer":
      // Без «ответил/ответила»: пола в профиле нет, а половине группы такой заголовок был бы неверен.
      return { title: `Ответ от ${genitiveName(event.author)}`, body: snippet(event.body), url: "/group/questions", tag: "questions" };
    case "poll":
      return { title: `Опрос от ${genitiveName(event.author)}`, body: snippet(event.question), url: "/group/polls", tag: "polls" };
  }
}
