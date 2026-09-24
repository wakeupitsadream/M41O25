import type { AssistantState, ChatAttachment, ChatMessage, ConversationInfo } from "../types";
import { isAccessStatus, toLimitsView } from "./stream";

/*
 * Перечитывание беседы и состояния помощника — GET-роутами, а не server actions. Ответ server action несёт cookie
 * от proxy.ts (она ставится на каждый запрос), Next считает это правкой cookie и обновляет страницу; у новой беседы
 * после history.replaceState это перемонтирует экран чата, и всё, что было только в клиенте (оборванный кусок
 * ответа, «Повторить»), пропадает. Обычный fetch роутер не трогает. Разбор ответа — чистые функции для node:test.
 */

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number | null };

export type ConversationPayload = { conversation: ConversationInfo; messages: ChatMessage[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function toAttachment(v: unknown): ChatAttachment | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.mime) || !isStr(v.url)) return null;
  return { id: v.id, name: v.name, mime: v.mime, url: v.url };
}

function toMessage(v: unknown): ChatMessage | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.content) || !isStr(v.createdAt)) return null;
  if (v.role !== "user" && v.role !== "assistant") return null;
  if (v.status !== "done" && v.status !== "error" && v.status !== "aborted") return null;
  const attachments = Array.isArray(v.attachments) ? v.attachments.map(toAttachment) : [];
  if (attachments.some((a) => a === null)) return null;
  return { id: v.id, role: v.role, content: v.content, attachments: attachments as ChatAttachment[], strong: v.strong === true, status: v.status, createdAt: v.createdAt };
}

/** Тело GET /api/assistant/conversations/[id] или null, если оно не похоже на беседу (прокси, HTML-страница ошибки). */
export function parseConversation(v: unknown): ConversationPayload | null {
  if (!isObj(v) || !isObj(v.conversation) || !Array.isArray(v.messages)) return null;
  const c = v.conversation;
  if (!isStr(c.id) || !isStr(c.title) || !isStr(c.createdAt) || !isStr(c.updatedAt)) return null;
  const messages = v.messages.map(toMessage);
  if (messages.some((m) => m === null)) return null;
  return {
    conversation: { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, archivedAt: isStr(c.archivedAt) ? c.archivedAt : null },
    messages: messages as ChatMessage[],
  };
}

/** Тело GET /api/assistant/state или null. Экрану чата нужны остатки и доступ; настройки берём, если пришли. */
export function parseAssistantState(v: unknown): AssistantState | null {
  if (!isObj(v) || !isAccessStatus(v.access)) return null;
  const limits = toLimitsView(v.limits);
  if (!limits) return null;
  const s = isObj(v.settings) ? v.settings : {};
  return {
    enabled: v.enabled !== false,
    access: v.access,
    limits,
    settings: {
      priceRub: typeof s.priceRub === "number" ? s.priceRub : 0,
      paymentNote: isStr(s.paymentNote) ? s.paymentNote : "",
      trialDays: typeof s.trialDays === "number" ? s.trialDays : 0,
    },
    strongAvailable: v.strongAvailable === true,
  };
}

/** GET с разбором. status null — сети нет или ответ битый: для вызывающего это одно и то же «не узнали». */
async function getJson<T>(url: string, parse: (v: unknown) => T | null, signal?: AbortSignal): Promise<Loaded<T>> {
  try {
    const res = await fetch(url, { cache: "no-store", signal, headers: { Accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status };
    const data = parse(await res.json());
    return data ? { ok: true, data } : { ok: false, status: null };
  } catch {
    return { ok: false, status: null };
  }
}

export const fetchConversation = (id: string, signal?: AbortSignal) => getJson(`/api/assistant/conversations/${encodeURIComponent(id)}`, parseConversation, signal);

export const fetchAssistantState = (signal?: AbortSignal) => getJson("/api/assistant/state", parseAssistantState, signal);
