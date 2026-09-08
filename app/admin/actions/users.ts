"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { deviceSessions, users } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { wrapAction } from "@/lib/actions";
import { MAX_PEOPLE, planPeopleImport } from "@/lib/admin/people";
import { USER_COLORS, fail, ok, type ActionResult } from "@/lib/utils";
import type { FormState } from "@/lib/form";

const userSchema = z.object({
  fullName: z.string().trim().min(2, "Имя слишком короткое").max(80),
  nickname: z.string().trim().max(40).optional().or(z.literal("")),
  avatarEmoji: z.string().trim().max(8).optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  role: z.enum(["admin", "moderator", "student"]),
  birthday: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
});

const read = (fd: FormData) => ({
  fullName: fd.get("fullName"),
  nickname: fd.get("nickname") ?? "",
  avatarEmoji: fd.get("avatarEmoji") ?? "",
  color: fd.get("color") ?? USER_COLORS[0],
  role: fd.get("role") ?? "student",
  birthday: fd.get("birthday") ?? "",
});

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionUser("admin");
  const parsed = userSchema.safeParse(read(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  await db.insert(users).values({
    groupId: admin.groupId,
    fullName: d.fullName,
    nickname: d.nickname || null,
    avatarEmoji: d.avatarEmoji || "🙂",
    color: d.color,
    role: d.role,
    birthday: d.birthday || null,
  });
  revalidatePath("/admin/users");
  redirect("/admin/users");
}

export async function updateUser(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await actionUser("admin");
  const parsed = userSchema.safeParse(read(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  // Нельзя снять роль с самого себя — иначе легко остаться без админа.
  const role = id === admin.id ? "admin" : d.role;
  await db
    .update(users)
    .set({ fullName: d.fullName, nickname: d.nickname || null, avatarEmoji: d.avatarEmoji || "🙂", color: d.color, role, birthday: d.birthday || null })
    .where(and(eq(users.id, id), eq(users.groupId, admin.groupId)));
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}`);
  redirect("/admin/users");
}

export async function resetPin(id: string): Promise<ActionResult> {
  const admin = await actionUser("admin");
  if (id === admin.id) return fail("Себе PIN сбросить нельзя — профиль админа стал бы свободным для захвата");
  await db.update(users).set({ pinHash: null, pinFailedCount: 0, pinLockedUntil: null }).where(and(eq(users.id, id), eq(users.groupId, admin.groupId)));
  await db.update(deviceSessions).set({ revokedAt: new Date() }).where(and(eq(deviceSessions.userId, id), isNull(deviceSessions.revokedAt)));
  revalidatePath(`/admin/users/${id}`);
  return ok();
}

export async function revokeSessions(id: string): Promise<ActionResult> {
  const admin = await actionUser("admin");
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, id), eq(users.groupId, admin.groupId)));
  if (!u) return fail("Не найден");
  await db.update(deviceSessions).set({ revokedAt: new Date() }).where(and(eq(deviceSessions.userId, id), isNull(deviceSessions.revokedAt)));
  revalidatePath(`/admin/users/${id}`);
  return ok();
}

export async function setUserStatus(id: string, status: "active" | "removed"): Promise<ActionResult> {
  const admin = await actionUser("admin");
  if (id === admin.id) return fail("Себя удалить нельзя");
  await db.update(users).set({ status }).where(and(eq(users.id, id), eq(users.groupId, admin.groupId)));
  if (status === "removed") {
    await db.update(deviceSessions).set({ revokedAt: new Date() }).where(and(eq(deviceSessions.userId, id), isNull(deviceSessions.revokedAt)));
  }
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}`);
  return ok();
}

/** Снять блокировку PIN (после серии неверных попыток, в т.ч. чужих): счётчик в ноль, срок блокировки убран, PIN остаётся. */
export async function unlockPin(id: string): Promise<ActionResult> {
  const admin = await actionUser("admin");
  await db.update(users).set({ pinFailedCount: 0, pinLockedUntil: null }).where(and(eq(users.id, id), eq(users.groupId, admin.groupId)));
  revalidatePath(`/admin/users/${id}`);
  return ok();
}

export type ImportPeopleResult = { added: number; skipped: number; archived: number };

/**
 * Список из беседы одним разом: текст разбирается тем же `planPeopleImport`, что и предпросмотр,
 * но по свежему составу группы — пока админ смотрел предпросмотр, кого-то могли завести руками.
 * Уже существующие (по нормализованному ФИО) и повторы внутри списка пропускаются, а не дублируются.
 * `selected` — ключи строк, отмеченных галочкой в предпросмотре: разбор не отличает человека от
 * шапки списка («Список группы»), поэтому заводим только то, что админ действительно видел и оставил.
 */
export async function importPeople(text: string, selected?: string[]): Promise<ActionResult<ImportPeopleResult>> {
  return wrapAction(async () => {
    const admin = await actionUser("admin");
    if (typeof text !== "string" || !text.trim()) return fail("Список пустой");
    if (text.length > 20_000) return fail("Слишком длинный список — раздели на части");
    const existing = await db.select({ id: users.id, fullName: users.fullName, status: users.status }).from(users).where(eq(users.groupId, admin.groupId));
    const plan = planPeopleImport(text, existing);
    const picked = Array.isArray(selected) ? new Set(selected.filter((k) => typeof k === "string")) : null;
    const fresh = plan.people.filter((p) => p.status === "new" && (!picked || picked.has(p.key)));
    if (fresh.length === 0) return fail(picked && plan.counts.add > 0 ? "Никого не отметили галочкой" : "Никого нового в списке нет");
    if (fresh.length > MAX_PEOPLE) return fail(`За раз добавляем не больше ${MAX_PEOPLE} человек`);
    // Цвета продолжают круг от уже заведённых, чтобы новые аватарки не были все одного оттенка.
    await db.transaction(async (tx) => {
      await tx.insert(users).values(
        fresh.map((p, i) => ({
          groupId: admin.groupId,
          fullName: p.fullName,
          avatarEmoji: "🙂",
          color: USER_COLORS[(existing.length + i) % USER_COLORS.length],
          role: "student" as const,
          birthday: p.birthday,
        })),
      );
    });
    revalidatePath("/admin/users");
    return ok({ added: fresh.length, skipped: plan.people.length - fresh.length, archived: plan.counts.archived });
  });
}
