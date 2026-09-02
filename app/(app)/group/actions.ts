"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHmac } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activity, anonQuestions, anonQuota, attachments, contacts, news, pollOptions, pollVotes, polls, reactions, taskChecks, tasks, users } from "@/lib/db/schema";
import { actionUser, hasRole } from "@/lib/auth";
import { assertRate } from "@/lib/rate-limit";
import { todayIso } from "@/lib/tz";
import { env } from "@/lib/env";
import { fail, ok, type ActionResult } from "@/lib/utils";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const wrap = async <T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> => {
  try {
    return await fn();
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Что-то пошло не так");
  }
};

const bump = (...paths: string[]) => {
  revalidatePath("/group", "layout");
  for (const p of paths) revalidatePath(p);
};

const log = (groupId: string, eventType: string, entityType: string, entityId: string | null, actorId: string | null, payload: Record<string, unknown>) =>
  db.insert(activity).values({ groupId, eventType, entityType, entityId, actorId, payload });

// ---------- Реакции ----------

export async function toggleReaction(entityType: "news" | "homework" | "task", entityId: string, emoji: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser();
    if (!["🔥", "👍", "💀", "❤️", "😂", "🎉"].includes(emoji)) return fail("Не та реакция");
    const key = and(eq(reactions.entityType, entityType), eq(reactions.entityId, entityId), eq(reactions.userId, user.id), eq(reactions.emoji, emoji));
    const existing = await db.select({ e: reactions.emoji }).from(reactions).where(key);
    if (existing[0]) await db.delete(reactions).where(key);
    else await db.insert(reactions).values({ entityType, entityId, userId: user.id, emoji });
    bump();
    return ok();
  });
}

// ---------- Новости ----------

const newsSchema = z.object({
  title: z.string().trim().max(120).optional().or(z.literal("")),
  body: z.string().trim().min(1, "Пустая новость").max(6000),
  pinned: z.boolean(),
  attachmentIds: z.array(z.string().uuid()).max(10),
});

export async function createNews(input: z.infer<typeof newsSchema>): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    const parsed = newsSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const d = parsed.data;
    const [row] = await db
      .insert(news)
      .values({ groupId: user.groupId, authorId: user.id, title: d.title || null, body: d.body, pinnedAt: d.pinned ? new Date() : null })
      .returning({ id: news.id });
    if (d.attachmentIds.length) {
      await db
        .update(attachments)
        .set({ entityId: row.id })
        .where(and(inArray(attachments.id, d.attachmentIds), eq(attachments.uploadedBy, user.id), isNull(attachments.entityId), eq(attachments.entityType, "news")));
    }
    await log(user.groupId, "news_added", "news", row.id, user.id, { title: d.title || d.body.slice(0, 80) });
    bump("/group/news");
    return ok({ id: row.id });
  });
}

export async function togglePinNews(id: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    const [n] = await db.select().from(news).where(and(eq(news.id, id), eq(news.groupId, user.groupId)));
    if (!n) return fail("Не найдено");
    await db.update(news).set({ pinnedAt: n.pinnedAt ? null : new Date() }).where(eq(news.id, id));
    bump("/group/news");
    return ok();
  });
}

export async function deleteNews(id: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    const [n] = await db.select().from(news).where(and(eq(news.id, id), eq(news.groupId, user.groupId)));
    if (!n) return fail("Не найдено");
    if (n.authorId !== user.id && !hasRole(user, "admin")) return fail("Удалять может автор или админ");
    await db.update(news).set({ deletedAt: new Date() }).where(eq(news.id, id));
    bump("/group/news");
    return ok();
  });
}

// ---------- Задачи ----------

const taskSchema = z.object({
  title: z.string().trim().min(2, "Название слишком короткое").max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  dueDate: iso.optional().or(z.literal("")),
  trackChecks: z.boolean(),
});

export async function createTask(input: z.infer<typeof taskSchema>): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    const parsed = taskSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    const d = parsed.data;
    const [row] = await db
      .insert(tasks)
      .values({ groupId: user.groupId, createdBy: user.id, title: d.title, description: d.description || null, dueDate: d.dueDate || null, trackChecks: d.trackChecks })
      .returning({ id: tasks.id });
    await log(user.groupId, "task_added", "task", row.id, user.id, { title: d.title, dueDate: d.dueDate || null });
    bump("/group/tasks");
    return ok({ id: row.id });
  });
}

