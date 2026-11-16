import type { ChatRow, MediaRef } from "../db/store.js";
import { isMode } from "../db/store.js";
import { kindText } from "../llm/router.js";
import { errorText, log } from "../log.js";
import type { Message, Update, User } from "../max/types.js";
import { convertMath } from "../text/latex.js";
import { escapeHtml } from "../text/markdown.js";
import { formatWhen } from "../util/time.js";
import { runAnswer, type AnswerItem } from "./answer.js";
import type { Deps } from "./deps.js";
import { runFollowup, runPhotoAction, runQuiz, runTaskPick, transcribeVoice, type TasksItem } from "./flows.js";
import { mediaOf } from "./media.js";
import { defaultAbout, raspisonProfile } from "./profile.js";
import { safeDelete, safeEdit, sendText } from "./respond.js";
import {
  BOT_COMMANDS,
  HELP_TEXT,
  MODE_INFO,
  modeLabel,
  modePickerKeyboard,
  modePickerText,
  photoKeyboard,
  photoPromptText,
  type Followup,
  type PhotoAction,
} from "./ui.js";

const PENDING_TTL_SEC = 30 * 60;
/** Пауза, чтобы фото из одной пачки (альбом, несколько подряд) успели собраться вместе. */
const PHOTO_SETTLE_MS = 1500;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function dedupKey(update: Update): string | null {
  switch (update.update_type) {
    case "message_created":
      return "message" in update && update.message?.body?.mid ? `m:${update.message.body.mid}` : null;
    case "message_callback":
      return "callback" in update && update.callback?.callback_id ? `c:${update.callback.callback_id}` : null;
    case "bot_started":
      return "chat_id" in update ? `b:${update.chat_id}:${update.timestamp}` : null;
    default:
      return null;
  }
}

async function ownerId(deps: Deps): Promise<number | null> {
  if (deps.config.ownerId) return deps.config.ownerId;
  return (await deps.store.getState<{ userId: number }>("owner"))?.userId ?? null;
}

export async function setupCommands(deps: Deps): Promise<void> {
  await deps.max.setCommands(BOT_COMMANDS).catch((err) => log("warn", "set_commands_failed", { error: errorText(err) }));
}

function welcome(name: string | undefined, mode: ChatRow["mode"]): string {
  return [
    `Привет${name ? `, ${escapeHtml(name)}` : ""}! Я твой помощник по учёбе 👋`,
    "",
    "Пришли задачу текстом, фото или голосовым — решу, проверю, объясню.",
    `Сейчас режим: <b>${modeLabel(mode)}</b>. Сменить — кнопками ниже или /mode.`,
    "",
    "Все команды — /help.",
  ].join("\n");
}

/**
 * Личный бот: отвечает только владельцу. Пока владельца нет, первый, кто пришлёт последние 6 символов токена
 * бота, становится владельцем (токен знает только тот, кто создал бота). Чужим — одно вежливое сообщение в сутки.
 */
async function gate(deps: Deps, user: User, chatId: number, text: string): Promise<boolean> {
  const owner = await ownerId(deps);
  if (owner === user.user_id) return true;
  if (owner !== null) {
    if (await deps.store.tryLock(`stranger:${user.user_id}`, 86400)) {
      await sendText(deps, chatId, "Это личный бот — он отвечает только своему владельцу 🙂");
    }
    log("info", "stranger", { userId: user.user_id });
    return false;
  }
  // Счётчик — до сравнения: после 5 попыток в час код не проверяется вовсе, перебор бессмыслен.
  const tries = await deps.store.bump(`claim:${user.user_id}`, chatId, 3600);
  if (tries > 5) {
    if (tries === 6) await sendText(deps, chatId, "Слишком много попыток. Попробуй через час.");
    return false;
  }
  const code = deps.config.maxToken.slice(-6);
  if (code.length === 6 && text.trim() === code) {
    if (await deps.store.setStateIfAbsent("owner", { userId: user.user_id, claimedAt: deps.now().toISOString() })) {
      log("info", "owner_claimed", { userId: user.user_id });
      await setupCommands(deps);
      const chat = await deps.store.getChat(chatId, user.user_id);
      await sendText(deps, chatId, `✅ Готово, бот привязан к тебе.\n\n${welcome(user.first_name, chat.mode)}`, modePickerKeyboard(chat.mode));
    } else {
      await sendText(deps, chatId, "Бот уже привязан к другому пользователю.");
    }
    return false;
  }
  await sendText(
    deps,
    chatId,
    "Привет! Это личный бот, и он пока ни к кому не привязан.\n\nЧтобы привязать его к себе, пришли <b>последние 6 символов токена бота</b> — токен выдал MAX при создании бота.",
  );
  return false;
}

