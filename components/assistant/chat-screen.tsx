"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, Sparkles, X, Zap } from "lucide-react";
import { isAccessActive } from "@/lib/assistant/access";
import { replyStage, retrySource } from "@/lib/assistant/client/chat-state";
import { blockReason, limitCopy } from "@/lib/assistant/client/limits";
import type { AssistantState } from "@/lib/assistant/types";
import { cn } from "@/lib/utils";
import { COMPOSER_INPUT_ID, Composer } from "./composer";
import { FixedBottom } from "./fixed-bottom";
import { MessageItem } from "./message-item";
import { MAX_FILES, type Uploaded } from "./upload";
import { useChat, type ChatInitial, type ChatNotice, type Outgoing } from "./use-chat";

/** Подсказки пустого чата: первые две — готовые вопросы, остальные — начало фразы, которое человек допишет. */
const SUGGESTIONS = ["Какие пары завтра?", "Что задали на эту неделю?", "Объясни простыми словами: ", "Проверь моё решение: "];

/**
 * Черновик — на пользователя: на общем телефоне или ноутбуке друга следующий вошедший не должен увидеть в поле
 * чужой недописанный вопрос (и отправить его от своего имени). Чужие черновики стираются при открытии чата.
 */
const DRAFT_PREFIX = "raspison:assistant-draft:";
const draftKey = (userId: string, conversationId: string | null) => `${DRAFT_PREFIX}${userId}:${conversationId ?? "new"}`;

const dropForeignDrafts = (userId: string) => {
  try {
    const mine = `${DRAFT_PREFIX}${userId}:`;
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(DRAFT_PREFIX) && !k.startsWith(mine)) stale.push(k);
    }
    for (const k of stale) localStorage.removeItem(k);
  } catch {
    // нет storage — нет и чужих черновиков
  }
};

const writeDraft = (key: string, text: string) => {
  try {
    if (text.trim()) localStorage.setItem(key, text);
    else localStorage.removeItem(key);
  } catch {
    // приватный режим / нет storage — черновик живёт только до перезагрузки
  }
};

/**
 * Отступ снизу, который лэйаут (app) даёт всем экранам под таб-бар (`pb-safe` в app/globals.css). На экране чата
 * таб-бара нет, а место под композер лента резервирует сама — гасим чужой отступ отрицательным полем, иначе между
 * последним сообщением и полем ввода висела бы пустая полоса. Формула повторяет @utility pb-safe.
 */
const CANCEL_LAYOUT_PAD = "calc(-1 * (var(--sab) + var(--tabbar-h) + 1rem))";

function Notice({ notice, onClose }: { notice: ChatNotice; onClose: () => void }) {
  if (notice.kind === "error") {
    return (
      <div role="alert" className="flex items-start gap-2.5 rounded-lg bg-surface py-1 pl-4 pr-1 text-[14px] hairline">
        <AlertCircle className="mt-2.5 size-4 shrink-0 text-danger" />
        <div className="flex-1 py-2">
          <p className="leading-snug">{notice.message}</p>
          {notice.toList && (
            <Link href="/group/assistant" className="-ml-2 mt-1 inline-flex h-10 items-center rounded-full px-2 text-[14px] font-semibold text-muted active:bg-surface-2">
              К списку бесед
            </Link>
          )}
        </div>
        <button type="button" aria-label="Скрыть" onClick={onClose} className="grid size-10 shrink-0 place-items-center rounded-full text-dim active:bg-surface-2">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  const copy =
    notice.status === 402
      ? { title: "Доступ закончился", message: notice.message }
      : notice.status === 403
        ? { title: "Помощник выключен", message: notice.message }
        : limitCopy(notice.reason, notice.message, notice.limits, notice.strong);
  return (
    <div role="alert" className="rounded-lg bg-surface p-4 hairline">
      <div className="font-display text-[16px] font-bold">{copy.title}</div>
      <p className="mt-1 text-[14px] leading-snug text-muted">{copy.message}</p>
      <Link href="/group/assistant" className="mt-3 inline-flex h-10 items-center rounded-full bg-surface-2 px-4 text-[14px] font-semibold active:bg-surface-3">
        В раздел «Помощник»
      </Link>
    </div>
  );
}

function Intro({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="px-2 pt-8 text-center">
      <Sparkles className="mx-auto size-7 text-muted" />
      <h2 className="mt-3 font-display text-[20px] font-bold">Спроси про учёбу</h2>
      <p className="mx-auto mt-2 max-w-xs text-[14px] leading-relaxed text-muted">Объясню тему, разберу задачу по фото, подскажу по расписанию и домашке группы.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => onPick(s)} className="min-h-10 rounded-full bg-surface px-4 text-[14px] hairline active:bg-surface-2">
            {s.replace(/:\s*$/, "…")}
          </button>
        ))}
      </div>
      <p className="mx-auto mt-6 max-w-xs text-[12px] leading-snug text-dim">
        Текст и файлы обрабатывает зарубежный провайдер ИИ — не отправляй паспортные данные и чужие персональные данные.
      </p>
    </div>
  );
}

