import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Подписанные ссылки. Установленное на iPhone приложение открывает внешние ссылки в отдельном браузере,
 * у которого нет нашей cookie — поэтому файлы и ручной бэкап отдаются по короткоживущему токену в URL.
 */
const FILE_TTL_MS = 12 * 3600_000;
/**
 * Срок ссылки на файл округляется вверх до границы окна: один и тот же файл в течение шести часов получает один
 * и тот же URL, и браузер наконец пользуется `Cache-Control: immutable` из /api/files. Без этого exp брался из
 * Date.now() на каждом рендере, URL всякий раз был новым, и каждое открытие новостей заново качало все фото.
 */
const FILE_URL_BUCKET_MS = 6 * 3600_000;

// На Vercel пустой секрет — ошибка конфигурации, которую ловит сборка (scripts/build.mjs); подменять его тут нечем.
// Локально без .env.local подписи просто предсказуемы — это разработка, не prod.
const secret = () => env.authSecret || (env.onVercel ? "" : "dev-only");

const sign = (scope: string, exp: number) => createHmac("sha256", secret()).update(`${scope}:${exp}`).digest("base64url").slice(0, 32);

/** Подписанный токен `exp.sig`; с bucketMs срок округляется вверх до границы окна (URL стабилен внутри окна). */
export function signScoped(scope: string, ttlMs: number, opts: { bucketMs?: number } = {}): string {
  const raw = Date.now() + ttlMs;
  const exp = opts.bucketMs ? Math.ceil(raw / opts.bucketMs) * opts.bucketMs : raw;
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

/** Ссылка на вложение, открываемая и без cookie; токен живёт 12–18 часов и не меняется внутри шестичасового окна. */
export const fileHref = (id: string) => `/api/files/${id}?t=${signScoped(`file:${id}`, FILE_TTL_MS, { bucketMs: FILE_URL_BUCKET_MS })}`;