async function statusText(deps: Deps, chat: ChatRow): Promise<string> {
  const now = deps.now();
  const lines: string[] = [`⚙️ <b>Состояние</b>`, `Режим: ${modeLabel(chat.mode)} · тема №${chat.topic}`, ""];
  const sections: Array<[string, Parameters<Deps["router"]["status"]>[0]]> = [
    ["Задачи и фото", "solve"],
    ["Конспект, текст с фото", "vision"],
    ["Болталка", "chat"],
    ["Короткие ответы", "light"],
    ["Голосовые", "transcribe"],
  ];
  for (const [title, task] of sections) {
    const st = await deps.router.status(task);
    lines.push(`<b>${title}</b>`);
    for (const s of st) {
      const today = s.ok || s.fail ? ` · сегодня ✓${s.ok}${s.fail ? ` ✗${s.fail}` : ""}` : "";
      if (s.state === "no_key") lines.push(`🔑 ${escapeHtml(s.model.label)} — нет ключа`);
      else if (s.state === "cooldown")
        lines.push(`⏸ ${escapeHtml(s.model.label)} — ${kindText(s.reason)}, до ${formatWhen(s.until!, now, deps.config.tz)}${today}`);
      else lines.push(`✅ ${escapeHtml(s.model.label)}${today}`);
    }
    lines.push("");
  }
  lines.push(`Версия ${escapeHtml(deps.config.version)} · время ${formatWhen(now, now, deps.config.tz)} (${escapeHtml(deps.config.tz)})`);
  return lines.join("\n");
}

async function profileText(deps: Deps): Promise<string> {
  const about = (await deps.store.getState<string>("profile_about"))?.trim();
  const rasp = await raspisonProfile(deps, true).catch(() => null);
  const subjects = (rasp?.subjects ?? []).map((s) => s.name);
  return [
    "👤 <b>Профиль</b> — его видит модель в каждом запросе",
    "",
    `<b>О тебе:</b> ${escapeHtml(about || defaultAbout(deps))}${about ? "" : " <i>(по умолчанию)</i>"}`,
    deps.config.raspison
      ? `<b>Предметы из Raspison:</b> ${subjects.length ? escapeHtml(subjects.join(", ")) : "не получил — проверь RASPISON_URL и ключ"}`
      : "<b>Предметы:</b> Raspison не подключён (RASPISON_URL, RASPISON_BOT_KEY)",
    "",
    "Изменить: <code>/profile текст о себе</code> · вернуть по умолчанию: <code>/profile -</code>",
  ].join("\n");
}

