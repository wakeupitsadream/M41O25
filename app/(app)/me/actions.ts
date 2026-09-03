"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { actionUser, destroySession, hashPin, verifyPin } from "@/lib/auth";
import type { FormState } from "@/lib/form";

export async function logout() {
  await destroySession();
  redirect("/enter");
}

export async function toggleShowHwDone() {
  const user = await actionUser();
  await db.update(users).set({ showHwDone: !user.showHwDone }).where(eq(users.id, user.id));
  revalidatePath("/me");
  revalidatePath("/hw");
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
