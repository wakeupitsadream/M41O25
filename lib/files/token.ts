import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Подписанные ссылки. Установленное на iPhone приложение открывает внешние ссылки в отдельном браузере,
 * у которого нет нашей cookie — поэтому файлы и ручной бэкап отдаются по короткоживущему токену в URL.
 */
const FILE_TTL_MS = 12 * 3600_000;

const sign = (scope: string, exp: number) =>
  createHmac("sha256", env.authSecret || "dev-only").update(`${scope}:${exp}`).digest("base64url").slice(0, 32);

export function signScoped(scope: string, ttlMs: number): string {
  const exp = Date.now() + ttlMs;
  return `${exp}.${sign(scope, exp)}`;
}

export function verifyScoped(scope: string, token: string | null | undefined): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now() || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(scope, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ссылка на вложение, открываемая и без cookie; токен живёт 12 часов. */
export const fileHref = (id: string) => `/api/files/${id}?t=${signScoped(`file:${id}`, FILE_TTL_MS)}`;