/** Отметки «сдал» ставит только админ — источник правды по деньгам и справкам один. */
export async function toggleTaskCheck(taskId: string, userId: string): Promise<ActionResult> {
  return wrap(async () => {
    const admin = await actionUser("admin");
    const [t] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.groupId, admin.groupId)));
    if (!t) return fail("Задача не найдена");
    const key = and(eq(taskChecks.taskId, taskId), eq(taskChecks.userId, userId));
    const existing = await db.select({ u: taskChecks.userId }).from(taskChecks).where(key);
    if (existing[0]) await db.delete(taskChecks).where(key);
    else await db.insert(taskChecks).values({ taskId, userId, checkedBy: admin.id });
    bump("/group/tasks", `/group/tasks/${taskId}`);
    return ok();
  });
}

export async function setTaskClosed(taskId: string, closed: boolean): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    await db.update(tasks).set({ closedAt: closed ? new Date() : null }).where(and(eq(tasks.id, taskId), eq(tasks.groupId, user.groupId)));
    bump("/group/tasks", `/group/tasks/${taskId}`);
    return ok();
  });
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    await db.update(tasks).set({ deletedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.groupId, user.groupId)));
    bump("/group/tasks");
    return ok();
  });
}

// ---------- Опросы ----------

const pollSchema = z.object({
  question: z.string().trim().min(3, "Сформулируй вопрос").max(300),
  options: z.array(z.string().trim().min(1).max(100)).min(2, "Нужно минимум два варианта").max(10),
  isMulti: z.boolean(),
  isAnonymous: z.boolean(),
  closesAt: z.string().optional().or(z.literal("")),
});

export async function createPoll(input: z.infer<typeof pollSchema>): Promise<ActionResult<{ id: string }>> {
  return wrap(async () => {
    const user = await actionUser();
    const parsed = pollSchema.safeParse(input);
    if (!parsed.success) return fail(parsed.error.issues[0].message);
    await assertRate(user);
    const d = parsed.data;
    const closesAt = d.closesAt ? new Date(d.closesAt) : null;
    if (closesAt && Number.isNaN(closesAt.getTime())) return fail("Дата закрытия некорректна");
    const [row] = await db
      .insert(polls)
      .values({ groupId: user.groupId, createdBy: user.id, question: d.question, isMulti: d.isMulti, isAnonymous: d.isAnonymous, closesAt })
      .returning({ id: polls.id });
    await db.insert(pollOptions).values(d.options.map((text, position) => ({ pollId: row.id, text, position })));
    await log(user.groupId, "poll_created", "poll", row.id, user.id, { question: d.question });
    bump("/group/polls");
    return ok({ id: row.id });
  });
}

export async function vote(pollId: string, optionId: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser();
    const [p] = await db.select().from(polls).where(and(eq(polls.id, pollId), eq(polls.groupId, user.groupId), isNull(polls.deletedAt)));
    if (!p) return fail("Опрос не найден");
    if (p.closedAt || (p.closesAt && p.closesAt < new Date())) return fail("Опрос закрыт");
    const [opt] = await db.select({ id: pollOptions.id }).from(pollOptions).where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, pollId)));
    if (!opt) return fail("Вариант не найден");

    const mine = await db.select({ optionId: pollVotes.optionId }).from(pollVotes).where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, user.id)));
    const already = mine.some((v) => v.optionId === optionId);
    if (already) {
      await db.delete(pollVotes).where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, user.id), eq(pollVotes.optionId, optionId)));
    } else {
      if (!p.isMulti && mine.length) await db.delete(pollVotes).where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, user.id)));
      await db.insert(pollVotes).values({ pollId, optionId, userId: user.id });
    }
    bump("/group/polls");
    return ok();
  });
}

export async function setPollClosed(pollId: string, closed: boolean): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser();
    const [p] = await db.select().from(polls).where(and(eq(polls.id, pollId), eq(polls.groupId, user.groupId)));
    if (!p) return fail("Не найдено");
    if (p.createdBy !== user.id && !hasRole(user, "moderator")) return fail("Закрыть может автор или староста");
    await db.update(polls).set({ closedAt: closed ? new Date() : null }).where(eq(polls.id, pollId));
    bump("/group/polls");
    return ok();
  });
}

export async function deletePoll(pollId: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser();
    const [p] = await db.select().from(polls).where(and(eq(polls.id, pollId), eq(polls.groupId, user.groupId)));
    if (!p) return fail("Не найдено");
    if (p.createdBy !== user.id && !hasRole(user, "admin")) return fail("Удалить может автор или админ");
    await db.update(polls).set({ deletedAt: new Date() }).where(eq(polls.id, pollId));
    bump("/group/polls");
    return ok();
  });
}

// ---------- Контакты ----------

