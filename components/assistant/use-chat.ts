"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getConversation } from "@/app/(app)/group/assistant/actions";
import { chatReducer, initChat, retrySource } from "@/lib/assistant/client/chat-state";
import { describeFailure, readChatStream } from "@/lib/assistant/client/stream";
import type { ChatAttachment, ChatMessage, ChatRequest, ConversationInfo, LimitsView } from "@/lib/assistant/types";
import { isOfflineError } from "@/lib/hw/draft";
import { goToLogin } from "./go-to-login";

/** Клиентский предел на весь ответ (docs/AI-CHAT.md §7): сервер укладывается в 60 с, дальше ждать бессмысленно. */
export const STREAM_TIMEOUT_MS = 90_000;
/**
 * Пауза перед перечитыванием беседы после обрыва: сервер сохраняет оборванный ответ, только заметив разрыв,
 * а редьюсер и так не теряет показанный кусок, если сервер не успел (chat-state.ts, reload).
 */
const RELOAD_DELAY_MS = 1200;

export type Outgoing = { text: string; attachments: ChatAttachment[]; strong: boolean };

/** Что показать под лентой: блокировка из §7 (402/403/429) или просто «не ушло». */
export type ChatNotice = { kind: "blocked"; status: 402 | 403 | 429; message: string } | { kind: "error"; message: string };

export type ChatInitial = { conversation: ConversationInfo | null; messages: ChatMessage[] };

type Run = { controller: AbortController; reason: "user" | "timeout" | null };

let seq = 0;
/** Временный id оптимистичного сообщения; префикс не даёт спутать его с серверным uuid. */
const tempId = (kind: string) => `local-${kind}-${Date.now().toString(36)}-${++seq}`;

/**
 * Состояние чата живёт в клиенте, а не в RSC-пропсах: RefreshOnResume и router.refresh перечитывают страницу,
 * и идущий стрим не должен от этого пропасть. Серверную версию принимаем, только когда стрима нет.
 */
export function useChat({ initial, limits, onReturnDraft }: { initial: ChatInitial; limits: LimitsView; onReturnDraft: (d: Outgoing) => void }) {
  const [state, dispatch] = useReducer(chatReducer, { ...initial, limits }, initChat);
  const [notice, setNotice] = useState<ChatNotice | null>(null);

  // Свежие пропсы со страницы (refresh после возврата в приложение) — если сейчас ничего не отправляется.
  // Паттерн «сравнить с прошлым рендером», а не эффект: так новая версия видна в том же кадре.
  const [seen, setSeen] = useState({ initial, limits });
  if (seen.initial !== initial || seen.limits !== limits) {
    setSeen({ initial, limits });
    if (!state.pending) {
      if (seen.initial !== initial) dispatch({ type: "reload", messages: initial.messages, title: initial.conversation?.title });
      if (seen.limits !== limits) dispatch({ type: "limits", limits });
    }
  }

  const stateRef = useRef(state);
  const returnDraft = useRef(onReturnDraft);
  useEffect(() => {
    stateRef.current = state;
    returnDraft.current = onReturnDraft;
  });
  const run = useRef<Run | null>(null);

  const reload = useCallback(async (conversationId: string) => {
    await new Promise((r) => setTimeout(r, RELOAD_DELAY_MS));
    // Человек уже нажал «Повторить»: перечитывание не нужно, а ответ server action ещё и обновляет страницу
    // (proxy.ts ставит cookie на каждый запрос, Next считает это правкой cookie) — у новой беседы это перемонтирование.
    if (run.current || stateRef.current.pending) return;
    const res = await getConversation(conversationId).catch(() => null);
    if (res?.ok && res.data) dispatch({ type: "reload", messages: res.data.messages, title: res.data.conversation.title });
  }, []);

  const send = useCallback(
    async (out: Outgoing) => {
      if (stateRef.current.pending || run.current) return;
      setNotice(null);
      const body: ChatRequest = { conversationId: stateRef.current.conversationId, text: out.text, attachmentIds: out.attachments.map((a) => a.id), strong: out.strong };
      dispatch({ type: "send", ...out, userId: tempId("u"), replyId: tempId("r"), at: new Date().toISOString() });

      const me: Run = { controller: new AbortController(), reason: null };
      run.current = me;
      const timer = window.setTimeout(() => {
        me.reason = "timeout";
        me.controller.abort();
      }, STREAM_TIMEOUT_MS);
      let conversationId = body.conversationId;
      let started = false;
      let finished = false;

      // Сообщение не ушло: убрать его из ленты и вернуть текст с файлами в композер, чтобы отправить ещё раз одним тапом.
      const bounce = (n: ChatNotice | null) => {
        dispatch({ type: "rejected" });
        returnDraft.current(out);
        setNotice(n);
      };

      try {
        const res = await fetch("/api/assistant/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: me.controller.signal,
          cache: "no-store",
        });
        if (!res.ok || !res.body) {
          const json = res.headers.get("content-type")?.includes("application/json") ? await res.json().catch(() => null) : null;
          const failure = describeFailure(res.ok ? 502 : res.status, json);
          if (failure.kind === "auth") {
            goToLogin();
            return;
          }
          if (failure.kind === "blocked" && failure.limits) dispatch({ type: "limits", limits: failure.limits });
          bounce(failure.kind === "blocked" ? { kind: "blocked", status: failure.status, message: failure.message } : { kind: "error", message: failure.message });
          return;
        }
        await readChatStream(res.body, (event) => {
          if (event.t === "start") {
            started = true;
            conversationId = event.conversationId;
            // Адрес новой беседы — без перехода роутера: переход перемонтировал бы экран и оборвал стрим.
            if (body.conversationId === null) window.history.replaceState(null, "", `/group/assistant/${event.conversationId}`);
          }
          if (event.t === "done" || event.t === "error") finished = true;
          dispatch({ type: "event", event });
        });
        if (!finished) throw new Error("stream ended without done");
      } catch (e) {
        if (finished) return;
        if (!started) {
          const offline = isOfflineError(e, navigator.onLine) && me.reason === null;
          bounce(me.reason === "user" ? null : { kind: "error", message: offline ? "Нет сети — сообщение не ушло, текст вернулся в поле" : "Сервер не ответил — попробуй ещё раз" });
          return;
        }
        dispatch({ type: "interrupted", note: me.reason === "user" ? "Остановлено" : "Ответ прервался — повтори" });
        if (me.reason !== "user" && conversationId) void reload(conversationId);
      } finally {
        window.clearTimeout(timer);
        if (run.current === me) run.current = null;
      }
    },
    [reload],
  );

  const stop = useCallback(() => {
    const r = run.current;
    if (!r) return;
    r.reason = "user";
    r.controller.abort();
  }, []);

  /** «Повторить» под неудачным ответом: тот же вопрос новым сообщением. Сильный режим — только если он ещё доступен. */
  const retry = useCallback(
    (replyKey: string, strongAllowed: boolean) => {
      const src = retrySource(stateRef.current.messages, replyKey);
      if (src) void send({ text: src.text, attachments: [], strong: src.strong && strongAllowed });
    },
    [send],
  );

  return { state, notice, setNotice, send, stop, retry };
}
