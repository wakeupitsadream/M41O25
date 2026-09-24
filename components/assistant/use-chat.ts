"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { fetchAssistantState, fetchConversation } from "@/lib/assistant/client/api";
import { chatReducer, findDelivered, initChat, isAnswered, isLocalId, retrySource } from "@/lib/assistant/client/chat-state";
import { blockReason } from "@/lib/assistant/client/limits";
import { describeFailure, readChatStream } from "@/lib/assistant/client/stream";
import type { LimitReason } from "@/lib/assistant/limit-rules";
import type { ChatAttachment, ChatMessage, ChatRequest, ConversationInfo, LimitsView } from "@/lib/assistant/types";
import { goToLogin } from "./go-to-login";

/**
 * Клиентский предел на весь ответ (docs/AI-CHAT.md §7). Роут живёт maxDuration = 120 с, модели сервер даёт 100 с
 * после подготовки: 115 с не обрывают живой медленный ответ раньше сервера и всё же замечают соединение, которое
 * сервер уже бросил.
 */
export const STREAM_TIMEOUT_MS = 115_000;
/**
 * Паузы между перечитываниями беседы, пока ответа в базе нет: ≈ 1, 3, 8 и 20 с от обрыва. Первая короткая —
 * сервер сохраняет оборванный ответ, только заметив разрыв. Дольше 20 с держать человека без «Повторить» хуже,
 * чем изредка получить второй ответ: запоздавший первый всё равно появится при следующем перечитывании страницы.
 */
const AWAIT_PAUSES_MS = [1200, 1800, 5000, 12000];
/** Вопрос старше этого не ждём: функция роута живёт не дольше 120 с (maxDuration), дальше ответа уже не будет. */
const ANSWER_DEADLINE_MS = 130_000;
/** Перед проверкой «дошло ли» после обрыва до start: запрос мог ещё быть в транзакции на сервере. */
const CONFIRM_DELAY_MS = 1500;

const NEW_PATH = "/group/assistant/new";
const CHAT_PATH = /^\/group\/assistant\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

const TEXT = {
  offline: "Нет сети — сообщение не ушло, текст вернулся в поле",
  notDelivered: "Сообщение не дошло до сервера — текст вернулся в поле",
  maybeSent: "Связь оборвалась — сообщение могло отправиться. Текст вернулся в поле: когда появится сеть, проверь беседу, прежде чем отправлять снова",
  maybeSentNew: "Связь оборвалась — сообщение могло отправиться. Текст вернулся в поле: проверь список бесед, прежде чем отправлять снова",
  notLoaded: "Беседа не загрузилась — открой её из списка",
  interrupted: "Ответ прервался — повтори",
  stopped: "Остановлено",
};

export type Outgoing = { text: string; attachments: ChatAttachment[]; strong: boolean };

/**
 * Что показать под лентой: блокировка из §7 (402/403/429) или «не ушло». reason и strong — для карточки 429:
 * «ресурс кончился» и «на сильный не хватает» объясняются по-разному. toList — ссылка на список бесед: там видно,
 * дошло ли сообщение новой беседы, чей id так и не пришёл.
 */
export type ChatNotice =
  | { kind: "blocked"; status: 402 | 403 | 429; message: string; reason: LimitReason | null; strong: boolean; limits: LimitsView | null }
  | { kind: "error"; message: string; toList?: boolean };

export type ChatInitial = { conversation: ConversationInfo | null; messages: ChatMessage[] };

type Run = { controller: AbortController; reason: "user" | "timeout" | null };

