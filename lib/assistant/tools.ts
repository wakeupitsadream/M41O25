import "server-only";
import type OpenAI from "openai";
import { z } from "zod";
import { addDaysIso, todayIso } from "@/lib/tz";
import { fitJson } from "./compact";
import { parseToolArguments } from "./stream";
import { birthdaysList, contactsList, homeworkRange, membersList, newsList, pollsList, questionsList, scheduleRange, tasksList } from "./tools-data";
import { TOOL_NAMES, type ToolName } from "./types";

/*
 * Инструменты помощника (docs/AI-CHAT.md §6): JSON-схемы для модели, Zod-проверка аргументов и выполнение.
 * Все только читают. groupId и userId — из сессии (ToolContext), в схемах их нет, а лишние ключи в аргументах
 * Zod молча отбрасывает: модель не может попросить чужие данные, подставив userId.
 *
 * Схемы — подмножество JSON Schema, которое понимают и Gemini, и Claude через совместимый слой: без pattern,
 * additionalProperties и пустых properties (у Gemini «объект без свойств» бывает ошибкой), поэтому у бывших
 * «{}»-инструментов есть необязательный фильтр — он и полезен.
 */

export type ToolContext = { groupId: string; userId: string };

/** Самый длинный диапазон расписания за вызов: две недели — это ~80 пар, больше в 4000 символов всё равно не влезет. */
export const SCHEDULE_MAX_DAYS = 14;
const HOMEWORK_DEFAULT_DAYS = 14;
const HOMEWORK_MAX_DAYS = 62;

// ---------- Аргументы ----------

/** Календарная дата YYYY-MM-DD, существующая (не 2026-02-30): иначе addDaysIso молча уедет в март. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "дата в формате YYYY-MM-DD")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
  }, "такой даты нет");

/** Число-лимит: модель иногда шлёт "5" строкой или 50 при потолке 20 — не спорим, а приводим к диапазону. */
const intIn = (min: number, max: number, def: number) =>
  z.coerce
    .number()
    .int()
    .catch(def)
    .transform((n) => Math.min(Math.max(n, min), max));

const flag = z
  .preprocess((v) => (v === "true" ? true : v === "false" ? false : v), z.boolean())
  .optional()
  .catch(undefined);

const text = (max: number) => z.string().trim().max(max).optional().catch(undefined);

const SCHEMAS = {
  get_schedule: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  get_homework: z.object({ from: isoDate.optional(), to: isoDate.optional(), subject: text(60) }),
  get_news: z.object({ limit: intIn(1, 20, 10) }),
  get_polls: z.object({ open_only: flag }),
  get_tasks: z.object({ open_only: flag }),
  get_contacts: z.object({ query: text(60) }),
  get_birthdays: z.object({ days: intIn(1, 60, 30) }),
  get_group_members: z.object({ query: text(60) }),
  get_anon_questions: z.object({ limit: intIn(1, 20, 10) }),
} satisfies Record<ToolName, z.ZodType>;

type Args<N extends ToolName> = z.infer<(typeof SCHEMAS)[N]>;

// ---------- Описания для модели ----------

const DATE_HINT = "Дата YYYY-MM-DD";

const fn = (name: ToolName, description: string, properties: Record<string, unknown>, required: string[] = []): OpenAI.Chat.Completions.ChatCompletionTool => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, ...(required.length ? { required } : {}) } },
});

export const TOOL_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  fn(
    "get_schedule",
    `Пары группы по дням за период (не больше ${SCHEDULE_MAX_DAYS} дней): время, предмет, аудитория, преподаватель, вид, отмены, примечания. Только опубликованные недели.`,
    {
      from: { type: "string", description: `${DATE_HINT}, первый день` },
      to: { type: "string", description: `${DATE_HINT}, последний день включительно` },
    },
    ["from", "to"],
  ),
  fn("get_homework", "Домашние задания с полным текстом, дедлайном, предметом, автором и дополнениями одногруппников. По умолчанию — с сегодня на две недели.", {
    from: { type: "string", description: `${DATE_HINT}, дедлайн не раньше` },
    to: { type: "string", description: `${DATE_HINT}, дедлайн не позже` },
    subject: { type: "string", description: "Часть названия предмета, например «матан» или «история»" },
  }),
  fn("get_news", "Новости группы, свежие и закреплённые сверху.", { limit: { type: "integer", minimum: 1, maximum: 20, description: "Сколько новостей, по умолчанию 10" } }),
  fn("get_polls", "Опросы группы: вопрос, варианты с числом голосов, закрыт ли.", { open_only: { type: "boolean", description: "Только открытые" } }),
  fn("get_tasks", "Задачи группы (сдать деньги, документы и т.п.): описание, дедлайн, сколько человек отметились.", {
    open_only: { type: "boolean", description: "Только незакрытые" },
  }),
  fn("get_contacts", "Контакты преподавателей и деканата: телефон, почта, мессенджер, примечание.", {
    query: { type: "string", description: "Часть имени или предмета" },
  }),
  fn("get_birthdays", "Ближайшие дни рождения в группе (дата без года и через сколько дней).", {
    days: { type: "integer", minimum: 1, maximum: 60, description: "На сколько дней вперёд, по умолчанию 30" },
  }),
  fn("get_group_members", "Состав группы: ФИО, ник, роль в приложении.", { query: { type: "string", description: "Часть имени" } }),
  fn("get_anon_questions", "Анонимные вопросы группы и ответы на них.", { limit: { type: "integer", minimum: 1, maximum: 20, description: "Сколько, по умолчанию 10" } }),
];