async function onCommand(deps: Deps, chat: ChatRow, text: string, user: User): Promise<void> {
  const [, rawCmd = "", rest = ""] = /^\/([\p{L}\d_]+)(?:@\S+)?\s*([\s\S]*)$/u.exec(text) ?? [];
  const cmd = rawCmd.toLowerCase();
  switch (cmd) {
    case "start":
      await setupCommands(deps);
      await sendText(deps, chat.chatId, welcome(user.first_name, chat.mode), modePickerKeyboard(chat.mode));
      return;
    case "mode":
    case "режим":
      await sendText(deps, chat.chatId, modePickerText(chat.mode), modePickerKeyboard(chat.mode));
      return;
    case "new":
    case "заново": {
      const topic = await deps.store.newTopic(chat.chatId);
      await sendText(deps, chat.chatId, `🆕 Новая тема №${topic} — прошлый разговор больше не учитываю.`);
      return;
    }
    case "profile":
    case "профиль": {
      const value = rest.trim();
      if (value === "-" || value.toLowerCase() === "сброс") await deps.store.deleteState("profile_about");
      else if (value) await deps.store.setState("profile_about", clip(value, 600));
      await sendText(deps, chat.chatId, await profileText(deps));
      return;
    }
    case "status":
    case "статус":
      await sendText(deps, chat.chatId, await statusText(deps, chat));
      return;
    default:
      await sendText(deps, chat.chatId, HELP_TEXT);
  }
}

/** Текстовый вопрос в текущем режиме (с цитатой, если студент отвечает на сообщение). */
async function askText(deps: Deps, chat: ChatRow, text: string, mid: string, quoted: string | null): Promise<void> {
  const mode = chat.mode;
  const context = quoted ? `Студент отвечает на сообщение: «${clip(quoted, 3000)}»\n\n` : "";
  await runAnswer(deps, chat, {
    intent: { kind: "mode", mode },
    task: mode === "chat" ? "chat" : "solve",
    reasoning: mode === "solve" ? "high" : mode === "chat" ? "off" : "medium",
    parts: [{ type: "text", text: `${context}${text}` }],
    historyNote: quoted ? `[в ответ на: «${clip(quoted, 300)}»] ${text}` : text,
    useHistory: true,
    replyTo: mode === "chat" ? undefined : mid,
    working: mode === "chat" ? null : MODE_INFO[mode].working,
    keyboard: mode === "chat" ? null : mode,
    question: `${context}${text}`,
    mode,
    maxOutputTokens: mode === "chat" ? 1500 : 9000,
    temperature: mode === "chat" ? 0.8 : 0.3,
    footer: mode !== "chat",
  });
}

/** Действие по подписи к фото: «проверь», «конспект», «перепиши текст»; иначе — как в текущем режиме. */
export function actionFromCaption(caption: string, mode: ChatRow["mode"]): PhotoAction {
  const c = caption.toLowerCase();
  if (/провер|найди ошибк|где ошибк|верно ли|правильно ли/.test(c)) return "check";
  if (/конспект/.test(c)) return "notes";
  if (/перепиши|распознай|текст с фото|что написано/.test(c)) return "ocr";
  return mode === "chat" ? "chat" : "solve";
}

async function onPhotosWithoutCaption(deps: Deps, chat: ChatRow, images: MediaRef[]): Promise<void> {
  const set = await deps.store.appendPending(chat.chatId, images, PENDING_TTL_SEC);
  await deps.sleep(PHOTO_SETTLE_MS);
  const cur = await deps.store.getPending(chat.chatId);
  // Пока ждали, пришло ещё фото (покажет кнопки оно) или подпись (фото уже в работе).
  if (!cur || cur.id !== set.id || cur.seq !== set.seq) return;
  if (cur.promptMid) await safeDelete(deps, cur.promptMid);
  const mid = await sendText(deps, chat.chatId, photoPromptText(cur.media.length), photoKeyboard(cur.id, chat.mode));
  if (mid) await deps.store.setPendingPrompt(chat.chatId, cur.id, mid);
}

