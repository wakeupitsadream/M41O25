"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { authAttempts, groups, users } from "@/lib/db/schema";
import { clearInviteCookie, createSession, hashPin, readInviteGroupId, registerPinFailure, setInviteCookie, verifyPin } from "@/lib/auth";
import { stillLockedMessage } from "@/lib/auth-lock";
import { wrapForm } from "@/lib/actions";
import { normalizeInviteCode } from "@/lib/invite";
import { asUuid } from "@/lib/utils";

export type FormState = { error?: string } | undefined;

const pinSchema = z.string().regex(/^\d{4}$/, "PIN — ровно 4 цифры");
const GENERIC_LOCK = "Слишком много попыток. Подожди немного и попробуй снова";

// Лимиты подбора: по IP (любые профили) и по конкретному профилю. Vercel даёт x-forwarded-for.
// 60 неудач за 10 минут с одного IP: 21 человек за одним NAT вуза в день запуска не должны запирать друг друга,
// а перебор PIN всё равно упирается в блокировку конкретного профиля после 5 неудач.
const IP_LIMIT = { window: 10 * 60_000, max: 60 };
async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

/**
 * Попытка записывается ДО подсчёта: пачка параллельных запросов видит и свои строки, и строки соседей.
 * Раньше считали, потом вставляли — и 60 одновременных запросов проходили проверку все разом.
 * Удачный вход лишнюю строку не убирает: это лимит на обращения, а не на неудачи, и cron чистит их через сутки.
 */
async function noteAttempt(key: string, max: number, windowMs: number): Promise<boolean> {
  await db.insert(authAttempts).values({ key });
  const [{ n }] = await db
    .select({ n: count() })
    .from(authAttempts)
    .where(and(eq(authAttempts.key, key), gt(authAttempts.createdAt, new Date(Date.now() - windowMs))));
  return n > max;
}

export async function submitInviteCode(_prev: FormState, formData: FormData): Promise<FormState> {
  return wrapForm(async () => {
    const code = normalizeInviteCode(String(formData.get("code") ?? ""));
    if (code.length < 4) return { error: "Введи код из беседы" };
    const ipKey = `invite:${await clientIp()}`;
    if (await noteAttempt(ipKey, IP_LIMIT.max, IP_LIMIT.window)) return { error: GENERIC_LOCK };

    // Групп единицы — сравниваем каноны в JS: «М41-О2025» с русской раскладки равен «M41-O2025».
    const candidates = await db.select({ id: groups.id, inviteCode: groups.inviteCode }).from(groups);
    const group = candidates.find((g) => normalizeInviteCode(g.inviteCode) === code);
    if (!group) return { error: "Такого кода нет. Проверь закреп в беседе" };
    await setInviteCookie(group.id, group.inviteCode);
    redirect("/enter/who");
  });
}

export async function claimProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  return wrapForm(async () => {
    const groupId = await readInviteGroupId();
    if (!groupId) redirect("/enter");
    const userId = asUuid(formData.get("userId"));
    const pin = String(formData.get("pin") ?? "");
    const pin2 = String(formData.get("pin2") ?? "");
    const parsed = pinSchema.safeParse(pin);
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (pin !== pin2) return { error: "PIN не совпадает" };
    if (!userId) return { error: "Профиль не найден" };
    const ipKey = `claim:${await clientIp()}`;
    if (await noteAttempt(ipKey, IP_LIMIT.max, IP_LIMIT.window)) return { error: GENERIC_LOCK };

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
  });
}

export async function loginWithPin(_prev: FormState, formData: FormData): Promise<FormState> {
  return wrapForm(async () => {
    const groupId = await readInviteGroupId();
    if (!groupId) redirect("/enter");
    const userId = asUuid(formData.get("userId"));
    const pin = String(formData.get("pin") ?? "");
    if (!pinSchema.safeParse(pin).success) return { error: "PIN — ровно 4 цифры" };
    if (!userId) return { error: "Профиль не найден" };
    const ipKey = `pin:${await clientIp()}`;
    if (await noteAttempt(ipKey, IP_LIMIT.max, IP_LIMIT.window)) return { error: GENERIC_LOCK };

    const user = (await db.select().from(users).where(and(eq(users.id, userId), eq(users.groupId, groupId), eq(users.status, "active"))))[0];
    if (!user) return { error: "Профиль не найден" };
    if (!user.pinHash) return { error: "У профиля ещё нет PIN — придумай его" };
    const locked = stillLockedMessage(user.pinLockedUntil);
    if (locked) return { error: locked };

    if (!verifyPin(pin, user.pinHash)) return { error: await registerPinFailure(user.id) };

    await db.update(users).set({ pinFailedCount: 0, pinLockedUntil: null }).where(eq(users.id, user.id));
    await createSession(user.id);
    await clearInviteCookie();
    redirect("/s");
  });
}