// ---------- Выполнение ----------

/** Период «с…по» из необязательных дат: пустой — от сегодня, перевёрнутый — разворачиваем, длинный — режем с пометкой. */
function range(from: string | undefined, to: string | undefined, defaultDays: number, maxDays: number) {
  let a = from ?? (to ? addDaysIso(to, -(defaultDays - 1)) : todayIso());
  let b = to ?? addDaysIso(a, defaultDays - 1);
  if (b < a) [a, b] = [b, a];
  const last = addDaysIso(a, maxDays - 1);
  return b > last ? { from: a, to: last, note: `период урезан до ${maxDays} дней — спроси следующий отдельно` } : { from: a, to: b, note: null };
}

type Handler<N extends ToolName> = (args: Args<N>, ctx: ToolContext) => Promise<string>;

const HANDLERS: { [N in ToolName]: Handler<N> } = {
  async get_schedule(a, ctx) {
    const r = range(a.from, a.to, 7, SCHEDULE_MAX_DAYS);
    const data = await scheduleRange(ctx.groupId, r.from, r.to);
    return fitJson({ ...data, ...(r.note ? { note: r.note } : {}) }, "days");
  },
  async get_homework(a, ctx) {
    const r = range(a.from, a.to, HOMEWORK_DEFAULT_DAYS, HOMEWORK_MAX_DAYS);
    const data = await homeworkRange(ctx.groupId, { from: r.from, to: r.to, subject: a.subject });
    return fitJson({ ...data, ...(r.note ? { note: r.note } : {}) }, "items");
  },
  get_news: async (a, ctx) => fitJson(await newsList(ctx.groupId, ctx.userId, a.limit), "items"),
  get_polls: async (a, ctx) => fitJson(await pollsList(ctx.groupId, ctx.userId, a.open_only ?? false), "items"),
  get_tasks: async (a, ctx) => fitJson(await tasksList(ctx.groupId, a.open_only ?? false), "items"),
  get_contacts: async (a, ctx) => fitJson(await contactsList(ctx.groupId, a.query ?? null), "items"),
  get_birthdays: async (a, ctx) => fitJson(await birthdaysList(ctx.groupId, a.days), "items"),
  get_group_members: async (a, ctx) => fitJson(await membersList(ctx.groupId, a.query ?? null), "items"),
  get_anon_questions: async (a, ctx) => fitJson(await questionsList(ctx.groupId, a.limit), "items"),
};

export const isToolName = (name: string): name is ToolName => (TOOL_NAMES as readonly string[]).includes(name);

const toolError = (message: string) => JSON.stringify({ error: message });

async function run<N extends ToolName>(name: N, raw: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const parsed = SCHEMAS[name].safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return toolError(`Неверные аргументы: ${issue ? `${issue.path.join(".") || "аргументы"} — ${issue.message}` : "проверь формат"}`);
  }
  return HANDLERS[name](parsed.data as Args<N>, ctx);
}

/**
 * Выполнить вызов модели. Никогда не бросает: ошибка превращается в JSON {"error"} для модели — она скажет
 * студенту, что данные сейчас недоступны, а не оборвёт ответ. args — строка из стрима или уже объект (mock).
 */
export async function runTool(name: string, args: string | Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!isToolName(name)) return toolError(`Нет инструмента ${name}. Доступны: ${TOOL_NAMES.join(", ")}`);
  const raw = typeof args === "string" ? parseToolArguments(args) : args;
  if (raw === null) return toolError("Аргументы — не JSON-объект");
  try {
    return await run(name, raw, ctx);
  } catch (e) {
    console.error("[assistant/tools]", name, e instanceof Error ? e.message : e);
    return toolError("Не удалось прочитать данные — ответь без них и предложи посмотреть в приложении");
  }
}
