import type { LlmMessage } from "./types.js";

/** Грубая оценка токенов: кириллица у Llama/Qwen-токенизаторов ~2,5 символа на токен. С запасом. */
export const estimateText = (text: string) => Math.ceil(text.length / 2.5);

export function estimateMessages(system: string, messages: LlmMessage[], imageTokens: number): number {
  let total = estimateText(system) + 8;
  for (const m of messages) {
    total += 6;
    for (const p of m.parts) total += p.type === "text" ? estimateText(p.text) : p.type === "image" ? imageTokens : 4000;
  }
  return total;
}

/**
 * Подрезает историю под бюджет: выбрасывает самые старые реплики, последнюю (текущий вопрос) не трогает.
 * null — даже один текущий вопрос не помещается.
 */
export function fitMessages(system: string, messages: LlmMessage[], budget: number, imageTokens: number): LlmMessage[] | null {
  let start = 0;
  while (start < messages.length - 1 && estimateMessages(system, messages.slice(start), imageTokens) > budget) start++;
  // Диалог для OpenAI-совместимых API лучше начинать с реплики пользователя.
  while (start < messages.length - 1 && messages[start]!.role !== "user") start++;
  const fitted = messages.slice(start);
  return estimateMessages(system, fitted, imageTokens) <= budget ? fitted : null;
}
