"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { pushSubscriptions, users } from "@/lib/db/schema";
import { actionUser, destroySession, hashPin, registerPinFailure, verifyPin } from "@/lib/auth";
import { stillLockedMessage } from "@/lib/auth-lock";
import { wrapAction, wrapForm } from "@/lib/actions";
import { DEFAULT_TOPICS, normalizeTopics } from "@/lib/push/topics";
import type { FormState } from "@/lib/form";
import { fail, ok, type ActionResult } from "@/lib/utils";
import { isCalendarDate } from "@/lib/validation";

export async function logout() {
  await destroySession();
  redirect("/enter");
}

/** Личные отметки «сделал»: значение приходит с клиента, чтобы оптимистичный тумблер и база не разъезжались. */
export async function toggleShowHwDone(next: boolean): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    await db.update(users).set({ showHwDone: Boolean(next) }).where(eq(users.id, user.id));
    revalidatePath("/me");
    revalidatePath("/hw");
    return ok();
  });
}

// ---------- Пуш-уведомления ----------

const subscriptionSchema = z.object({
  // Только https: endpoint приходит с клиента, и слать зашифрованный payload по произвольному http-адресу незачем.
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith("https://"), "endpoint должен быть https"),
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
    // «Поля нет» и «пустой список» — разные вещи, и схема их различает (topics необязательное).
    // Нет поля — подписка приехала без настроек (старая сборка на телефоне), даём запас по умолчанию.
    // Пустой список — человек сам снял все галочки, и подменять его на «присылать всё» нельзя:
    // в Профиле ему написано «Все темы выключены — ничего не придёт».
    const topics = d.topics === undefined ? DEFAULT_TOPICS : normalizeTopics(d.topics);
    const ua = (await headers()).get("user-agent")?.slice(0, 300) ?? null;
    await db
      .insert(pushSubscriptions)
      .values({
        userId: user.id,
        endpoint: d.endpoint,
        p256dh: d.p256dh,
        auth: d.auth,
        userAgent: ua,
        topics,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // Тот же человек — его темы не трогаем (уже настроены). Endpoint перешёл к другому (общий телефон, вошёл
        // одногруппник) — темы берём новые, иначе он унаследовал бы чужие галочки вроде «только опросы».
        set: {
          userId: user.id,
          p256dh: d.p256dh,
          auth: d.auth,
          userAgent: ua,
          failCount: 0,
          lastError: null,
          topics: sql`case when ${pushSubscriptions.userId} = ${user.id} then ${pushSubscriptions.topics} else ${topics}::text[] end`,
        },
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

/** «О себе»: через ActionForm — ошибка под полями, после сохранения «Сохранено» (как у соседней смены PIN). */
export async function updateProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  return wrapForm(async () => {
    const user = await actionUser();
    const nickname = String(formData.get("nickname") ?? "").trim().slice(0, 40);
    const avatarEmoji = String(formData.get("avatarEmoji") ?? "").trim().slice(0, 8);
    const birthday = String(formData.get("birthday") ?? "").trim();
    // Формат и реальная календарная дата (не 2026-02-30): <input type="date"> это гарантирует, но форма может прийти и без него.
    if (birthday && !isCalendarDate(birthday)) return { error: "Дата рождения не похожа на дату — выбери её в календаре или оставь поле пустым" };
    await db
      .update(users)
      .set({
        nickname: nickname || null,
        // Пустое поле — нейтральная аватарка, а не тихий откат к прежней: так и написано в подсказке формы.
        avatarEmoji: avatarEmoji || "🙂",
        birthday: birthday || null,
      })
      .where(eq(users.id, user.id));
    revalidatePath("/me");
    return { success: "Сохранено" };
  });
}

/**
 * Смена PIN: нужен текущий; сессии на других устройствах остаются (PIN нужен только для входа).
 * Неверный текущий PIN считается той же серией неудач, что и на входе: у того, в чьих руках разблокированный
 * телефон, иначе было бы 10 000 попыток без замка узнать PIN хозяина и отрезать ему вход с новых устройств.
 */
export async function changePin(_prev: FormState, formData: FormData): Promise<FormState> {
  return wrapForm(async () => {
    const user = await actionUser();
    const current = String(formData.get("current") ?? "");
    const pin = String(formData.get("pin") ?? "");
    const pin2 = String(formData.get("pin2") ?? "");
    if (!/^\d{4}$/.test(pin)) return { error: "Новый PIN — ровно 4 цифры" };
    if (pin !== pin2) return { error: "Новый PIN не совпадает" };
    const locked = stillLockedMessage(user.pinLockedUntil);
    if (locked) return { error: locked };
    if (!user.pinHash) return { error: "У профиля нет PIN — выйди и войди заново, чтобы задать его" };
    if (!verifyPin(current, user.pinHash)) return { error: (await registerPinFailure(user.id)).replace("Забыл PIN — напиши админу, он сбросит", "Забыл текущий — напиши админу, он сбросит") };
    if (current === pin) return { error: "Новый PIN совпадает с текущим" };
    await db.update(users).set({ pinHash: hashPin(pin), pinFailedCount: 0, pinLockedUntil: null }).where(eq(users.id, user.id));
    revalidatePath("/me");
    return { success: "PIN изменён" };
  });
}
