"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activity, attachments, comments, homework, hwDone, hwEdits } from "@/lib/db/schema";
import { actionUser, hasRole } from "@/lib/auth";
import { assertRate } from "@/lib/rate-limit";
import { fail, ok, type ActionResult } from "@/lib/utils";

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

const wrap = async <T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Что-то пошло не так");
  }
};

export async function createHomework(input: CreateHomeworkInput): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const user = await actionUser();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    await assertRate(user);
    const d = parsed.data;

    const [row] = await db
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
      await db
        .update(attachments)
        .set({ entityId: row.id })
        .where(and(inArray(attachments.id, d.attachmentIds), eq(attachments.uploadedBy, user.id), isNull(attachments.entityId), eq(attachments.entityType, "homework")));
    }
    await db.insert(activity).values({
      groupId: user.groupId,
      eventType: "hw_added",
      entityType: "homework",
      entityId: row.id,
      actorId: user.id,
      payload: { title: d.title || d.body.slice(0, 80), dueDate: d.dueDate, subjectId: d.subjectId },
    });
    bump(row.id);
    return ok({ id: row.id });
  });
}

const updateSchema = createSchema.omit({ attachmentIds: true });

export async function updateHomework(id: string, input: z.infer<typeof updateSchema>): Promise<ActionResult> {
  return wrap(async () => {
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
  return wrap(async () => {
    const user = await actionUser();
    const [hw] = await db.select().from(homework).where(and(eq(homework.id, id), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (hw.createdBy !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор или админ");
    await db.update(homework).set({ deletedAt: new Date() }).where(eq(homework.id, id));
    bump(id);
    return ok();
  });
}

export async function addEdit(homeworkId: string, text: string): Promise<ActionResult> {
  return wrap(async () => {
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
  return wrap(async () => {
    const user = await actionUser();
    const [e] = await db.select().from(hwEdits).where(eq(hwEdits.id, editId));
    if (!e) return fail("Не найдено");
    if (e.authorId !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор дополнения или админ");
    await db.update(hwEdits).set({ deletedAt: new Date() }).where(eq(hwEdits.id, editId));
    bump(e.homeworkId);
    return ok();
  });
}

export async function toggleDone(homeworkId: string): Promise<ActionResult<{ done: boolean }>> {
  return wrap(async () => {
    const user = await actionUser();
    const existing = await db.select().from(hwDone).where(and(eq(hwDone.userId, user.id), eq(hwDone.homeworkId, homeworkId)));
    if (existing[0]) {
      await db.delete(hwDone).where(and(eq(hwDone.userId, user.id), eq(hwDone.homeworkId, homeworkId)));
      bump(homeworkId);
      return ok<{ done: boolean }>({ done: false });
    }
    await db.insert(hwDone).values({ userId: user.id, homeworkId });
    bump(homeworkId);
    return ok<{ done: boolean }>({ done: true });
  });
}

export async function markDuplicate(homeworkId: string, originalId: string | null): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser();
    const [hw] = await db.select().from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (originalId === null) {
      if (hw.duplicateMarkedBy !== user.id && !hasRole(user, "admin")) return fail("Снять отметку может тот, кто её поставил, или админ");
      await db.update(homework).set({ duplicateOfId: null, duplicateMarkedBy: null }).where(eq(homework.id, homeworkId));
    } else {
      if (originalId === homeworkId) return fail("Запись не может быть дублем самой себя");
      const [orig] = await db.select({ id: homework.id }).from(homework).where(and(eq(homework.id, originalId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
      if (!orig) return fail("Оригинал не найден");
      await db.update(homework).set({ duplicateOfId: originalId, duplicateMarkedBy: user.id }).where(eq(homework.id, homeworkId));
    }
    bump(homeworkId);
    if (originalId) revalidatePath(`/hw/${originalId}`);
    return ok();
  });
}

export async function addComment(homeworkId: string, body: string): Promise<ActionResult> {
  return wrap(async () => {
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
  return wrap(async () => {
    const user = await actionUser();
    const [c] = await db.select().from(comments).where(and(eq(comments.id, commentId), eq(comments.groupId, user.groupId)));
    if (!c) return fail("Не найдено");
    if (c.authorId !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор или админ");
    await db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
    bump(c.homeworkId);
    return ok();
  });
}
