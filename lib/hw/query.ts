import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, comments, homework, hwDone, hwEdits, lessons, subjects, users, weeks } from "@/lib/db/schema";
import { todayIso } from "@/lib/tz";

export type HwListItem = {
  id: string;
  title: string | null;
  body: string;
  dueDate: string;
  createdAt: Date;
  subject: { id: string; name: string; shortName: string | null; color: string | null } | null;
  author: { id: string; fullName: string; nickname: string | null; avatarEmoji: string; color: string };
  duplicateOfId: string | null;
  editsCount: number;
  commentsCount: number;
  attachmentsCount: number;
  done: boolean;
  duplicatesCount: number;
};

export async function listHomework(groupId: string, userId: string, opts: { archive?: boolean; subjectId?: string | null } = {}): Promise<HwListItem[]> {
  const today = todayIso();
  const where = [
    eq(homework.groupId, groupId),
    isNull(homework.deletedAt),
    opts.archive ? lt(homework.dueDate, today) : gte(homework.dueDate, today),
  ];
  if (opts.subjectId) where.push(eq(homework.subjectId, opts.subjectId));

  const rows = await db
    .select({
      hw: homework,
      subject: { id: subjects.id, name: subjects.name, shortName: subjects.shortName, color: subjects.color },
      author: { id: users.id, fullName: users.fullName, nickname: users.nickname, avatarEmoji: users.avatarEmoji, color: users.color },
      editsCount: sql<number>`(select count(*) from ${hwEdits} where ${hwEdits.homeworkId} = ${homework.id} and ${hwEdits.deletedAt} is null)`.mapWith(Number),
      commentsCount: sql<number>`(select count(*) from ${comments} where ${comments.homeworkId} = ${homework.id} and ${comments.deletedAt} is null)`.mapWith(Number),
      attachmentsCount: sql<number>`(select count(*) from ${attachments} where ${attachments.entityType} = 'homework' and ${attachments.entityId} = ${homework.id})`.mapWith(Number),
      duplicatesCount: sql<number>`(select count(*) from ${homework} d where d.duplicate_of_id = ${homework.id} and d.deleted_at is null)`.mapWith(Number),
      done: sql<boolean>`exists(select 1 from ${hwDone} where ${hwDone.homeworkId} = ${homework.id} and ${hwDone.userId} = ${userId})`.mapWith(Boolean),
    })
    .from(homework)
    .leftJoin(subjects, eq(subjects.id, homework.subjectId))
    .innerJoin(users, eq(users.id, homework.createdBy))
    .where(and(...where))
    .orderBy(opts.archive ? desc(homework.dueDate) : asc(homework.dueDate), desc(homework.createdAt))
    .limit(200);

  return rows.map((r) => ({
    id: r.hw.id,
    title: r.hw.title,
    body: r.hw.body,
    dueDate: r.hw.dueDate,
    createdAt: r.hw.createdAt,
    subject: r.subject?.id ? r.subject : null,
    author: r.author,
    duplicateOfId: r.hw.duplicateOfId,
    editsCount: r.editsCount,
    commentsCount: r.commentsCount,
    attachmentsCount: r.attachmentsCount,
    done: r.done,
    duplicatesCount: r.duplicatesCount,
  }));
}

