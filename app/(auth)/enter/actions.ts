"use server";

import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { groups, users } from "@/lib/db/schema";
import { clearInviteCookie, createSession, hashPin, readInviteGroupId, setInviteCookie, verifyPin } from "@/lib/auth";

export type FormState = { error?: string } | undefined;

const normalizeCode = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

export async function submitInviteCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const code = normalizeCode(String(formData.get("code") ?? ""));
  if (code.length < 4) return { error: "Введи код из беседы" };
  const group = (await db.select({ id: groups.id }).from(groups).where(sql`upper(${groups.inviteCode}) = ${code}`))[0];
  if (!group) return { error: "Такого кода нет. Проверь закреп в беседе" };
  await setInviteCookie(group.id);
  redirect("/enter/who");
}

const pinSchema = z.string().regex(/^\d{4}$/, "PIN — ровно 4 цифры");

export async function claimProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const groupId = await readInviteGroupId();
  if (!groupId) redirect("/enter");
  const userId = String(formData.get("userId") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const pin2 = String(formData.get("pin2") ?? "");
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (pin !== pin2) return { error: "PIN не совпадает" };

  const user = (await db.select().from(users).where(and(eq(users.id, userId), eq(users.groupId, groupId), eq(users.status, "active"))))[0];
  if (!user) return { error: "Профиль не найден" };
  if (user.pinHash) return { error: "Этот профиль уже занят. Если это ты — введи свой PIN" };

  await db.update(users).set({ pinHash: hashPin(pin) }).where(eq(users.id, user.id));
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

  const user = (await db.select().from(users).where(and(eq(users.id, userId), eq(users.groupId, groupId), eq(users.status, "active"))))[0];
  if (!user) return { error: "Профиль не найден" };
  if (!user.pinHash) return { error: "У профиля ещё нет PIN — придумай его" };
  if (!verifyPin(pin, user.pinHash)) return { error: "Неверный PIN. Забыл — напиши админу, он сбросит" };

  await createSession(user.id);
  await clearInviteCookie();
  redirect("/s");
}
