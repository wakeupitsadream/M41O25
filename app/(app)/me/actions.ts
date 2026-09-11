"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pushSubscriptions, users } from "@/lib/db/schema";
import { actionUser, destroySession, hashPin, verifyPin } from "@/lib/auth";
import { wrapAction } from "@/lib/actions";
import { DEFAULT_TOPICS, normalizeTopics } from "@/lib/push/topics";
import type { FormState } from "@/lib/form";
import { fail, ok, type ActionResult } from "@/lib/utils";

export async function logout() {
  await destroySession();
  redirect("/enter");
}

/** Личные отметки «сделал»: значение приходит с клиента, чтобы оптимистичный тумблер и база не разъезжались. */
export async function toggleShowHwDone(next: boolean): Promise<ActionResult> {
  const user = await actionUser();
  await db.update(users).set({ showHwDone: next }).where(eq(users.id, user.id));
  revalidatePath("/me");
  revalidatePath("/hw");
  return ok();
}

// ---------- Пуш-уведомления ----------

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(1000),
  p256dh: z.string().min(8).max(300),
  auth: z.string().min(4).max(200),
  topics: z.array(z.string()).max(20).optional(),
});

export type PushSubscriptionInput = z.infer<typeof subscriptionSchema>;

/**
 * Устройство подписалось. Ключ — endpoint: тот же браузер после переустановки приложения даёт новый,
 * а один и тот же endpoint у двух людей не бывает. Темы при повторной подписке не трогаем — они уже настроены.
 */
export async function savePushSubscription(input: PushSubscriptionInput): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) return fail("Подписка не сохранилась: браузер прислал её в неожиданном виде");
    const d = parsed.data;
    const topics = normalizeTopics(d.topics);
    const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: d.endpoint,
        p256dh: d.p256dh,
        auth: d.auth,
        userAgent: ua,
        topics: topics.length ? topics : DEFAULT_TOPICS,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: user.id, p256dh: d.p256dh, auth: d.auth, userAgent: ua, failCount: 0, lastError: null },
      });
    return ok();
  });
}

/** Выключение уведомлений: браузер уже отписался, убираем строку — слать больше некуда. */
export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    if (!endpoint) return fail("Нечего отключать");
    await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, user.id)));
    return ok();
  });
}

/** Галочки «что получать» — общие для всех устройств человека: настроил на телефоне, действует везде. */
export async function setPushTopics(topics: string[]): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    await db.update(pushSubscriptions).set({ topics: normalizeTopics(topics) }).where(eq(pushSubscriptions.userId, user.id));
    return ok();
  });
}

export async function updateProfile(formData: FormData) {
  const user = await actionUser();
  const nickname = String(formData.get("nickname") ?? "").trim().slice(0, 40);
  const avatarEmoji = String(formData.get("avatarEmoji") ?? "").trim().slice(0, 8);
  const birthday = String(formData.get("birthday") ?? "").trim();
  await db
    .update(users)
    .set({
      nickname: nickname || null,
      avatarEmoji: avatarEmoji || user.avatarEmoji,
      birthday: /^\d{4}-\d{2}-\d{2}$/.test(birthday) ? birthday : birthday === "" ? null : user.birthday,
    })
    .where(eq(users.id, user.id));
  revalidatePath("/me");
}

/** Смена PIN: нужен текущий; сессии на других устройствах остаются (PIN нужен только для входа). */
export async function changePin(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await actionUser();
  const current = String(formData.get("current") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const pin2 = String(formData.get("pin2") ?? "");
  if (!/^\d{4}$/.test(pin)) return { error: "Новый PIN — ровно 4 цифры" };
  if (pin !== pin2) return { error: "Новый PIN не совпадает" };
  if (!user.pinHash || !verifyPin(current, user.pinHash)) return { error: "Текущий PIN неверный" };
  if (current === pin) return { error: "Новый PIN совпадает с текущим" };
  await db.update(users).set({ pinHash: hashPin(pin), pinFailedCount: 0, pinLockedUntil: null }).where(eq(users.id, user.id));
  revalidatePath("/me");
  return { success: "PIN изменён" };
}
