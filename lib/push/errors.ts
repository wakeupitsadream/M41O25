/**
 * Что делать с подпиской после ответа push-сервиса.
 * gone — подписки больше нет (удалили приложение, сбросили разрешение): строку удаляем сразу.
 * temporary — сервис прилёг или троттлит: устройство не виновато, попробуем в следующий раз.
 * broken — что-то не так с самой подпиской или ключами: копим счётчик, чистка в ночном cron.
 */
export type PushVerdict = "gone" | "temporary" | "broken";

/** После скольких подряд «broken» подписку выбрасываем (чистит cron). */
export const MAX_PUSH_FAILURES = 8;

export function classifyPushStatus(statusCode: number | undefined): PushVerdict {
  if (statusCode === 404 || statusCode === 410) return "gone";
  if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) return "temporary";
  return "broken";
}

/** Ошибка web-push несёт statusCode; сетевой сбой (ответа нет вовсе) — это «сервис недоступен», а не мёртвая подписка. */
export function classifyPushError(error: unknown): PushVerdict {
  const status = typeof error === "object" && error !== null && "statusCode" in error ? (error as { statusCode?: unknown }).statusCode : undefined;
  if (typeof status !== "number") return "temporary";
  return classifyPushStatus(status);
}

export const shortError = (error: unknown, max = 200): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/g, " ").trim().slice(0, max);
