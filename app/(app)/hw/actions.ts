"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activity, attachments, comments, homework, hwDone, hwEdits } from "@/lib/db/schema";
import { actionUser, hasRole } from "@/lib/auth";
import { assertRate } from "@/lib/rate-limit";
import { fail, ok, type ActionResult } from "@/lib/utils";
import { wrapAction } from "@/lib/actions";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");

const createSchema = z.object({
  body: z.string().trim().min(1, "Напиши, что задали").max(4000),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  subjectId: z.string().uuid().nullable(),
  dueDate: iso,
  attachmentIds: z.array(z.string().uuid()).max(10),
});

export type CreateHomeworkInput = z.infer<typeof createSchema>;

const bump = (id?: string) => {
  revalidatePath("/hw");
  if (id) revalidatePath(`/hw/${id}`);
  revalidatePath("/group/feed");
};

export async function createHomework(input: CreateHomeworkInput): Promise<ActionResult<{ id: string }>> {
  return wrapAction(async () => {
    const user = await actionUser();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    await assertRate(user);
    const d = parsed.data;

    const row = await db.transaction(async (tx) => {
      const [h] = await tx
        .insert(homework)
        .values({
          groupId: user.groupId,
          subjectId: d.subjectId,
          title: d.title || null,
          body: d.body,
          dueDate: d.dueDate,
          createdBy: user.id,
        })
        .returning({ id: homework.id });
      if (d.attachmentIds.length) {
        await tx
          .update(attachments)
          .set({ entityId: h.id })
          .where(and(inArray(attachments.id, d.attachmentIds), eq(attachments.uploadedBy, user.id), isNull(attachments.entityId), eq(attachments.entityType, "homework")));
      }
      await tx.insert(activity).values({
        groupId: user.groupId,
        eventType: "hw_added",
        entityType: "homework",
        entityId: h.id,
        actorId: user.id,
        payload: { title: d.title || d.body.slice(0, 80), dueDate: d.dueDate, subjectId: d.subjectId },
      });
      return h;
    });
    bump(row.id);
    return ok({ id: row.id });
  });
}

const updateSchema = createSchema.omit({ attachmentIds: true });

export async function updateHomework(id: string, input: z.infer<typeof updateSchema>): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const [hw] = await db.select().from(homework).where(and(eq(homework.id, id), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (hw.createdBy !== user.id && !hasRole(user, "admin")) return fail("Менять оригинал может автор или админ. Чужое — дополни блоком.");
    const d = parsed.data;
    await db
      .update(homework)
      .set({ title: d.title || null, body: d.body, dueDate: d.dueDate, subjectId: d.subjectId, updatedAt: new Date() })
      .where(eq(homework.id, id));
    bump(id);
    return ok();
  });
}

export async function deleteHomework(id: string): Promise<ActionResult> {
  const res = await wrapAction(async () => {
    const user = await actionUser();
    const [hw] = await db.select().from(homework).where(and(eq(homework.id, id), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (hw.createdBy !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор или админ");
    await db.transaction(async (tx) => {
      await tx.update(homework).set({ deletedAt: new Date() }).where(eq(homework.id, id));
      // Дубли удалённого оригинала снова становятся самостоятельными записями.
      await tx.update(homework).set({ duplicateOfId: null, duplicateMarkedBy: null }).where(eq(homework.duplicateOfId, id));
      await tx.delete(activity).where(and(eq(activity.entityType, "homework"), eq(activity.entityId, id)));
    });
    revalidatePath("/hw");
    revalidatePath("/group/feed");
    return ok();
  });
  if (!res.ok) return res;
  redirect("/hw");
}

export async function addEdit(homeworkId: string, text: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const t = text.trim();
    if (t.length < 1) return fail("Пустое дополнение");
    if (t.length > 2000) return fail("Слишком длинно");
    await assertRate(user);
    const [hw] = await db.select({ id: homework.id }).from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    const [row] = await db.insert(hwEdits).values({ homeworkId, authorId: user.id, text: t }).returning({ id: hwEdits.id });
    await db.insert(activity).values({ groupId: user.groupId, eventType: "hw_edit_added", entityType: "homework", entityId: homeworkId, actorId: user.id, payload: { editId: row.id, text: t.slice(0, 80) } });
    bump(homeworkId);
    return ok();
  });
}

export async function deleteEdit(editId: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const [row] = await db
      .select({ e: hwEdits })
      .from(hwEdits)
      .innerJoin(homework, eq(homework.id, hwEdits.homeworkId))
      .where(and(eq(hwEdits.id, editId), eq(homework.groupId, user.groupId)));
    const e = row?.e;
    if (!e) return fail("Не найдено");
    if (e.authorId !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор дополнения или админ");
    await db.update(hwEdits).set({ deletedAt: new Date() }).where(eq(hwEdits.id, editId));
    await db.delete(activity).where(and(eq(activity.eventType, "hw_edit_added"), sql`${activity.payload}->>'editId' = ${editId}`));
    bump(e.homeworkId);
    return ok();
  });
}

