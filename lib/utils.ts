import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const USER_COLORS = [
  "#FF9E7A",
  "#FFD666",
  "#7CE7A9",
  "#6EDDF6",
  "#8FA6FF",
  "#C79BFF",
  "#FF8FC8",
  "#5CD6C0",
] as const;

export const pluralRu = (n: number, one: string, few: string, many: string) => {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
};

export const displayName = (u: { fullName: string; nickname: string | null }) => u.nickname?.trim() || u.fullName;

export const firstName = (fullName: string) => fullName.split(/\s+/)[1] ?? fullName.split(/\s+/)[0];

export const initials = (fullName: string) =>
  fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const fail = (error: string): ActionResult<never> => ({ ok: false, error });
export const ok = <T>(data?: T): ActionResult<T> => ({ ok: true, data });

const INVITE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/** Суффикс инвайт-кода: 8 символов без похожих букв (0/O, 1/I/L) — ~39 бит, формат XXXX-XXXX. */
export const generateInviteSuffix = () => {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => INVITE_ALPHABET[b % INVITE_ALPHABET.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Строка из URL/формы → uuid или null (в Postgres невалидный uuid даёт 500 вместо 404). */
export const asUuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v : null);
