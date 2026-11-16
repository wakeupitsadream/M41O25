import { errorText, log } from "../log.js";
import { MaxApiError } from "../max/client.js";
import type { KeyboardAttachment, NewMessageBody } from "../max/types.js";
import { convertMath } from "../text/latex.js";
import { escapeHtml, htmlToPlain, splitToHtmlMessages } from "../text/markdown.js";
import type { Deps } from "./deps.js";

const LIMIT = 3800;

/**
 * Отправка с откатом: если MAX не принял HTML (400), шлём тот же текст без разметки; если не нашлось сообщение,
 * на которое отвечаем, — шлём без ссылки. Ответ, который модель считала минуту, не должен теряться из-за формата.
 */
export async function sendHtml(deps: Deps, chatId: number, body: NewMessageBody): Promise<string | null> {
  // 400/404 бывает из-за ссылки «ответ на» (сообщение удалено или из другого чата) или из-за разметки.
  // Сначала убираем ссылку, сохраняя форматирование, потом — разметку.
  const attempts: NewMessageBody[] = [{ ...body, format: "html" }];
  if (body.link) attempts.push({ ...body, format: "html", link: null });
  if (body.text) attempts.push({ ...body, text: htmlToPlain(body.text), format: null, link: null });
  let lastErr: unknown = null;
  for (const attempt of attempts) {
    try {
      const msg = await deps.max.sendMessage({ chatId }, attempt);
      return msg?.body?.mid ?? null;
    } catch (err) {
      lastErr = err;
      if (!(err instanceof MaxApiError) || (err.status !== 400 && err.status !== 404)) break;
      log("warn", "send_retry_plain", { code: err.code, error: err.description });
    }
  }
  log("error", "send_failed", { error: errorText(lastErr) });
  return null;
}

export async function sendText(deps: Deps, chatId: number, html: string, keyboard?: KeyboardAttachment, replyTo?: string): Promise<string | null> {
  return sendHtml(deps, chatId, {
    text: html,
    attachments: keyboard ? [keyboard] : undefined,
    link: replyTo ? { type: "reply", mid: replyTo } : undefined,
  });
}

/** Ответ модели (markdown + возможный LaTeX) → одно или несколько сообщений; кнопки и подпись — у последнего. */
export async function sendAnswer(
  deps: Deps,
  chatId: number,
  markdown: string,
  opts: { replyTo?: string; keyboard?: KeyboardAttachment; footer?: string },
): Promise<string[]> {
  const footer = opts.footer ? `\n\n<i>${escapeHtml(opts.footer)}</i>` : "";
  const chunks = splitToHtmlMessages(convertMath(markdown), LIMIT - footer.length);
  if (!chunks.length) chunks.push("…");
  const mids: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    const mid = await sendHtml(deps, chatId, {
      text: chunks[i]! + (last ? footer : ""),
      attachments: last && opts.keyboard ? [opts.keyboard] : undefined,
      link: i === 0 && opts.replyTo ? { type: "reply", mid: opts.replyTo } : undefined,
    });
    if (mid) mids.push(mid);
  }
  return mids;
}

export async function safeDelete(deps: Deps, mid: string | null | undefined): Promise<void> {
  if (!mid) return;
  await deps.max.deleteMessage(mid).catch((err) => log("warn", "delete_failed", { error: errorText(err) }));
}

export async function safeEdit(deps: Deps, mid: string | null | undefined, html: string, keyboard?: KeyboardAttachment): Promise<boolean> {
  if (!mid) return false;
  try {
    await deps.max.editMessage(mid, { text: html, format: "html", attachments: keyboard ? [keyboard] : [] });
    return true;
  } catch (err) {
    log("warn", "edit_failed", { error: errorText(err) });
    return false;
  }
}

/**
 * Индикатор работы: «печатает…» каждые 4 секунды и, для долгих задач, сообщение-заглушка («🧮 Решаю…»).
 * Заглушку потом удаляем, а ответ приходит новым сообщением — с уведомлением, даже если MAX свёрнут.
 */
export async function startProgress(deps: Deps, chatId: number, placeholder: string | null, replyTo?: string) {
  const typing = () => deps.max.sendAction(chatId, "typing_on").catch(() => {});
  void typing();
  const timer = setInterval(() => void typing(), 4_000);
  const mid = placeholder
    ? await sendHtml(deps, chatId, { text: escapeHtml(placeholder), notify: false, link: replyTo ? { type: "reply", mid: replyTo } : undefined })
    : null;
  let stopped = false;
  return {
    mid,
    stop() {
      if (!stopped) clearInterval(timer);
      stopped = true;
    },
  };
}
