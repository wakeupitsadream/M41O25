import type { ProviderId } from "../config.js";

export type Part =
  | { type: "text"; text: string }
  | { type: "image"; mime: string; data: Buffer }
  | { type: "audio"; mime: string; data: Buffer };

export type LlmMessage = { role: "user" | "assistant"; parts: Part[] };

export type Reasoning = "off" | "low" | "medium" | "high";

/** Как у модели включается размышление. */
export type ThinkingControl =
  | "none" // не размышляет или не управляется
  | "budget" // Gemini 2.5: thinkingBudget
  | "level" // Gemini 3.x: thinkingLevel
  | "effort"; // OpenAI-совместимые reasoning-модели: reasoning_effort

export type ModelInfo = {
  /** provider:id — ключ в цепочках и в model_state. */
  key: string;
  provider: ProviderId;
  id: string;
  /** Подпись под ответом. */
  label: string;
  vision: boolean;
  /** Принимает звук прямо в запросе (inline audio). */
  audio: boolean;
  thinking: ThinkingControl;
  /** Сначала думает, потом пишет: ей можно велеть начинать с ответа. */
  thinks: boolean;
  /** Доля «силы» для подписи и порядка по умолчанию: 1 — лучшая. */
  tier: 1 | 2 | 3;
  timeoutMs: number;
  maxOutputTokens: number;
  maxImages: number;
  maxImageBytes: number;
  imageMimes: readonly string[];
  json: boolean;
  /** Понимает системную роль. Gemma в Gemini API — нет: инструкции идут в начало первого сообщения. */
  systemRole: boolean;
};

export type GenerateRequest = {
  /** Системный промпт может зависеть от модели: «начни с ответа» — только для размышляющих. */
  system: string | ((model: ModelInfo) => string);
  messages: LlmMessage[];
  maxOutputTokens: number;
  temperature?: number;
  reasoning?: Reasoning;
  json?: boolean;
};

export type GenerateResult = {
  text: string;
  model: ModelInfo;
  finishReason: string | null;
  usage: { input: number; output: number } | null;
  ms: number;
};

export const hasImages = (messages: LlmMessage[]) => messages.some((m) => m.parts.some((p) => p.type === "image"));
export const hasAudio = (messages: LlmMessage[]) => messages.some((m) => m.parts.some((p) => p.type === "audio"));
