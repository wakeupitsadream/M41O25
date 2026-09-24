"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assistantAccess, assistantPayments, groups, users } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { wrapAction } from "@/lib/actions";
import { env } from "@/lib/env";
import { todayIso } from "@/lib/tz";
import { asUuid, fail, ok, type ActionResult } from "@/lib/utils";
import type { FormState } from "@/lib/form";
import { extendPaidUntil } from "@/lib/assistant/access";
import { parseSettingsForm } from "@/lib/assistant/settings";
import { getSettings } from "@/lib/assistant/store";

/** Админские действия помощника (docs/AI-CHAT.md §7, §9): доступ людям и настройки группы. */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Round-trip, а не Date.parse: «2026-02-30» V8 молча нормализует в 2 марта, а Postgres на такой date упадёт
 * английской ошибкой — админ должен увидеть человеческую. Invalid Date (месяц 13) toISOString бросает — отсекаем раньше.
 */
const isCalendarDate = (iso: string): boolean => {
  if (!ISO_RE.test(iso)) return false;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
};
const MAX_EXTEND_DAYS = 366;
const NO_POLZA_KEY = "Нет ключа Polza — помощник не сможет отвечать";

/** Карточка и список людей, обзор (выручка), и хаб группы с плиткой — у всех подпись по состоянию доступа. */
const revalidateAccess = (userId: string) => {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
  revalidatePath("/group");
  revalidatePath("/group/assistant");
};

/** Человек из своей группы: чужой uuid в форме — «не найден», а не запись доступа в чужую группу. */
async function groupMember(groupId: string, userId: string) {
  const [u] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.groupId, groupId)));
  return u ?? null;
}

/**
 * «+30 дней»: paid_until = max(сегодня, paid_until) + days, и это платёж — из них считается выручка.
 * Сумма — цена месяца пропорционально дням (при 30 днях ровно priceRub), чтобы подарок «+7 дней» не выглядел
 * в отчёте как полная оплата.
 */
export async function extendAccess(userId: string, days = 30): Promise<ActionResult<{ paidUntil: string }>> {
  return wrapAction(async () => {
    const admin = await actionUser("admin");
    const uid = asUuid(userId);
    if (!uid) return fail("Не найден");
    if (!Number.isInteger(days) || days < 1 || days > MAX_EXTEND_DAYS) return fail(`Дней — от 1 до ${MAX_EXTEND_DAYS}`);
    if (!(await groupMember(admin.groupId, uid))) return fail("Не найден");
    const { priceRub } = getSettings(admin.group);
    const today = todayIso();
    const now = new Date();
    const paidUntil = await db.transaction(async (tx) => {
      // Дату считает сама база, одним upsert: `select … for update` ничего не блокирует, пока строки ещё нет, и два
      // одновременных «+30 дней» у нового человека давали бы один срок при двух платежах. Здесь же второй запрос
      // упирается в уникальность user_id, дожидается первого и продлевает уже от его результата.
      const [row] = await tx
        .insert(assistantAccess)
        .values({ userId: uid, paidUntil: extendPaidUntil(today, null, days), updatedAt: now, updatedBy: admin.id })
        .onConflictDoUpdate({
          target: assistantAccess.userId,
          set: {
            paidUntil: sql`(greatest(coalesce(${assistantAccess.paidUntil}, ${today}::date), ${today}::date) + ${days}::int)::date`,
            updatedAt: now,
            updatedBy: admin.id,
          },
        })
        .returning({ paidUntil: assistantAccess.paidUntil });
      await tx.insert(assistantPayments).values({ groupId: admin.groupId, userId: uid, amountRub: Math.round((priceRub * days) / 30), days, createdBy: admin.id });
      return row.paidUntil ?? extendPaidUntil(today, null, days);
    });
    revalidateAccess(uid);
    return ok({ paidUntil });
  });
}

/**
 * Ручная дата «оплачено до» без платежа (перенос, исправление) или «Снять оплату» (null). Снятие строку не создаёт:
 * у того, кто не начинал, состояние none должно остаться none, иначе он лишится пробной недели.
 */
export async function setPaidUntil(userId: string, iso: string | null): Promise<ActionResult> {
  return wrapAction(async () => {
    const admin = await actionUser("admin");
    const uid = asUuid(userId);
    if (!uid) return fail("Не найден");
    if (iso !== null && !isCalendarDate(iso)) return fail("Такой даты нет — проверь день и месяц");
    if (!(await groupMember(admin.groupId, uid))) return fail("Не найден");
    const now = new Date();
    if (iso === null) {
      await db.update(assistantAccess).set({ paidUntil: null, updatedAt: now, updatedBy: admin.id }).where(eq(assistantAccess.userId, uid));
    } else {
      await db
        .insert(assistantAccess)
        .values({ userId: uid, paidUntil: iso, updatedAt: now, updatedBy: admin.id })
        .onConflictDoUpdate({ target: assistantAccess.userId, set: { paidUntil: iso, updatedAt: now, updatedBy: admin.id } });
    }
    revalidateAccess(uid);
    return ok();
  });
}

/**
 * Настройки «Помощник по учёбе» из админской формы (имена полей — в parseSettingsForm). Включить без ключа Polza
 * нельзя: студент увидел бы плитку и кнопку, а ответить помощник не смог бы. В jsonb кладём полный объект — это
 * валидный Partial, а withDefaults при чтении всё равно перепроверит каждое поле.
 */
export async function updateAssistantSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  const admin = await actionUser("admin");
  const parsed = parseSettingsForm(fd);
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.settings.enabled && !env.assistant.configured) return { error: NO_POLZA_KEY };
  await db.update(groups).set({ assistantSettings: parsed.settings }).where(eq(groups.id, admin.groupId));
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  revalidatePath("/group");
  revalidatePath("/group/assistant");
  return { success: "Настройки помощника сохранены" };
}
