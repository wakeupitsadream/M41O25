import type { Task } from "../config.js";
import type { ChatRow, Mode } from "../db/store.js";
import { AllModelsFailed, describeFailure } from "../llm/router.js";
import type { GenerateResult, LlmMessage, Part, Reasoning } from "../llm/types.js";
import { errorText, log } from "../log.js";
import { escapeHtml } from "../text/markdown.js";
import { shortId } from "../util/ids.js";
import type { Deps } from "./deps.js";
import { profileForPrompt } from "./profile.js";
import { SUMMARY_PROMPT, systemPrompt, type Intent, type PromptContext } from "./prompts.js";
import { safeDelete, safeEdit, sendAnswer, sendText, startProgress } from "./respond.js";
import { answerKeyboard } from "./ui.js";

const HISTORY_ROWS = 24;
const HISTORY_CHARS = 16_000;
const MESSAGE_CHARS = 6_000;
/** После скольких несжатых сообщений темы старую часть сворачиваем в резюме. */
const SUMMARIZE_AFTER = 30;
const KEEP_RECENT = 12;

export type AnswerKind = "solve" | "tutor" | "ticket" | "check" | "notes";

/** Сохраняется на 7 дней для кнопок под ответом. */
export type AnswerItem = { mode: Mode; kind: AnswerKind; question: string; answer: string };

export type AnswerInput = {
  intent: Intent;
  task: Task;
  reasoning: Reasoning;
  /** Текущее сообщение студента: текст и картинки. */
  parts: Part[];
  /** Что записать в историю от имени студента; пусто — не записывать. */
  historyNote: string;
  useHistory: boolean;
  /** Готовый контекст для кнопок под старым ответом: [вопрос, ответ]. */
  extra?: LlmMessage[];
  replyTo?: string;
  working: string | null;
  /** Какие кнопки повесить под ответ (null — без кнопок). */
  keyboard: AnswerKind | null;
  /** Формулировка вопроса для кнопок «короче/подробнее» (без картинок). */
  question: string;
  mode: Mode;
  maxOutputTokens: number;
  temperature?: number;
  footer?: boolean;
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function historyMessages(deps: Deps, chat: ChatRow): Promise<LlmMessage[]> {
  const rows = await deps.store.history(chat.chatId, chat.topic, chat.summaryUpto, HISTORY_ROWS);
  const out: LlmMessage[] = [];
  let total = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    const text = clip(r.content, MESSAGE_CHARS);
    if (out.length && total + text.length > HISTORY_CHARS) break;
    total += text.length;
    out.unshift({ role: r.role, parts: [{ type: "text", text }] });
  }
  return out;
}

export async function promptContext(deps: Deps, chat: ChatRow | null): Promise<PromptContext> {
  return { now: deps.now(), tz: deps.config.tz, profile: await profileForPrompt(deps), summary: chat?.summary ?? null };
}

export async function reportFailure(deps: Deps, chatId: number, err: unknown, placeholderMid: string | null, replyTo?: string): Promise<void> {
  let html: string;
  if (err instanceof AllModelsFailed) {
    const details = escapeHtml(describeFailure(err, deps.now(), deps.config.tz));
    html = `😔 Не получилось ответить: бесплатные модели сейчас недоступны.\n\n${details}\n\nПодробнее — /status.`;
  } else {
    log("error", "answer_failed", { error: errorText(err), stack: err instanceof Error ? err.stack?.slice(0, 1500) : undefined });
    html = "😔 Что-то сломалось при ответе. Попробуй ещё раз — если повторится, загляни в /status.";
  }
  if (!(await safeEdit(deps, placeholderMid, html))) await sendText(deps, chatId, html, undefined, replyTo);
}

export function footerFor(result: GenerateResult): string {
  const cut = result.finishReason && /MAX_TOKENS|length/i.test(result.finishReason) ? " · ответ обрезан по длине" : "";
  return `⚙️ ${result.model.label}${cut}`;
}

/** Главный путь ответа: промпт → модель (с запасными) → разметка → сообщения → история и кнопки. */
export async function runAnswer(deps: Deps, chat: ChatRow, a: AnswerInput): Promise<void> {
  const ctx = await promptContext(deps, a.useHistory ? chat : null);
  const history = a.useHistory ? await historyMessages(deps, chat) : [];
  const messages: LlmMessage[] = [...history, ...(a.extra ?? []), { role: "user", parts: a.parts }];
  const progress = await startProgress(deps, chat.chatId, a.working, a.replyTo);
  let result: GenerateResult;
  try {
    result = await deps.router.generate(
      a.task,
      {
        system: systemPrompt(a.intent, ctx),
        messages,
        maxOutputTokens: a.maxOutputTokens,
        temperature: a.temperature ?? 0.3,
        reasoning: a.reasoning,
      },
      { deadline: deps.deadline },
    );
  } catch (err) {
    progress.stop();
    await reportFailure(deps, chat.chatId, err, progress.mid, a.replyTo);
    return;
  }
  progress.stop();

  // Ответ — главное: сбой записи в базу не должен его потерять, поэтому запись — после отправки и без исключений.
  let answerId = a.keyboard ? shortId() : null;
  if (answerId) {
    const item: AnswerItem = { mode: a.mode, kind: a.keyboard!, question: clip(a.question, 8000), answer: clip(result.text, 12000) };
    await deps.store.putItem(answerId, chat.chatId, "answer", item, 7 * 86400).catch((err) => {
      log("error", "answer_item_failed", { error: errorText(err) });
      answerId = null;
    });
  }
  const mids = await sendAnswer(deps, chat.chatId, result.text, {
    replyTo: a.replyTo,
    keyboard: answerId ? answerKeyboard(answerId, a.keyboard!) : undefined,
    footer: a.footer === false ? undefined : footerFor(result),
  });
  await safeDelete(deps, progress.mid);
  try {
    if (a.historyNote) await deps.store.addMessage(chat.chatId, chat.topic, "user", a.historyNote, { mode: a.mode });
    await deps.store.addMessage(chat.chatId, chat.topic, "assistant", result.text, { model: result.model.key, mids, mode: a.mode });
  } catch (err) {
    log("error", "history_write_failed", { error: errorText(err) });
    return;
  }
  if (a.useHistory) await maybeSummarize(deps, chat).catch((err) => log("warn", "summary_failed", { error: errorText(err) }));
}

/** Длинная тема → старая часть сворачивается в резюме дешёвой моделью; свежие сообщения остаются как есть. */
export async function maybeSummarize(deps: Deps, chat: ChatRow): Promise<void> {
  const count = await deps.store.countAfter(chat.chatId, chat.topic, chat.summaryUpto);
  if (count <= SUMMARIZE_AFTER) return;
  const rows = await deps.store.history(chat.chatId, chat.topic, chat.summaryUpto, 80);
  const old = rows.slice(0, Math.max(0, rows.length - KEEP_RECENT));
  if (!old.length) return;
  const transcript =
    (chat.summary ? `Предыдущее резюме: ${chat.summary}\n\n` : "") +
    old.map((r) => `${r.role === "user" ? "Студент" : "Помощник"}: ${clip(r.content, 1500)}`).join("\n\n");
  const res = await deps.router.generate(
    "light",
    {
      system: SUMMARY_PROMPT,
      messages: [{ role: "user", parts: [{ type: "text", text: clip(transcript, 40_000) }] }],
      maxOutputTokens: 700,
      temperature: 0.2,
      reasoning: "off",
    },
    { deadline: deps.deadline },
  );
  await deps.store.setSummary(chat.chatId, chat.topic, clip(res.text, 1600), old[old.length - 1]!.id);
}
