import type { ChatRow, MediaRef, Mode } from "../db/store.js";
import { AllModelsFailed, describeFailure } from "../llm/router.js";
import type { Part } from "../llm/types.js";
import { errorText, log } from "../log.js";
import { escapeHtml } from "../text/markdown.js";
import { convertMath } from "../text/latex.js";
import { shortId } from "../util/ids.js";
import { promptContext, reportFailure, runAnswer, type AnswerItem } from "./answer.js";
import type { Deps } from "./deps.js";
import { loadAudio, loadImages } from "./media.js";
import { EXTRACT_PROMPT, QUIZ_PROMPT, header } from "./prompts.js";
import { safeDelete, safeEdit, sendText, startProgress } from "./respond.js";
import { FOLLOWUP_LABEL, FOLLOWUP_WORKING, MODE_INFO, PHOTO_WORKING, quizKeyboard, tasksKeyboard, type Followup, type PhotoAction } from "./ui.js";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Достаёт первый JSON-объект из ответа модели (бывает обёрнут в ```json или текст вокруг). */
export function parseJsonObject<T>(text: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const start = c.indexOf("{");
    const end = c.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try {
      return JSON.parse(c.slice(start, end + 1)) as T;
    } catch {
      // следующий кандидат
    }
  }
  return null;
}

export type TaskInfo = { label: string; summary: string; text: string };
type Extraction = { tasks?: TaskInfo[]; handwritten_solution?: boolean; readable?: boolean };
type StudyMode = Exclude<Mode, "chat">;
export type TasksItem = { refs: MediaRef[]; tasks: TaskInfo[]; mode: StudyMode; replyTo: string | null };

/** Режим, в котором решаем фото: из «болталки» задача всё равно решается решателем. */
export const studyMode = (mode: Mode): StudyMode => (mode === "chat" ? "solve" : mode);

const SOLVE_INSTRUCTION: Record<Mode, string> = {
  solve: "Реши задание с фото.",
  tutor: "Разбери со мной задание с фото — в режиме репетитора.",
  ticket: "Ответь на вопрос билета с фото.",
  chat: "Что скажешь про это фото?",
};

function photoNote(count: number, caption: string): string {
  const head = count > 1 ? `[фото ×${count}]` : "[фото]";
  return caption ? `${head} ${caption}` : head;
}

/** Распознаёт список заданий на фото лёгкой моделью; null — не вышло (тогда решаем целиком). */
async function extractTasks(deps: Deps, images: Part[]): Promise<Extraction | null> {
  try {
    const res = await deps.router.generate(
      "vision",
      {
        system: EXTRACT_PROMPT,
        messages: [{ role: "user", parts: [...images, { type: "text", text: "Какие задания на фото? Ответь JSON." }] }],
        maxOutputTokens: 3000,
        temperature: 0,
        reasoning: "off",
        json: true,
      },
      { deadline: Math.min(deps.deadline, Date.now() + 60_000) },
    );
    const parsed = parseJsonObject<Extraction>(res.text);
    if (!parsed || !Array.isArray(parsed.tasks)) return null;
    parsed.tasks = parsed.tasks
      .filter((t) => t && typeof t.text === "string" && t.text.trim())
      .map((t, i) => ({ label: String(t.label || i + 1).slice(0, 20), summary: String(t.summary || "").slice(0, 80), text: t.text.slice(0, 3000) }));
    return parsed;
  } catch (err) {
    log("warn", "extract_failed", { error: errorText(err) });
    return null;
  }
}

/** Фото + действие (кнопка под фото или подпись). */
export async function runPhotoAction(
  deps: Deps,
  chat: ChatRow,
  action: PhotoAction,
  refs: MediaRef[],
  caption: string,
  replyTo: string | undefined,
  quoted: string | null = null,
): Promise<void> {
  const { parts: images, failed, dropped } = await loadImages(deps, refs);
  if (!images.length) {
    await sendText(deps, chat.chatId, "Не получилось скачать фото из MAX 😕 Пришли его ещё раз.", undefined, replyTo);
    return;
  }
  const warn = [failed ? `не скачалось фото: ${failed}` : "", dropped ? `беру первые ${images.length} фото` : ""].filter(Boolean);
  const context = quoted ? `Студент отвечает на сообщение: «${clip(quoted, 2000)}»\n\n` : "";
  const note = photoNote(images.length, caption);
  const mode = studyMode(chat.mode);

  if (warn.length) await sendText(deps, chat.chatId, `ℹ️ ${escapeHtml(warn.join("; "))}`);

  if (action === "check") {
    return runAnswer(deps, chat, {
      intent: { kind: "check" },
      task: "solve",
      reasoning: "high",
      parts: [...images, { type: "text", text: `${context}${caption || "Проверь моё решение."}` }],
      historyNote: `${note} — проверь решение`,
      useHistory: true,
      replyTo,
      working: PHOTO_WORKING.check,
      keyboard: "check",
      question: `${note}: проверка решения. ${caption}`,
      mode,
      maxOutputTokens: 8000,
    });
  }
  if (action === "notes" || action === "ocr") {
    return runAnswer(deps, chat, {
      intent: { kind: action },
      task: "vision",
      reasoning: "off",
      parts: [...images, { type: "text", text: caption || (action === "notes" ? "Сделай конспект." : "Перепиши текст с фото.") }],
      historyNote: `${note} — ${action === "notes" ? "конспект" : "текст с фото"}`,
      useHistory: false,
      replyTo,
      working: PHOTO_WORKING[action],
      keyboard: action === "notes" ? "notes" : null,
      question: `${note}: ${action === "notes" ? "конспект" : "распознать текст"}`,
      mode,
      maxOutputTokens: 6000,
      temperature: 0.1,
    });
  }
  if (action === "chat") {
    return runAnswer(deps, chat, {
      intent: { kind: "mode", mode: "chat" },
      task: "chat",
      reasoning: "off",
      parts: [...images, { type: "text", text: `${context}${caption || SOLVE_INSTRUCTION.chat}` }],
      historyNote: note,
      useHistory: true,
      replyTo,
      working: null,
      keyboard: null,
      question: note,
      mode: "chat",
      maxOutputTokens: 1500,
      temperature: 0.7,
      footer: false,
    });
  }

  // «Решить»: с подписью — сразу; без подписи — сначала смотрим, сколько заданий на фото.
  let hint = "";
  if (!caption) {
    const progress = await startProgress(deps, chat.chatId, "👀 Смотрю, что на фото…", replyTo);
    const found = await extractTasks(deps, images);
    progress.stop();
    const tasks = found?.tasks ?? [];
    const id = shortId();
    const saved =
      tasks.length >= 2 && !found?.handwritten_solution
        ? await deps.store
            .putItem(id, chat.chatId, "tasks", { refs, tasks, mode, replyTo: replyTo ?? null } satisfies TasksItem, 86400)
            .then(() => true)
            .catch((err) => {
              log("error", "tasks_item_failed", { error: errorText(err) });
              return false;
            })
        : false;
    if (saved) {
      const list = tasks
        .slice(0, 8)
        .map((t, i) => `${i + 1}. <b>${escapeHtml(t.label)}</b> — ${escapeHtml(convertMath(t.summary || clip(t.text, 70)))}`)
        .join("\n");
      const more = tasks.length > 8 ? `\n…и ещё ${tasks.length - 8}` : "";
      const html = `На фото ${tasks.length} задани${tasks.length < 5 ? "я" : "й"}:\n${list}${more}\n\nКакое решаем?`;
      if (!(await safeEdit(deps, progress.mid, html, tasksKeyboard(id, tasks.length)))) {
        await sendText(deps, chat.chatId, html, tasksKeyboard(id, tasks.length), replyTo);
      }
      return;
    }
    await safeDelete(deps, progress.mid);
    if (tasks.length === 1) hint = `\n\nРаспознанное условие (сверь с фото): ${tasks[0]!.text}`;
  }
  return runAnswer(deps, chat, {
    intent: { kind: "mode", mode },
    task: "solve",
    reasoning: mode === "solve" ? "high" : "medium",
    parts: [...images, { type: "text", text: `${context}${caption || SOLVE_INSTRUCTION[mode]}${hint}` }],
    historyNote: `${note}${hint ? ` (условие: ${clip(hint.trim(), 600)})` : ""}`,
    useHistory: true,
    replyTo,
    working: MODE_INFO[mode].working,
    keyboard: mode,
    question: `${note}${hint}`,
    mode,
    maxOutputTokens: 9000,
  });
}

/** Выбор задания из списка, найденного на фото. */
export async function runTaskPick(deps: Deps, chat: ChatRow, item: TasksItem, pick: number | "all", replyTo: string | undefined): Promise<void> {
  const { parts: images } = await loadImages(deps, item.refs);
  if (!images.length) {
    await sendText(deps, chat.chatId, "Фото уже недоступны в MAX — пришли их ещё раз.");
    return;
  }
  const task = pick === "all" ? null : item.tasks[pick - 1];
  if (pick !== "all" && !task) return;
  const instruction = task
    ? `Реши задание ${task.label} с фото. Распознанное условие (сверь с фото): ${task.text}`
    : `Реши все задания с фото по порядку:\n${item.tasks.map((t) => `${t.label}: ${t.text}`).join("\n")}`;
  const note = `${photoNote(images.length, "")} ${task ? `задание ${task.label}: ${clip(task.text, 400)}` : "все задания"}`;
  await runAnswer(deps, chat, {
    intent: { kind: "mode", mode: item.mode },
    task: "solve",
    reasoning: item.mode === "solve" ? "high" : "medium",
    parts: [...images, { type: "text", text: instruction }],
    historyNote: note,
    useHistory: true,
    replyTo,
    working: MODE_INFO[item.mode].working,
    keyboard: item.mode,
    question: note,
    mode: item.mode,
    maxOutputTokens: pick === "all" ? 14000 : 9000,
  });
}

/** Кнопки под ответом: короче, подробнее, проще, покажи решение. */
export async function runFollowup(deps: Deps, chat: ChatRow, item: AnswerItem, action: Exclude<Followup, "quiz">, replyTo: string | undefined): Promise<void> {
  const heavy = action === "more" || action === "solve";
  const instruction: Record<typeof action, string> = {
    short: "Сократи свой ответ выше.",
    more: "Распиши подробнее.",
    simple: "Объясни проще.",
    solve: "Покажи полное решение.",
  };
  await runAnswer(deps, chat, {
    intent: { kind: "followup", action, mode: item.mode },
    task: heavy ? "solve" : "light",
    reasoning: action === "solve" ? "high" : heavy ? "medium" : "off",
    extra: [
      { role: "user", parts: [{ type: "text", text: item.question }] },
      { role: "assistant", parts: [{ type: "text", text: item.answer }] },
    ],
    parts: [{ type: "text", text: instruction[action] }],
    historyNote: `[кнопка: ${FOLLOWUP_LABEL[action]}]`,
    useHistory: false,
    replyTo,
    working: FOLLOWUP_WORKING[action],
    keyboard: action === "solve" ? "solve" : item.kind,
    question: item.question,
    mode: action === "solve" ? "solve" : item.mode,
    maxOutputTokens: heavy ? 9000 : 2500,
  });
}

type Quiz = { questions?: string[]; answers?: string[] };

export async function runQuiz(deps: Deps, chat: ChatRow, item: AnswerItem, replyTo: string | undefined): Promise<void> {
  const progress = await startProgress(deps, chat.chatId, FOLLOWUP_WORKING.quiz, replyTo);
  const ctx = await promptContext(deps, null);
  try {
    const res = await deps.router.generate(
      "light",
      {
        system: `${header(ctx)}\n\n${QUIZ_PROMPT}`,
        messages: [
          { role: "user", parts: [{ type: "text", text: item.question }] },
          { role: "assistant", parts: [{ type: "text", text: item.answer }] },
          { role: "user", parts: [{ type: "text", text: "Составь вопросы для самопроверки. Ответь JSON." }] },
        ],
        maxOutputTokens: 2000,
        temperature: 0.5,
        reasoning: "off",
        json: true,
      },
      { deadline: deps.deadline },
    );
    progress.stop();
    const quiz = parseJsonObject<Quiz>(res.text);
    const questions = (quiz?.questions ?? []).filter((q) => typeof q === "string" && q.trim()).slice(0, 5);
    const answers = (quiz?.answers ?? []).filter((q) => typeof q === "string").slice(0, 5);
    if (!questions.length) {
      await safeDelete(deps, progress.mid);
      await sendText(deps, chat.chatId, escapeHtml(convertMath(res.text)), undefined, replyTo);
      return;
    }
    const id = shortId();
    await deps.store.putItem(id, chat.chatId, "quiz", { answers }, 7 * 86400).catch((err) => log("error", "quiz_item_failed", { error: errorText(err) }));
    const html = `🧠 <b>Проверь себя</b>\n\n${questions.map((q, i) => `${i + 1}. ${escapeHtml(convertMath(q))}`).join("\n")}\n\nОтветь в чат — проверю, или открой ответы.`;
    if (!(await safeEdit(deps, progress.mid, html, quizKeyboard(id)))) await sendText(deps, chat.chatId, html, quizKeyboard(id), replyTo);
    await deps.store
      .addMessage(chat.chatId, chat.topic, "assistant", `Вопросы для самопроверки:\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`, { quiz: id })
      .catch((err) => log("error", "history_write_failed", { error: errorText(err) }));
  } catch (err) {
    progress.stop();
    await reportFailure(deps, chat.chatId, err, progress.mid, replyTo);
  }
}

/** Голосовое → текст. null — не вышло (о причине пользователю уже сказано). */
export async function transcribeVoice(deps: Deps, chat: ChatRow, ref: MediaRef): Promise<string | null> {
  const progress = await startProgress(deps, chat.chatId, null);
  try {
    const audio = await loadAudio(deps, ref);
    const { text } = await deps.router.transcribe(audio, { deadline: Math.min(deps.deadline, Date.now() + 120_000) });
    progress.stop();
    await sendText(deps, chat.chatId, `🎙 <i>${escapeHtml(clip(text, 1500))}</i>`, undefined, ref.mid);
    return text;
  } catch (err) {
    progress.stop();
    if (err instanceof AllModelsFailed) {
      const details = escapeHtml(describeFailure(err, deps.now(), deps.config.tz));
      await sendText(deps, chat.chatId, `🎙 Не смог распознать голосовое.\n\n${details}\n\nНапиши текстом или попробуй позже.`, undefined, ref.mid);
    } else {
      log("warn", "voice_failed", { error: errorText(err) });
      await sendText(deps, chat.chatId, "🎙 Не получилось скачать или распознать голосовое — попробуй ещё раз или напиши текстом.", undefined, ref.mid);
    }
    return null;
  }
}
