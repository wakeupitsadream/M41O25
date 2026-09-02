"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { actionUser, destroySession } from "@/lib/auth";

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