const contactSchema = z.object({
  kind: z.enum(["teacher", "dean", "other"]),
  name: z.string().trim().min(2).max(120),
  roleOrSubject: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().max(120).optional().or(z.literal("")),
  messenger: z.string().trim().max(120).optional().or(z.literal("")),
  note: z.string().trim().max(300).optional().or(z.literal("")),
});

const readContact = (fd: FormData) => ({
  kind: fd.get("kind") ?? "teacher",
  name: fd.get("name"),
  roleOrSubject: fd.get("roleOrSubject") ?? "",
  phone: fd.get("phone") ?? "",
  email: fd.get("email") ?? "",
  messenger: fd.get("messenger") ?? "",
  note: fd.get("note") ?? "",
});

const nullable = (s: string | undefined) => (s ? s : null);

export async function createContact(formData: FormData) {
  const user = await actionUser("moderator");
  const parsed = contactSchema.safeParse(readContact(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const d = parsed.data;
  await db.insert(contacts).values({
    groupId: user.groupId,
    kind: d.kind,
    name: d.name,
    roleOrSubject: nullable(d.roleOrSubject),
    phone: nullable(d.phone),
    email: nullable(d.email),
    messenger: nullable(d.messenger),
    note: nullable(d.note),
  });
  bump("/group/contacts");
  redirect("/group/contacts");
}

export async function updateContact(id: string, formData: FormData) {
  const user = await actionUser("moderator");
  const parsed = contactSchema.safeParse(readContact(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const d = parsed.data;
  await db
    .update(contacts)
    .set({ kind: d.kind, name: d.name, roleOrSubject: nullable(d.roleOrSubject), phone: nullable(d.phone), email: nullable(d.email), messenger: nullable(d.messenger), note: nullable(d.note) })
    .where(and(eq(contacts.id, id), eq(contacts.groupId, user.groupId)));
  bump("/group/contacts");
  redirect("/group/contacts");
}

export async function deleteContact(id: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    await db.delete(contacts).where(and(eq(contacts.id, id), eq(contacts.groupId, user.groupId)));
    bump("/group/contacts");
    return ok();
  });
}

// ---------- Анонимные вопросы ----------

const ANON_PER_DAY = 5;

export async function askAnon(body: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser();
    const text = body.trim();
    if (text.length < 5) return fail("Вопрос слишком короткий");
    if (text.length > 1500) return fail("Слишком длинно");

    // Квота считается по HMAC от user_id — связи с текстом вопроса нет, автор не восстановим из строки вопроса.
    const keyHash = createHmac("sha256", env.anonPepper || "no-pepper").update(user.id).digest("hex");
    const day = todayIso();
    const [q] = await db.select().from(anonQuota).where(and(eq(anonQuota.keyHash, keyHash), eq(anonQuota.day, day)));
    if ((q?.count ?? 0) >= ANON_PER_DAY) return fail("На сегодня лимит анонимных вопросов исчерпан");
    if (q) await db.update(anonQuota).set({ count: sql`${anonQuota.count} + 1` }).where(and(eq(anonQuota.keyHash, keyHash), eq(anonQuota.day, day)));
    else await db.insert(anonQuota).values({ keyHash, day, count: 1 });

    const rounded = new Date();
    rounded.setMinutes(0, 0, 0);
    const [row] = await db.insert(anonQuestions).values({ groupId: user.groupId, body: text, createdAt: rounded }).returning({ id: anonQuestions.id });
    await db.insert(activity).values({ groupId: user.groupId, eventType: "anon_question", entityType: "anon_question", entityId: row.id, actorId: null, payload: {}, createdAt: rounded });
    bump("/group/questions");
    return ok();
  });
}

export async function answerAnon(id: string, body: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("moderator");
    const text = body.trim();
    if (!text) return fail("Пустой ответ");
    await db
      .update(anonQuestions)
      .set({ answerBody: text, answeredBy: user.id, answeredAt: new Date() })
      .where(and(eq(anonQuestions.id, id), eq(anonQuestions.groupId, user.groupId)));
    await log(user.groupId, "anon_answered", "anon_question", id, user.id, { text: text.slice(0, 80) });
    bump("/group/questions");
    return ok();
  });
}

export async function deleteAnon(id: string): Promise<ActionResult> {
  return wrap(async () => {
    const user = await actionUser("admin");
    await db.update(anonQuestions).set({ deletedAt: new Date() }).where(and(eq(anonQuestions.id, id), eq(anonQuestions.groupId, user.groupId)));
    bump("/group/questions");
    return ok();
  });
}

// ---------- Лента ----------

export async function markFeedSeen() {
  const user = await actionUser();
  await db.update(users).set({ feedSeenAt: new Date() }).where(eq(users.id, user.id));
  revalidatePath("/group", "layout");
}
