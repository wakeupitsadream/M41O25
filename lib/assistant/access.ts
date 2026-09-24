import { addDaysIso } from "@/lib/tz";
import type { AccessStatus } from "./types";

/*
 * Арифметика дат — addDaysIso из lib/tz, а не третья копия «прибавить дни к YYYY-MM-DD»: правило проекта
 * «серверный код → lib/tz» (CLAUDE.md, «Время»), а lib/tz не server-only и уже гоняется под node:test
 * (lib/tz.test.ts). Для чистой календарной даты пояс на результат не влияет, так что тесты детерминированы.
 */

export type AccessRow = { trialUntil: string | null; paidUntil: string | null };

/** Дата «до» включительно: в сам день until доступ ещё есть, со следующего дня — уже нет (null — не действует). */
const liveUntil = (until: string | null, today: string): string | null => (until !== null && until >= today ? until : null);

/**
 * Состояние доступа по строке assistant_access (docs/AI-CHAT.md §2). Оплата важнее триала: оплатил во время
 * пробной недели — видит «оплачено до», а не «пробная до». Строка без живых дат — expired, а не none: она
 * появляется только после старта триала или действий админа, и второго триала по ней быть не должно.
 */
export function accessStatus(today: string, row: AccessRow | null): AccessStatus {
  if (!row) return { kind: "none" };
  const paid = liveUntil(row.paidUntil, today);
  if (paid) return { kind: "paid", until: paid };
  const trial = liveUntil(row.trialUntil, today);
  if (trial) return { kind: "trial", until: trial };
  const ends = [row.paidUntil, row.trialUntil].filter((d): d is string => d !== null).sort();
  return { kind: "expired", since: ends.at(-1) ?? null };
}

export const isAccessActive = (status: AccessStatus) => status.kind === "trial" || status.kind === "paid";

/**
 * «+N дней»: от текущей paid_until, если она ещё впереди (продление заранее не съедает оставшиеся дни),
 * иначе от сегодня (просроченному не начисляем задним числом).
 */
export function extendPaidUntil(today: string, current: string | null, days: number): string {
  const base = current !== null && current > today ? current : today;
  return addDaysIso(base, days);
}

/**
 * Последний день триала: сегодняшний день считается первым, поэтому «7 дней» — это сегодня + 6, до вечера
 * седьмого дня. Оплата считается иначе (extendPaidUntil: от 24.09 до 24.10) — это привычный месячный цикл
 * «до того же числа», и так его и объясняют в беседе группы; триал же обещан как «неделя».
 */
export function trialUntil(today: string, days: number): string {
  return addDaysIso(today, Math.max(0, days - 1));
}
