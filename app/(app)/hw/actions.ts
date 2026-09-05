"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activity, attachments, comments, homework, hwDone, hwEdits } from "@/lib/db/schema";
import { actionUser, hasRole } from "@/lib/auth";
import { assertRate } from "@/lib/rate-limit";
import { storage } from "@/lib/storage";
import { startOfDayTz, todayIso } from "@/lib/tz";
import { describeHwChanges, hwChangeKinds, type HwChangeKind } from "@/lib/hw/changes";
import { matchLesson, resolveLessonId } from "@/lib/hw/query";
import { fail, ok, type ActionResult } from "@/lib/utils";
import { wrapAction } from "@/lib/actions";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата в формате ГГГГ-ММ-ДД");
const uuidList = (max: number) => z.array(z.string().uuid()).max(max, `Не больше ${max} файлов`);

/** Потолок вложений у одной записи (сумма при создании и добавленных позже). */
const MAX_HW_ATTACHMENTS = 10;
const MAX_EDIT_ATTACHMENTS = 4;

const createSchema = z.object({
  body: z.string().trim().min(1, "Напиши, что задали").max(4000),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  subjectId: z.string().uuid().nullable(),
  dueDate: iso,
  /** Пара, к которой привязана запись; сервер перепроверяет по дате и предмету (см. resolveLessonId). */
  lessonId: z.string().uuid().nullable().optional(),
  attachmentIds: uuidList(MAX_HW_ATTACHMENTS),
});

export type CreateHomeworkInput = z.infer<typeof createSchema>;

const bump = (id?: string) => {
  revalidatePath("/hw");
  if (id) revalidatePath(`/hw/${id}`);
  revalidatePath("/group/feed");
  // ДЗ едет в payload расписания («К этому дню»).
  revalidatePath("/s", "layout");
};

/** Привязать свои ещё ничейные загрузки к сущности (записи или блоку «Дополнить»). Чужие и уже привязанные файлы не трогаются. */
const claimUploads = (tx: Pick<typeof db, "update">, ids: string[], userId: string, entityId: string) =>
  ids.length
    ? tx
        .update(attachments)
        .set({ entityId })
        .where(and(inArray(attachments.id, ids), eq(attachments.uploadedBy, userId), isNull(attachments.entityId), eq(attachments.entityType, "homework")))
    : Promise.resolve();

export async function createHomework(input: CreateHomeworkInput): Promise<ActionResult<{ id: string }>> {
  return wrapAction(async () => {
    const user = await actionUser();
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    await assertRate(user);
    const d = parsed.data;
    const lessonId = await resolveLessonId(user.groupId, d.lessonId ?? null, d.subjectId, d.dueDate);

    const row = await db.transaction(async (tx) => {
      const [h] = await tx
        .insert(homework)
        .values({
          groupId: user.groupId,
          subjectId: d.subjectId,
          lessonId,
          title: d.title || null,
          body: d.body,
          dueDate: d.dueDate,
          createdBy: user.id,
        })
        .returning({ id: homework.id });
      await claimUploads(tx, d.attachmentIds, user.id, h.id);
      await tx.insert(activity).values({
        groupId: user.groupId,
        eventType: "hw_added",
        entityType: "homework",
        entityId: h.id,
        actorId: user.id,
        payload: { title: d.title || d.body.slice(0, 80), dueDate: d.dueDate, subjectId: d.subjectId, lessonId },
      });
      return h;
    });
    bump(row.id);
    return ok({ id: row.id });
  });
}

const updateSchema = createSchema.omit({ attachmentIds: true, lessonId: true });

export async function updateHomework(id: string, input: z.infer<typeof updateSchema>): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const [hw] = await db.select().from(homework).where(and(eq(homework.id, id), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (hw.createdBy !== user.id && !hasRole(user, "admin")) return fail("Менять оригинал может автор или админ. Чужое — дополни блоком.");
    const d = parsed.data;

    const before = { title: hw.title, body: hw.body, dueDate: hw.dueDate, subjectId: hw.subjectId };
    const after = { title: d.title || null, body: d.body, dueDate: d.dueDate, subjectId: d.subjectId };
    const kinds = hwChangeKinds(before, after);
    // Привязка к паре пересчитывается, если сменились предмет или дедлайн (или её ещё не было).
    const lessonId = kinds.includes("subject") || kinds.includes("dueDate") || !hw.lessonId ? await matchLesson(user.groupId, d.subjectId, d.dueDate) : hw.lessonId;

    await db.transaction(async (tx) => {
      await tx.update(homework).set({ ...after, lessonId, updatedAt: new Date() }).where(eq(homework.id, id));
      // Лента: только существенные правки (lib/hw/changes.ts) и не чаще раза в день на запись — сутки в поясе группы.
      // Если запись сегодня уже появлялась в ленте (добавлена или изменена), обновляем то событие, а не плодим новое.
      if (kinds.length === 0) return;
      const [last] = await tx
        .select({ id: activity.id, eventType: activity.eventType, createdAt: activity.createdAt, payload: activity.payload })
        .from(activity)
        .where(and(eq(activity.entityType, "homework"), eq(activity.entityId, id), inArray(activity.eventType, ["hw_added", "hw_updated"])))
        .orderBy(desc(activity.createdAt))
        .limit(1);
      const head = { title: after.title || after.body.slice(0, 80), dueDate: after.dueDate, subjectId: after.subjectId, lessonId };
      if (last && last.createdAt >= startOfDayTz(todayIso())) {
        const prevKinds = last.eventType === "hw_updated" && Array.isArray(last.payload?.kinds) ? (last.payload.kinds as HwChangeKind[]) : [];
        const merged = (["subject", "dueDate", "text"] as HwChangeKind[]).filter((k) => prevKinds.includes(k) || kinds.includes(k));
        const payload = last.eventType === "hw_updated" ? { ...last.payload, ...head, kinds: merged, what: describeHwChanges(merged) } : { ...last.payload, ...head };
        await tx.update(activity).set({ payload }).where(eq(activity.id, last.id));
        return;
      }
      await tx.insert(activity).values({
        groupId: user.groupId,
        eventType: "hw_updated",
        entityType: "homework",
        entityId: id,
        actorId: user.id,
        payload: { ...head, kinds, what: describeHwChanges(kinds) },
      });
    });
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
    bump();
    return ok();
  });
  if (!res.ok) return res;
  redirect("/hw");
}