async function onMessage(deps: Deps, msg: Message): Promise<void> {
  const user = msg.sender;
  const chatId = msg.recipient?.chat_id;
  if (!user || user.is_bot || !chatId || msg.recipient.chat_type !== "dialog") return;
  let text = (msg.body.text ?? "").trim();
  if (!(await gate(deps, user, chatId, text))) return;
  const chat = await deps.store.getChat(chatId, user.user_id);
  const mid = msg.body.mid;

  if (text.startsWith("/")) return onCommand(deps, chat, text, user);

  const own = mediaOf(msg.body);
  const images = [...own.images];
  const audio = [...own.audio];
  const other = [...own.other];
  let quoted: string | null = null;
  let replyImages: MediaRef[] = [];
  if (msg.link?.type === "forward") {
    const fwd = mediaOf(msg.link.message, mid);
    text = [text, msg.link.message.text?.trim()].filter(Boolean).join("\n\n");
    images.push(...fwd.images);
    audio.push(...fwd.audio);
    other.push(...fwd.other);
  } else if (msg.link?.type === "reply") {
    quoted = msg.link.message.text?.trim() || null;
    replyImages = mediaOf(msg.link.message).images;
  }

  if (audio.length) {
    const transcript = await transcribeVoice(deps, chat, audio[0]!);
    if (!transcript) return;
    text = [text, transcript].filter(Boolean).join("\n\n");
  }

  if (!text && !images.length) {
    if (other.includes("sticker")) await sendText(deps, chatId, ["😄", "👍", "🙌", "😎"][Math.floor(Math.random() * 4)]!);
    else if (other.length) {
      await sendText(deps, chatId, "Пока понимаю текст, фото и голосовые. Документ или видео пришли фотографиями страниц или кадров 📷", undefined, mid);
    }
    return;
  }

  if (images.length && !text) return onPhotosWithoutCaption(deps, chat, images);

  // Подпись или текст после фото без подписи: фото из ожидания забираем вместе с ним.
  const pending = await deps.store.takePending(chatId);
  if (pending?.promptMid) await safeDelete(deps, pending.promptMid);
  const allImages = [...(pending?.media ?? []), ...images, ...(images.length || pending ? [] : replyImages)];
  if (allImages.length) {
    const action = actionFromCaption(text, chat.mode);
    const replyTo = images.length ? mid : (pending?.media[0]?.mid ?? mid);
    return runPhotoAction(deps, chat, action, allImages, text, replyTo, quoted);
  }
  return askText(deps, chat, text, mid, quoted);
}

type CallbackUpdate = Extract<Update, { update_type: "message_callback" }>;