export async function getHomework(groupId: string, id: string, userId: string) {
  const [row] = await db
    .select({
      hw: homework,
      subject: { id: subjects.id, name: subjects.name, shortName: subjects.shortName, color: subjects.color },
      author: { id: users.id, fullName: users.fullName, nickname: users.nickname, avatarEmoji: users.avatarEmoji, color: users.color },
      done: sql<boolean>`exists(select 1 from ${hwDone} where ${hwDone.homeworkId} = ${homework.id} and ${hwDone.userId} = ${userId})`.mapWith(Boolean),
    })
    .from(homework)
    .leftJoin(subjects, eq(subjects.id, homework.subjectId))
    .innerJoin(users, eq(users.id, homework.createdBy))
    .where(and(eq(homework.id, id), eq(homework.groupId, groupId), isNull(homework.deletedAt)));
  if (!row) return null;

  const [edits, commentRows, files, dups, original] = await Promise.all([
    db
      .select({ edit: hwEdits, author: { id: users.id, fullName: users.fullName, nickname: users.nickname, avatarEmoji: users.avatarEmoji, color: users.color } })
      .from(hwEdits)
      .innerJoin(users, eq(users.id, hwEdits.authorId))
      .where(and(eq(hwEdits.homeworkId, id), isNull(hwEdits.deletedAt)))
      .orderBy(asc(hwEdits.createdAt)),
    db
      .select({ comment: comments, author: { id: users.id, fullName: users.fullName, nickname: users.nickname, avatarEmoji: users.avatarEmoji, color: users.color } })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(and(eq(comments.homeworkId, id), isNull(comments.deletedAt)))
      .orderBy(asc(comments.createdAt)),
    db.select().from(attachments).where(and(eq(attachments.entityType, "homework"), eq(attachments.entityId, id))).orderBy(asc(attachments.createdAt)),
    db
      .select({ id: homework.id, body: homework.body, title: homework.title })
      .from(homework)
      .where(and(eq(homework.duplicateOfId, id), isNull(homework.deletedAt))),
    row.hw.duplicateOfId
      ? db.select({ id: homework.id, body: homework.body, title: homework.title }).from(homework).where(eq(homework.id, row.hw.duplicateOfId))
      : Promise.resolve([]),
  ]);

  return {
    ...row.hw,
    subject: row.subject?.id ? row.subject : null,
    author: row.author,
    done: row.done,
    edits: edits.map((e) => ({ ...e.edit, author: e.author })),
    comments: commentRows.map((c) => ({ ...c.comment, author: c.author })),
    attachments: files,
    duplicates: dups,
    original: original[0] ?? null,
  };
}

export type HwDetail = NonNullable<Awaited<ReturnType<typeof getHomework>>>;

/** Кандидаты «это дубль вот этой записи»: актуальные ДЗ того же предмета (или все), кроме самой записи. */
export async function duplicateCandidates(groupId: string, excludeId: string, subjectId: string | null) {
  const today = todayIso();
  const where = [eq(homework.groupId, groupId), isNull(homework.deletedAt), isNull(homework.duplicateOfId), gte(homework.dueDate, today), sql`${homework.id} <> ${excludeId}`];
  if (subjectId) where.push(eq(homework.subjectId, subjectId));
  return db
    .select({ id: homework.id, title: homework.title, body: homework.body, dueDate: homework.dueDate })
    .from(homework)
    .where(and(...where))
    .orderBy(asc(homework.dueDate))
    .limit(20);
}

/**
 * Подсказки для формы «ДЗ за 20 секунд»: пара, которая идёт сейчас или только что закончилась (±20 минут),
 * и ближайшая следующая пара по каждому предмету — дедлайн по умолчанию.
 */
export async function quickAddContext(groupId: string, nowIso: string, nowMinutes: number) {
  const today = nowIso;
  // Только опубликованные недели: студент не должен видеть подсказки из черновиков.
  const upcoming = await db
    .select({ subjectId: lessons.subjectId, date: lessons.date, startsAt: lessons.startsAt, endsAt: lessons.endsAt, title: lessons.title })
    .from(lessons)
    .innerJoin(weeks, and(eq(weeks.id, lessons.weekId), eq(weeks.status, "published")))
    .where(and(eq(lessons.groupId, groupId), gte(lessons.date, today), eq(lessons.isCancelled, false)))
    .orderBy(asc(lessons.date), asc(lessons.slot))
    .limit(400);

  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const todays = upcoming.filter((l) => l.date === today);
  const current =
    todays.find((l) => nowMinutes >= toMin(l.startsAt) - 5 && nowMinutes <= toMin(l.endsAt) + 20) ??
    [...todays].reverse().find((l) => toMin(l.endsAt) <= nowMinutes) ??
    todays[0] ??
    null;

  // Следующая пара предмета — строго после текущей (той, по которой задают), иначе первая будущая.
  const nextBySubject: Record<string, string> = {};
  for (const l of upcoming) {
    if (!l.subjectId) continue;
    const isAfterNow = l.date > today || toMin(l.startsAt) > nowMinutes + 20;
    if (!isAfterNow) continue;
    if (!nextBySubject[l.subjectId]) nextBySubject[l.subjectId] = l.date;
  }
  return { currentSubjectId: current?.subjectId ?? null, nextBySubject };
}
