"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { authAttempts, groups, users } from "@/lib/db/schema";
import { clearInviteCookie, createSession, hashPin, readInviteGroupId, setInviteCookie, verifyPin } from "@/lib/auth";
import { normalizeInviteCode } from "@/lib/invite";

export type FormState = { error?: string } | undefined;

const pinSchema = z.string().regex(/^\d{4}$/, "PIN — ровно 4 цифры");
const GENERIC_LOCK = "Слишком много попыток. Подожди немного и попробуй снова";

// Лимиты подбора: по IP (любые профили) и по конкретному профилю. Vercel даёт x-forwarded-for.
// 60 неудач за 10 минут с одного IP: 21 человек за одним NAT вуза в день запуска не должны запирать друг друга,
// а перебор PIN всё равно упирается в блокировку конкретного профиля после 5 неудач.
const IP_LIMIT = { window: 10 * 60_000, max: 60 };
const PIN_LOCK_STEPS_MIN = [1, 5, 30, 24 * 60];

async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

async function tooManyAttempts(key: string, max: number, windowMs: number) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(authAttempts)
    .where(and(eq(authAttempts.key, key), gt(authAttempts.createdAt, new Date(Date.now() - windowMs))));
  return n >= max;
}

const recordAttempt = (key: string) => db.insert(authAttempts).values({ key });

export async function submitInviteCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = normalizeInviteCode(String(formData.get("code") ?? ""));
  if (code.length < 4) return { error: "Введи код из беседы" };
  const ipKey = `invite:${await clientIp()}`;
  if (await tooManyAttempts(ipKey, IP_LIMIT.max, IP_LIMIT.window)) return { error: GENERIC_LOCK };

  // Групп единицы — сравниваем каноны в JS: «М41-О2025» с русской раскладки равен «M41-O2025».
  const candidates = await db.select({ id: groups.id, inviteCode: groups.inviteCode }).from(groups);
  const group = candidates.find((g) => normalizeInviteCode(g.inviteCode) === code);
  if (!group) {
    await recordAttempt(ipKey);
    return { error: "Такого кода нет. Проверь закреп в беседе" };
  }
  await setInviteCookie(group.id);
  redirect("/enter/who");
}

export async function claimProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = await readInviteGroupId();
  if (!groupId) redirect("/enter");
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const pin2 = String(formData.get("pin2") ?? "");
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (pin !== pin2) return { error: "PIN не совпадает" };
  const ipKey = `claim:${await clientIp()}`;
  if (await tooManyAttempts(ipKey, IP_LIMIT.max, IP_LIMIT.window)) return { error: GENERIC_LOCK };
  await recordAttempt(ipKey);

  const user = (await db.select().from(users).where(and(eq(users.id, userId), eq(users.groupId, groupId), eq(users.status, "active"))))[0];
  if (!user) return { error: "Профиль не найден" };
  if (user.pinHash) return { error: "Этот профиль уже занят. Если это ты — введи свой PIN" };

  // Условное обновление: двое, выбравшие один профиль в одну секунду, не перезапишут PIN друг друга.
  const [claimed] = await db
    .update(users)
    .set({ pinHash: hashPin(pin), pinFailedCount: 0, pinLockedUntil: null })
    .where(and(eq(users.id, user.id), isNull(users.pinHash)))
    .returning({ id: users.id });
  if (!claimed) return { error: "Этот профиль только что занял кто-то другой. Если это ты — введи свой PIN" };
  await createSession(user.id);
  await clearInviteCookie();
  redirect("/s");
}

export async function loginWithPin(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = await readInviteGroupId();
  if (!groupId) redirect("/enter");
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");
  if (!pinSchema.safeParse(pin).success) return { error: "PIN — ровно 4 цифры" };
  const ipKey = `pin:${await clientIp()}`;
  if (await tooManyAttempts(ipKey, IP_LIMIT.max, IP_LIMIT.window)) return { error: GENERIC_LOCK };

  const user = (await db.select().from(users).where(and(eq(users.id, userId), eq(users.groupId, groupId), eq(users.status, "active"))))[0];
  if (!user) return { error: "Профиль не найден" };
  if (!user.pinHash) return { error: "У профиля ещё нет PIN — придумай его" };
  if (user.pinLockedUntil && user.pinLockedUntil > new Date()) return { error: GENERIC_LOCK };

  if (!verifyPin(pin, user.pinHash)) {
    await recordAttempt(ipKey);
    // 5 неудач подряд — блокировка, каждая следующая серия длиннее: 1 мин → 5 → 30 → сутки.
    const failed = user.pinFailedCount + 1;
    const series = Math.floor(failed / 5);
    const lock = failed % 5 === 0 ? new Date(Date.now() + PIN_LOCK_STEPS_MIN[Math.min(series - 1, PIN_LOCK_STEPS_MIN.length - 1)] * 60_000) : user.pinLockedUntil;
    await db.update(users).set({ pinFailedCount: failed, pinLockedUntil: lock }).where(eq(users.id, user.id));
    return { error: failed % 5 === 0 ? GENERIC_LOCK : "Неверный PIN. Забыл — напиши админу, он сбросит" };
  }

  await db.update(users).set({ pinFailedCount: 0, pinLockedUntil: null }).where(eq(users.id, user.id));
  await createSession(user.id);
  await clearInviteCookie();
  redirect("/s");
}