export async function addEdit(homeworkId: string, text: string, attachmentIds: string[] = []): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const ids = uuidList(MAX_EDIT_ATTACHMENTS).safeParse(attachmentIds);
    if (!ids.success) return fail(ids.error.issues[0].message);
    const t = text.trim();
    if (t.length < 1 && ids.data.length === 0) return fail("Пустое дополнение");
    if (t.length > 2000) return fail("Слишком длинно");
    await assertRate(user);
    const [hw] = await db.select({ id: homework.id }).from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(hwEdits).values({ homeworkId, authorId: user.id, text: t }).returning({ id: hwEdits.id });
      // Файлы блока хранятся с entity_id = id блока (lib/hw/query.ts, editIdsOf).
      await claimUploads(tx, ids.data, user.id, row.id);
      await tx.insert(activity).values({
        groupId: user.groupId,
        eventType: "hw_edit_added",
        entityType: "homework",
        entityId: homeworkId,
        actorId: user.id,
        payload: { editId: row.id, text: t.slice(0, 80) || `+ ${ids.data.length === 1 ? "файл" : "файлы"}` },
      });
    });
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

/** Прикрепить свои загрузки к уже существующей записи. Право: автор записи, староста, админ. */
export async function attachToHomework(homeworkId: string, attachmentIds: string[]): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const ids = uuidList(MAX_HW_ATTACHMENTS).min(1, "Выбери хотя бы один файл").safeParse(attachmentIds);
    if (!ids.success) return fail(ids.error.issues[0].message);
    const [hw] = await db.select({ id: homework.id, createdBy: homework.createdBy }).from(homework).where(and(eq(homework.id, homeworkId), eq(homework.groupId, user.groupId), isNull(homework.deletedAt)));
    if (!hw) return fail("Запись не найдена");
    if (hw.createdBy !== user.id && !hasRole(user, "moderator")) return fail("Файлы к записи добавляет её автор, староста или админ. Своё фото — в блоке ниже.");
    const [{ n }] = await db.select({ n: count() }).from(attachments).where(and(eq(attachments.entityType, "homework"), eq(attachments.entityId, homeworkId)));
    if (n + ids.data.length > MAX_HW_ATTACHMENTS) return fail(`У записи не больше ${MAX_HW_ATTACHMENTS} вложений`);
    await claimUploads(db, ids.data, user.id, homeworkId);
    bump(homeworkId);
    return ok();
  });
}

/** Убрать вложение записи или блока «Дополнить». Право: кто загрузил, автор записи, староста, админ. Файл в хранилище тоже удаляется. */
export async function removeAttachment(attachmentId: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser();
    const [att] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.groupId, user.groupId), eq(attachments.entityType, "homework")));
    if (!att?.entityId) return fail("Файл не найден");
    // entity_id указывает либо на запись, либо на блок «Дополнить» (см. lib/hw/query.ts).
    let owner = (await db.select({ id: homework.id, createdBy: homework.createdBy }).from(homework).where(and(eq(homework.id, att.entityId), eq(homework.groupId, user.groupId))))[0];
    if (!owner) {
      const [viaEdit] = await db
        .select({ id: homework.id, createdBy: homework.createdBy })
        .from(hwEdits)
        .innerJoin(homework, eq(homework.id, hwEdits.homeworkId))
        .where(and(eq(hwEdits.id, att.entityId), eq(homework.groupId, user.groupId)));
      owner = viaEdit;
    }
    if (!owner) return fail("Запись не найдена");
    if (att.uploadedBy !== user.id && owner.createdBy !== user.id && !hasRole(user, "moderator")) return fail("Убрать файл может тот, кто его загрузил, автор записи, староста или админ");
    await db.delete(attachments).where(eq(attachments.id, att.id));
    // Строка в базе уже удалена — на файл в хранилище больше ничего не ссылается; неудача здесь не должна ронять действие.
    await storage.delete(att.fileKey).catch((e) => console.error("[hw] storage.delete failed:", e));
    bump(owner.id);
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