let seq = 0;
/** Временный id оптимистичного сообщения; префикс не даёт спутать его с серверным uuid (isLocalId). */
const tempId = (kind: string) => `local-${kind}-${Date.now().toString(36)}-${++seq}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Состояние чата живёт в клиенте, а не в RSC-пропсах: RefreshOnResume и router.refresh перечитывают страницу,
 * и идущий стрим не должен от этого пропасть. Серверную версию принимаем, только когда стрима нет. Сами
 * перечитывания — GET-роутами (lib/assistant/client/api.ts), не server actions: те обновляют страницу.
 */
export function useChat({ initial, limits, onReturnDraft }: { initial: ChatInitial; limits: LimitsView; onReturnDraft: (d: Outgoing) => void }) {
  const [state, dispatch] = useReducer(chatReducer, { ...initial, limits }, initChat);
  const [notice, setNotice] = useState<ChatNotice | null>(null);
  /** Экран открыт как «новый чат», а адрес уже беседы (назад после replaceState) — грузим её. */
  const [restoring, setRestoring] = useState(false);

  // Свежие пропсы со страницы (refresh после возврата в приложение) — если сейчас ничего не отправляется.
  // Паттерн «сравнить с прошлым рендером», а не эффект: так новая версия видна в том же кадре. Пустой «new» поверх
  // экрана, который уже знает свою беседу, не принимаем: это старое дерево роутера, а не пустая беседа.
  const [seen, setSeen] = useState({ initial, limits });
  if (seen.initial !== initial || seen.limits !== limits) {
    setSeen({ initial, limits });
    if (!state.pending) {
      if (seen.initial !== initial && (initial.conversation?.id ?? null) === state.conversationId) {
        dispatch({ type: "reload", messages: initial.messages, conversation: initial.conversation });
      }
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
  /** Номер отправки: ответ GET, начатого до новой отправки, старее экрана — его не применяем. */
  const epoch = useRef(0);
  /** Экран ещё показан: поздний start не должен переписывать адрес чужой страницы, а поздние ответы — её состояние. */
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Перечитать беседу и применить. Вернёт серверную версию, только если она применена (null — нет сети или устарела). */
  const loadConversation = useCallback(async (id: string): Promise<ChatMessage[] | null> => {
    const at = epoch.current;
    const res = await fetchConversation(id);
    if (!res.ok || !mounted.current || at !== epoch.current || run.current) return null;
    dispatch({ type: "reload", messages: res.data.messages, conversation: res.data.conversation });
    return res.data.messages;
  }, []);

  /**
   * Остатки после ответа, который не закончился done: квоту сервер списал ещё до start и вернул её, только если
   * модель не сказала ни слова. Без этого чип «Сильный» показывал бы лишний остаток до следующего done.
   */
  const refreshLimits = useCallback(async () => {
    const at = epoch.current;
    const res = await fetchAssistantState();
    if (res.ok && mounted.current && at === epoch.current && !run.current) dispatch({ type: "limits", limits: res.data.limits });
  }, []);

  // Ждём ответ, которого в базе ещё нет: перечитываем беседу, пока он не появится или не выйдет время.
  const awaitingQ = state.awaiting?.questionId ?? null;
  const awaitingFresh = state.awaiting?.fresh ?? false;
  const cid = state.conversationId;
  useEffect(() => {
    if (!awaitingQ || !cid) return;
    const q = stateRef.current.messages.find((m) => m.id === awaitingQ);
    const age = q ? Date.now() - Date.parse(q.createdAt) : Number.NaN;
    if (!awaitingFresh && !(age < ANSWER_DEADLINE_MS)) {
      // Вопрос давний: функция роута давно завершилась, ответа не будет — сразу «Ответ не пришёл» и «Повторить».
      dispatch({ type: "awaitEnd", questionId: awaitingQ });
      return;
    }
    let cancelled = false;
    void (async () => {
      for (const pause of AWAIT_PAUSES_MS) {
        await sleep(pause);
        if (cancelled) return;
        // Идёт новая отправка — эту попытку пропускаем, серверный снимок заведомо старее экрана.
        if (run.current) continue;
        const server = await loadConversation(cid);
        if (cancelled) return;
        if (server && isAnswered(server, awaitingQ)) {
          // Ответ сохранён с ценой — ресурс за 30 дней изменился.
          void refreshLimits();
          return;
        }
      }
      if (cancelled) return;
      dispatch({ type: "awaitEnd", questionId: awaitingQ });
      void refreshLimits();
    })();
    return () => {
      cancelled = true;
    };
  }, [awaitingQ, awaitingFresh, cid, loadConversation, refreshLimits]);

  // Назад к «новому чату» после replaceState: Next восстанавливает дерево сегмента new (пустой экран), а адрес —
  // уже сохранённой беседы. Показать пустой чат по такому адресу — значит потерять беседу и завести дубль.
  const openedAsNew = useRef(initial.conversation === null);
  useEffect(() => {
    if (!openedAsNew.current) return;
    const m = CHAT_PATH.exec(window.location.pathname);
    if (!m || stateRef.current.conversationId || run.current) return;
    let cancelled = false;
    setRestoring(true);
    void fetchConversation(m[1]).then((res) => {
      if (cancelled) return;
      setRestoring(false);
      if (res.ok) dispatch({ type: "reload", messages: res.data.messages, conversation: res.data.conversation });
      // Беседы нет (архив чужой сессии, удалена руками) — адрес возвращаем к тому, что на экране.
      else if (res.status === 404) window.history.replaceState(null, "", NEW_PATH);
      else setNotice({ kind: "error", message: TEXT.notLoaded, toList: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(
    async (out: Outgoing) => {
      if (stateRef.current.pending || run.current) return;
      setNotice(null);
      // Сети точно нет (navigator.onLine = false надёжен в эту сторону): не отправляем вовсе, сомневаться не в чем.
      if (!navigator.onLine) {
        returnDraft.current(out);
        setNotice({ kind: "error", message: TEXT.offline });
        return;
      }
      const cur = stateRef.current;
      const body: ChatRequest = { conversationId: cur.conversationId, text: out.text, attachmentIds: out.attachments.map((a) => a.id), strong: out.strong };
      // Какие строки беседы экран знал до отправки — по ним после обрыва до start ищем, дошёл ли вопрос.
      const known = new Set(cur.messages.filter((m) => !isLocalId(m.id)).map((m) => m.id));
      epoch.current++;
      dispatch({ type: "send", ...out, userId: tempId("u"), replyId: tempId("r"), at: new Date().toISOString() });

      const me: Run = { controller: new AbortController(), reason: null };
      run.current = me;
      const timer = window.setTimeout(() => {
        me.reason = "timeout";
        me.controller.abort();
      }, STREAM_TIMEOUT_MS);
      let started = false;
      let finished = false;
      let limitsStale = false;

      // Сообщение не ушло: убрать его из ленты и вернуть текст с файлами в композер, чтобы отправить ещё раз одним тапом.
      const bounce = (n: ChatNotice | null) => {
        dispatch({ type: "rejected" });
        returnDraft.current(out);
        setNotice(n);
      };

      /**
       * Обрыв до start: сервер коммитит вопрос и списывает квоту до того, как ответит заголовками, так что
       * «не пришёл start» не значит «не отправилось». Молча вернуть текст в поле — это дубль и вторая квота.
       * У существующей беседы смотрим, что попало в базу; у новой id беседы неизвестен — честно говорим об этом.
       */
      const unconfirmed = async () => {
        limitsStale = true;
        const cid = body.conversationId;
        if (!cid) return bounce({ kind: "error", message: TEXT.maybeSentNew, toList: true });
        await sleep(CONFIRM_DELAY_MS);
        const res = await fetchConversation(cid);
        if (!res.ok) return bounce({ kind: "error", message: TEXT.maybeSent });
        const found = findDelivered(res.data.messages, known, { text: out.text, attachmentIds: body.attachmentIds });
        if (!found) return bounce({ kind: "error", message: TEXT.notDelivered });
        // Дошло: дальше как обрыв после start — вопрос остаётся, ответ ждём с сервера.
        dispatch({ type: "event", event: { t: "start", conversationId: cid, messageId: found.id } });
        dispatch({ type: "interrupted", note: TEXT.interrupted, await: true });
        dispatch({ type: "reload", messages: res.data.messages, conversation: res.data.conversation });
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
          if (failure.kind === "server") return bounce({ kind: "error", message: failure.message });
          if (failure.limits) dispatch({ type: "limits", limits: failure.limits });
          // Причину сервер может не прислать — тогда её видно по остаткам из того же ответа.
          const reason = failure.status === 429 ? (failure.reason ?? (failure.limits ? blockReason(failure.limits, out.strong) : null)) : null;
          return bounce({ kind: "blocked", status: failure.status, message: failure.message, reason, strong: out.strong, limits: failure.limits });
        }
        await readChatStream(res.body, (event) => {
          if (event.t === "start") {
            started = true;
            // Адрес новой беседы — без перехода роутера: переход перемонтировал бы экран и оборвал стрим. Только
            // пока экран показан и адрес всё ещё «новый чат»: человек мог уйти к списку, пока ждал start.
            if (body.conversationId === null && mounted.current && window.location.pathname === NEW_PATH) {
              window.history.replaceState(null, "", `/group/assistant/${event.conversationId}`);
            }
          }
          if (event.t === "done" || event.t === "error") finished = true;
          if (event.t === "error" && !event.limits) limitsStale = true;
          dispatch({ type: "event", event });
        });
        if (!finished) throw new Error("stream ended without done");
      } catch {
        if (finished) return;
        if (!started) return await unconfirmed();
        const stopped = me.reason === "user";
        // «Стоп» — ждать нечего, человек сам оборвал. Сеть или таймаут — на Vercel функция доживает до конца,
        // и ответ может появиться в базе: ждём его, а не показываем сразу «Повторить».
        dispatch({ type: "interrupted", note: stopped ? TEXT.stopped : TEXT.interrupted, await: !stopped });
        limitsStale = true;
      } finally {
        window.clearTimeout(timer);
        if (run.current === me) run.current = null;
        if (limitsStale) void refreshLimits();
      }
    },
    [refreshLimits],
  );

  const stop = useCallback(() => {
    const r = run.current;
    // До start «Стоп» ничего не отменяет: сервер, возможно, уже принял вопрос и ответит до конца, а человек решил бы,
    // что сообщение не ушло, и отправил его снова. Кнопка до start и так неактивна (Composer, stoppable).
    if (!r || !stateRef.current.pending?.started) return;
    r.reason = "user";
    r.controller.abort();
  }, []);

  /** «Повторить» под неудачным ответом: тот же вопрос с теми же файлами новым сообщением. Сильный — только если он ещё доступен. */
  const retry = useCallback(
    (replyKey: string, strongAllowed: boolean) => {
      const src = retrySource(stateRef.current.messages, replyKey);
      if (src) void send({ text: src.text, attachments: src.attachments, strong: src.strong && strongAllowed });
    },
    [send],
  );

  return { state, notice, setNotice, send, stop, retry, restoring };
}