/**
 * Экран беседы с помощником (docs/AI-CHAT.md §8). Лента — в обычном потоке документа (родной скролл iOS, тап
 * по статус-бару), шапка липкая, композер fixed внизу и поднимается над клавиатурой через visualViewport.
 */
export function ChatScreen({ initial, assistant, userId }: { initial: ChatInitial; assistant: AssistantState; userId: string }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<Uploaded[]>([]);
  const [strongPick, setStrongPick] = useState(false);
  const [bottomH, setBottomH] = useState(72);
  // Текст поля синхронно, без ожидания рендера: возврат черновика приходит из асинхронной отправки и должен знать,
  // начал ли человек печатать заново. Меняется только в обработчиках и эффектах, не в рендере.
  const textRef = useRef("");
  const keyRef = useRef(draftKey(userId, initial.conversation?.id ?? null));

  // Не принятое сервером сообщение возвращается в поле (и в сохранённый черновик) — но не поверх того, что человек
  // уже начал печатать заново.
  const returnDraft = useCallback((d: Outgoing) => {
    if (!textRef.current.trim()) {
      textRef.current = d.text;
      setText(d.text);
      writeDraft(keyRef.current, d.text);
    }
    setFiles((prev) => {
      const known = new Set(prev.map((f) => f.id));
      const back = d.attachments.filter((a) => !known.has(a.id)).map((a) => ({ ...a, size: 0 }));
      return [...prev, ...back].slice(0, MAX_FILES);
    });
  }, []);

  const chat = useChat({ initial, limits: assistant.limits, onReturnDraft: returnDraft });
  const { state } = chat;
  const streaming = state.pending !== null;

  const active = isAccessActive(assistant.access);
  const locked = !active || (chat.notice?.kind === "blocked" && chat.notice.status !== 429);
  const strongLeft = Math.max(0, state.limits.strong.limit - state.limits.strong.used);
  // Тумблер обещает ровно то, что пропустит сервер (blockReason повторяет canSend): сильное сообщение тратит и обычный
  // лимит, и запас ресурса на него больше. После 402/403 доступ фактически закрыт, хотя пропсы страницы ещё говорят
  // «trial», — тоже гаснет.
  const strongAllowed = !locked && blockReason(state.limits, true) === null;
  const strong = strongPick && strongAllowed;

  const key = draftKey(userId, state.conversationId);
  useEffect(() => {
    keyRef.current = key;
  }, [key]);
  const onText = (t: string) => {
    textRef.current = t;
    setText(t);
    writeDraft(key, t);
  };

  // Черновик из прошлого захода (iOS выгружает PWA из памяти в фоне). Только после монтирования — иначе mismatch гидратации.
  const firstKey = useRef(key);
  useEffect(() => {
    dropForeignDrafts(userId);
    try {
      const saved = localStorage.getItem(firstKey.current);
      if (saved && !textRef.current) {
        textRef.current = saved;
        setText(saved);
      }
    } catch {
      // нет storage — нет и черновика
    }
    // Чанк markdown подгружаем заранее: первый ответ в новой беседе не должен мигать заглушкой.
    void import("./markdown");
  }, [userId]);

  // Лента «прилипает» к низу, пока человек сам не пролистал вверх — тогда новые куски ответа его не дёргают.
  const pinned = useRef(true);
  useEffect(() => {
    const onScroll = () => {
      const vv = window.visualViewport;
      const visibleBottom = window.scrollY + (vv ? vv.offsetTop + vv.height : window.innerHeight);
      pinned.current = document.documentElement.scrollHeight - visibleBottom < 120;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useLayoutEffect(() => {
    if (pinned.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" as ScrollBehavior });
  }, [state.messages, state.pending, bottomH, chat.notice]);

  const submit = () => {
    const body = text.trim();
    if (streaming || locked || (!body && files.length === 0)) return;
    pinned.current = true;
    const attachments = files.map(({ id, name, mime, url }) => ({ id, name, mime, url }));
    // Сначала очистить поле, потом отправить: если отправка сразу вернёт черновик (нет сети), он ляжет в пустое поле.
    // Сохранённый черновик стираем здесь же; не дошедшее сообщение вернёт его обратно (returnDraft).
    textRef.current = "";
    setText("");
    setFiles([]);
    writeDraft(key, "");
    void chat.send({ text: body, attachments, strong });
  };

  // Стабильная ссылка для memo-пузырей: зависит только от доступности сильного режима, а не от каждого рендера.
  const retryChat = chat.retry;
  const retry = useCallback(
    (replyKey: string) => {
      pinned.current = true;
      retryChat(replyKey, strongAllowed);
    },
    [retryChat, strongAllowed],
  );

  const pick = (s: string) => {
    onText(s);
    document.getElementById(COMPOSER_INPUT_ID)?.focus();
  };

  const lockedText =
    chat.notice?.kind === "blocked" && chat.notice.status === 403
      ? "Помощник выключен админом"
      : assistant.access.kind === "none"
        ? "Сначала включи пробный период в разделе"
        : "Доступ закончился — продли, чтобы продолжить";

  return (
    <div style={{ marginBottom: CANCEL_LAYOUT_PAD }}>
      <header className="sticky top-0 z-20 border-b border-border glass" style={{ paddingTop: "var(--sat)" }}>
        <div className="flex h-14 items-center gap-1 px-2">
          <Link href="/group/assistant" aria-label="Назад к беседам" className="grid size-10 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2">
            <ChevronLeft className="size-6" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-display text-[16px] font-bold">{state.title}</h1>
          <button
            type="button"
            role="switch"
            aria-checked={strong}
            aria-label={`Сильный режим: умнее и медленнее, осталось ${strongLeft} на неделе`}
            disabled={!strongAllowed}
            onClick={() => setStrongPick((v) => !v)}
            className={cn(
              "flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition active:scale-95 disabled:opacity-40",
              strong ? "bg-fg text-bg" : "bg-surface-2 text-muted",
            )}
          >
            <Zap className="size-4" fill={strong ? "currentColor" : "none"} />
            Сильный
            <span className="tnum opacity-70">{strongLeft}</span>
          </button>
        </div>
      </header>

      <div className="space-y-5 px-4 pt-4">
        {state.messages.length === 0 && !locked && !chat.restoring && <Intro onPick={pick} />}
        {state.messages.map((m) => {
          const stage = replyStage(state, m);
          return (
            <MessageItem
              key={m.key}
              m={m}
              stage={stage}
              // Пока ждём ответ с сервера (stage «готовится»), «Повторить» нет: ответ, скорее всего, придёт, а повтор —
              // второй вопрос и вторая квота.
              canRetry={
                !streaming && !locked && stage === null && m.role === "assistant" && (m.status === "error" || m.status === "aborted") && retrySource(state.messages, m.key) !== null
              }
              onRetry={retry}
            />
          );
        })}
        {chat.notice && <Notice notice={chat.notice} onClose={() => chat.setNotice(null)} />}
      </div>
      {/* Место под fixed-панель: последняя строка ленты всегда видна над полем ввода. */}
      <div aria-hidden style={{ height: bottomH + 16 }} />

      <FixedBottom onHeight={setBottomH}>
        {locked ? (
          <div className="flex min-h-10 items-center gap-3 pl-1">
            <span className="flex-1 text-[14px] leading-snug text-muted">{lockedText}</span>
            <Link href="/group/assistant" className="inline-flex h-10 shrink-0 items-center rounded-full bg-surface-2 px-4 text-[14px] font-semibold active:bg-surface-3">
              В раздел
            </Link>
          </div>
        ) : (
          <Composer
            text={text}
            onText={onText}
            files={files}
            setFiles={setFiles}
            streaming={streaming}
            stoppable={state.pending?.started === true}
            onSend={submit}
            onStop={chat.stop}
          />
        )}
      </FixedBottom>
    </div>
  );
}
