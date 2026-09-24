import { pluralRu } from "@/lib/utils";
import type { AssistantState } from "../types";

/*
 * Подписи раздела «Помощник» для хаба, раздела и чата. Чистые функции без пояса по умолчанию: где нужен пояс,
 * его передаёт вызывающий (сервер — APP_TZ из lib/tz), чтобы тест был детерминированным.
 */

/** «2026-09-30» → «30.09»: коротко для «до …» в плитке и карточке статуса. Не дата — вернётся как есть. */
export const ddmm = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : iso);

export const priceLine = (priceRub: number) => `${priceRub} ₽ в месяц`;

export const daysWord = (n: number) => pluralRu(n, "день", "дня", "дней");

/** Подсказка на плитке хаба «Группа» по состоянию доступа (docs/AI-CHAT.md §8). */
export function accessHint({ access, settings }: Pick<AssistantState, "access" | "settings">): string {
  switch (access.kind) {
    case "none":
      return settings.trialDays > 0 ? `${settings.trialDays} ${daysWord(settings.trialDays)} бесплатно` : priceLine(settings.priceRub);
    case "trial":
      return `пробная до ${ddmm(access.until)}`;
    case "paid":
      return `оплачено до ${ddmm(access.until)}`;
    case "expired":
      return priceLine(settings.priceRub);
  }
}

/** Что модель читает, по имени инструмента из события {"t":"tool"}. Винительный падеж: «читаю …». */
const TOOL_WHAT: Record<string, string> = {
  get_schedule: "расписание",
  get_homework: "домашку",
  get_news: "новости",
  get_polls: "опросы",
  get_tasks: "задачи",
  get_contacts: "контакты",
  get_birthdays: "дни рождения",
  get_group_members: "список группы",
  get_anon_questions: "анонимные вопросы",
};

/** Незнакомый инструмент (сервер обновился раньше клиента) — общая фраза, а не сырое имя функции. */
export const toolLabel = (name: string) => `читаю ${TOOL_WHAT[name] ?? "данные группы"}…`;

/** Как у fmtDayShort в расписании (date-fns ru, «d MMM» без точки) — чтобы даты в приложении выглядели одинаково. */
const MONTHS_SHORT = ["янв", "февр", "мар", "апр", "мая", "июн", "июл", "авг", "сент", "окт", "нояб", "дек"];

const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/**
 * Дата беседы в списке: сегодня — время, вчера — «вчера», в этом году — «12 сент», раньше — «12.09.2025».
 * today — YYYY-MM-DD в поясе группы, tz — сам пояс: момент updatedAt переводится в сутки группы, а не устройства.
 */
export function conversationDate(iso: string, today: string, tz: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const day = dayIn(d, tz);
  if (day === today) return new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  if (diff === 1) return "вчера";
  const [y, m, dd] = day.split("-");
  return y === today.slice(0, 4) ? `${Number(dd)} ${MONTHS_SHORT[Number(m) - 1]}` : `${dd}.${m}.${y}`;
}
