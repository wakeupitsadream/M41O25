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