async function onCallback(deps: Deps, update: CallbackUpdate): Promise<void> {
  const { callback } = update;
  const user = callback.user;
  const chatId = update.message?.recipient?.chat_id;
  const msgMid = update.message?.body?.mid;
  const answer = (notification?: string) =>
    deps.max.answerCallback(callback.callback_id, { notification: notification ?? "👌" }).catch((err) => log("warn", "callback_answer_failed", { error: errorText(err) }));
  if (!chatId || !user) return void (await answer());
  const owner = await ownerId(deps);
  if (owner !== user.user_id) return void (await answer("Это личный бот"));
  const chat = await deps.store.getChat(chatId, user.user_id);
  const [kind = "", a = "", b = ""] = (callback.payload ?? "").split(":");

  switch (kind) {
    case "m": {
      if (!isMode(a)) return void (await answer());
      await deps.store.setMode(chatId, a);
      await deps.max
        .answerCallback(callback.callback_id, {
          notification: `Режим: ${MODE_INFO[a].title}`,
          message: { text: modePickerText(a), format: "html", attachments: [modePickerKeyboard(a)] },
        })
        .catch(() => answer(`Режим: ${MODE_INFO[a].title}`));
      return;
    }
    case "menu":
      await answer();
      await sendText(deps, chatId, modePickerText(chat.mode), modePickerKeyboard(chat.mode));
      return;
    case "new": {
      const topic = await deps.store.newTopic(chatId);
      await answer("Начали новую тему");
      await sendText(deps, chatId, `🆕 Новая тема №${topic} — прошлый разговор больше не учитываю.`);
      return;
    }
    case "p": {
      const act = b as PhotoAction | "cancel";
      if (!["solve", "check", "notes", "ocr", "chat", "cancel"].includes(act)) return void (await answer());
      const set = await deps.store.takePending(chatId, a);
      if (!set) return void (await answer("Эти фото уже в работе или устарели — пришли заново"));
      if (act === "cancel") {
        await answer("Отменено");
        await safeEdit(deps, msgMid, `${photoPromptText(set.media.length)}\n✖️ Отменено`);
        return;
      }
      await answer("Принято");
      await safeDelete(deps, msgMid);
      return runPhotoAction(deps, chat, act, set.media, "", set.media[0]?.mid);
    }
    case "t": {
      const item = await deps.store.getItem<TasksItem>(a, "tasks");
      if (!item) return void (await answer("Список устарел — пришли фото заново"));
      const pick = b === "all" ? "all" : Number(b);
      if (pick !== "all" && !(Number.isInteger(pick) && pick >= 1 && pick <= item.tasks.length)) return void (await answer());
      if (!(await deps.store.tryLock(`t:${a}:${b}`, 120))) return void (await answer("Уже решаю"));
      await answer(pick === "all" ? "Решаю все" : `Решаю ${item.tasks[pick - 1]!.label}`);
      return runTaskPick(deps, chat, item, pick, item.replyTo ?? undefined);
    }
    case "f": {
      const item = await deps.store.getItem<AnswerItem>(a, "answer");
      if (!item) return void (await answer("Ответ устарел — спроси заново"));
      const act = b as Followup;
      if (!["short", "more", "simple", "quiz", "solve"].includes(act)) return void (await answer());
      if (!(await deps.store.tryLock(`f:${a}:${act}`, 90))) return void (await answer("Уже делаю"));
      await answer("Принято");
      if (act === "quiz") return runQuiz(deps, chat, item, msgMid);
      return runFollowup(deps, chat, item, act, msgMid);
    }
    case "q": {
      const item = await deps.store.getItem<{ answers: string[] }>(a, "quiz");
      if (!item) return void (await answer("Ответы устарели"));
      if (!(await deps.store.tryLock(`q:${a}`, 30))) return void (await answer());
      await answer();
      const list = item.answers.length ? item.answers.map((x, i) => `${i + 1}. ${escapeHtml(convertMath(x))}`).join("\n") : "Ответов нет 🤷";
      await sendText(deps, chatId, `👀 <b>Ответы</b>\n\n${list}`, undefined, msgMid);
      return;
    }
    default:
      await answer();
  }
}

async function onStarted(deps: Deps, update: Extract<Update, { update_type: "bot_started" }>): Promise<void> {
  const owner = await ownerId(deps);
  if (owner !== update.user.user_id) {
    await gate(deps, update.user, update.chat_id, "");
    return;
  }
  const chat = await deps.store.getChat(update.chat_id, update.user.user_id);
  await setupCommands(deps);
  await sendText(deps, update.chat_id, welcome(update.user.first_name, chat.mode), modePickerKeyboard(chat.mode));
}

/** Точка входа для события вебхука: дедупликация и разбор по типам. Ошибки не выпускаем наружу. */
export async function handleUpdate(deps: Deps, update: Update): Promise<void> {
  const key = dedupKey(update);
  if (key && !(await deps.store.markProcessed(key))) {
    log("info", "duplicate_update", { key });
    return;
  }
  try {
    switch (update.update_type) {
      case "message_created":
        await onMessage(deps, (update as Extract<Update, { update_type: "message_created" }>).message);
        break;
      case "message_callback":
        await onCallback(deps, update as CallbackUpdate);
        break;
      case "bot_started":
        await onStarted(deps, update as Extract<Update, { update_type: "bot_started" }>);
        break;
      default:
        break;
    }
  } catch (err) {
    log("error", "update_failed", {
      type: update.update_type,
      error: errorText(err),
      stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
    });
    const chatId =
      "message" in update && update.message?.recipient?.chat_type === "dialog" ? update.message.recipient.chat_id : null;
    if (chatId) await sendText(deps, chatId, "😔 Что-то сломалось при обработке. Попробуй ещё раз через минуту — если повторится, загляни в /status.");
  }
}
