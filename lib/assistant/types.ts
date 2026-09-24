/**
 * Общие типы помощника по учёбе (docs/AI-CHAT.md). Это контракт между слоями: базой (jsonb $type), server actions,
 * стрим-роутом и клиентом — поэтому файл без runtime-импортов, его можно тянуть и в клиентский бандл, и в схему.
 */

/** Настройки, как их видит код: все поля заполнены. Умолчания — DEFAULT_SETTINGS в lib/assistant/settings.ts. */
export type AssistantSettings = {
  enabled: boolean;
  /** Цена месяца в рублях; показывается студенту в «Как оплатить» и записывается в платёж при «+30 дней». */
  priceRub: number;
  dailyLimit: number;
  weeklyLimit: number;
  strongWeeklyLimit: number;
  /** 0 — пробного периода нет, кнопка триала не показывается. */
  trialDays: number;
  /** Реквизиты для перевода (СБП и т.п.) — свободный текст из админки. */
  paymentNote: string;
};

/** Как настройки лежат в groups.assistant_settings: частичный объект ('{}' у групп, заведённых до 0007). */
export type AssistantSettingsStored = Partial<AssistantSettings>;

export type AccessStatus = { kind: "none" } | { kind: "trial"; until: string } | { kind: "paid"; until: string } | { kind: "expired"; since: string | null };

/** Остатки лимитов для экрана раздела: «Сегодня 9 из 15 · Неделя 31 из 50 · Сильных 3 из 4». Даты — YYYY-MM-DD. */
export type LimitsView = {
  day: { used: number; limit: number };
  week: { used: number; limit: number };
  strong: { used: number; limit: number };
  resetsDay: string;
  resetsWeek: string;
};

export type AssistantState = {
  enabled: boolean;
  access: AccessStatus;
  limits: LimitsView;
  settings: { priceRub: number; paymentNote: string; trialDays: number };
  /** Сильный режим можно включить: доступ активен и недельный счётчик сильных не исчерпан. */
  strongAvailable: boolean;
};

export type ChatRole = "user" | "assistant";
export type ChatMessageStatus = "done" | "error" | "aborted";

/** Токены из ответа Polza; cached — подмножество prompt (как prompt_tokens_details.cached_tokens у OpenAI). */
export type AssistantUsage = { prompt: number; completion: number; cached: number };

export type ChatAttachment = { id: string; name: string; mime: string; url: string };

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  attachments: ChatAttachment[];
  strong: boolean;
  status: ChatMessageStatus;
  /** ISO-8601 момент времени (Date.toISOString()). */
  createdAt: string;
};

/** Тело POST /api/assistant/chat. */
export type ChatRequest = { conversationId: string | null; text: string; attachmentIds: string[]; strong: boolean };

/** События NDJSON-стрима, по одному на строку. */
export type ChatEvent =
  | { t: "start"; conversationId: string; messageId: string }
  | { t: "delta"; text: string }
  | { t: "tool"; name: string }
  | { t: "done"; messageId: string; limits: LimitsView; usage: AssistantUsage | null }
  | { t: "error"; message: string };

export const TOOL_NAMES = [
  "get_schedule",
  "get_homework",
  "get_news",
  "get_polls",
  "get_tasks",
  "get_contacts",
  "get_birthdays",
  "get_group_members",
  "get_anon_questions",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Элемент списка бесед на экране раздела (listConversations). */
export type ConversationListItem = { id: string; title: string; updatedAt: string; preview: string };

/** Шапка беседы для экрана чата (getConversation). */
export type ConversationInfo = { id: string; title: string; createdAt: string; updatedAt: string; archivedAt: string | null };