export async function toggleDone(homeworkId: string): Promise<ActionResult<{ done: boolean }>> {
  return wrapAction(async () => {
    const user = await actionUser();
    const [hw] = await db.select({ id: homework.id }).from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    // Сначала вставка: два быстрых тапа дают «вставил → конфликт → удалил», то есть возвращают исходное состояние.
    const inserted = await db.insert(hwDone).values({ userId: user.id, homeworkId }).onConflictDoNothing().returning({ h: hwDone.homeworkId });
    if (inserted.length) {
      bump(homeworkId);
      return ok<{ done: boolean }>({ done: true });
    }
    await db.delete(hwDone).where(and(eq(hwDone.userId, user.id), eq(hwDone.homeworkId, homeworkId)));
    bump(homeworkId);
    return ok<{ done: boolean }>({ done: false });
  });
}

export async function markDuplicate(homeworkId: string, originalId: string | null): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const [hw] = await db.select().from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (originalId === null) {
      if (hw.duplicateMarkedBy !== user.id && hw.createdBy !== user.id && !hasRole(user, "moderator")) return fail("Снять отметку может тот, кто её поставил, автор записи или староста");
      await db.update(homework).set({ duplicateOfId: null, duplicateMarkedBy: null }).where(eq(homework.id, homeworkId));
    } else {
      await assertRate(user);
      if (originalId === homeworkId) return fail("Запись не может быть дублем самой себя");
      const [orig] = await db
        .select({ id: homework.id, duplicateOfId: homework.duplicateOfId })
        .from(homework)
        .where(and(eq(homework.id, originalId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
      if (!orig) return fail("Оригинал не найден");
      if (orig.duplicateOfId) return fail("Эта запись сама помечена как дубль — выбери оригинал");
      const [hasOwnDups] = await db.select({ id: homework.id }).from(homework).where(and(eq(homework.duplicateOfId, homeworkId), isNull(homework.deletedAt))).limit(1);
      if (hasOwnDups) return fail("У этой записи уже есть дубли — сначала сними их");
      await db.update(homework).set({ duplicateOfId: originalId, duplicateMarkedBy: user.id }).where(eq(homework.id, homeworkId));
    }
    bump(homeworkId);
    if (originalId) revalidatePath(`/hw/${originalId}`);
    return ok();
  });
}

export async function addComment(homeworkId: string, body: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const t = body.trim();
    if (!t) return fail("Пустой комментарий");
    if (t.length > 1000) return fail("Слишком длинно");
    await assertRate(user);
    const [hw] = await db.select({ id: homework.id }).from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    const [row] = await db.insert(comments).values({ groupId: user.groupId, homeworkId, authorId: user.id, body: t }).returning({ id: comments.id });
    await db.insert(activity).values({ groupId: user.groupId, eventType: "comment_added", entityType: "homework", entityId: homeworkId, actorId: user.id, payload: { commentId: row.id, text: t.slice(0, 80) } });
    bump(homeworkId);
    return ok();
  });
}

export async function deleteComment(commentId: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const [c] = await db.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.groupId, user.groupId)));
    if (!c) return fail("Не найдено");
    if (c.authorId !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор или админ");
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
    await db.delete(activity).where(and(eq(activity.eventType, "comment_added"), sql`${activity.payload}->>'commentId' = ${commentId}`));
    bump(c.homeworkId);
    return ok();
  });
}
