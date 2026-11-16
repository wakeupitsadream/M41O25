/**
 * Логи — одна JSON-строка на событие: их читают Vercel Runtime Logs. Токены и ключи сюда не попадают никогда:
 * ключ Gemini уходит в заголовке, а не в URL, поэтому и текст сетевой ошибки его не содержит.
 */
type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, data: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ level, event, ...data }, (_k, v: unknown) =>
    v instanceof Error ? { name: v.name, message: v.message } : v,
  );
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
