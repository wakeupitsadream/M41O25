import "server-only";
import { fileHref } from "@/lib/files/token";
import { reactionsFor } from "@/lib/group/query";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, comments, homework, hwDone, hwEdits, lessons, subjects, users, weeks } from "@/lib/db/schema";
import { todayIso } from "@/lib/tz";
import type { ScheduleHomework } from "@/lib/schedule/types";

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

export type HwAttachment = { id: string; name: string; mime: string; size: number; url: string; uploadedBy: string };

const toAttachment = (f: typeof attachments.$inferSelect): HwAttachment => ({ id: f.id, name: f.fileName, mime: f.mime, size: f.sizeBytes, url: fileHref(f.id), uploadedBy: f.uploadedBy });

/**
 * Вложения к блоку «Дополнить» лежат в той же таблице attachments с entity_type = 'homework', но entity_id = id блока
 * (hw_edits.id): uuid уникален глобально, а расширять enum без миграции нельзя. Поэтому «все файлы записи» —
 * это файлы с entity_id самой записи плюс файлы её неудалённых дополнений.
 */
const editIdsOf = (hwId: string) => db.select({ id: hwEdits.id }).from(hwEdits).where(and(eq(hwEdits.homeworkId, hwId), isNull(hwEdits.deletedAt)));

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
      attachmentsCount: sql<number>`(select count(*) from ${attachments} where ${attachments.entityType} = 'homework' and (${attachments.entityId} = ${homework.id} or ${attachments.entityId} in (select ${hwEdits.id} from ${hwEdits} where ${hwEdits.homeworkId} = ${homework.id} and ${hwEdits.deletedAt} is null)))`.mapWith(Number),
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

  const [edits, commentRows, files, dups, original, lessonRows] = await Promise.all([
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
    db
      .select()
      .from(attachments)
      .where(and(eq(attachments.entityType, "homework"), or(eq(attachments.entityId, id), inArray(attachments.entityId, editIdsOf(id)))))
      .orderBy(asc(attachments.createdAt)),
    db
      .select({ id: homework.id, body: homework.body, title: homework.title })
      .from(homework)
      .where(and(eq(homework.duplicateOfId, id), isNull(homework.deletedAt))),
    row.hw.duplicateOfId
      ? db
          .select({ id: homework.id, body: homework.body, title: homework.title })
          .from(homework)
          .where(and(eq(homework.id, row.hw.duplicateOfId), eq(homework.groupId, groupId), isNull(homework.deletedAt)))
      : Promise.resolve([]),
    row.hw.lessonId
      ? db
          .select({ id: lessons.id, date: lessons.date, startsAt: lessons.startsAt, endsAt: lessons.endsAt, room: lessons.room, title: lessons.title, isCancelled: lessons.isCancelled })
          .from(lessons)
          .where(and(eq(lessons.id, row.hw.lessonId), eq(lessons.groupId, groupId)))
      : Promise.resolve([]),
  ]);

  const reactions = (await reactionsFor("homework", [id], userId)).get(id) ?? [];
  const lesson = lessonRows[0] ?? null;

  return {
    ...row.hw,
    reactions,
    subject: row.subject?.id ? row.subject : null,
    author: row.author,
    done: row.done,
    edits: edits.map((e) => ({ ...e.edit, author: e.author, attachments: files.filter((f) => f.entityId === e.edit.id).map(toAttachment) })),
    comments: commentRows.map((c) => ({ ...c.comment, author: c.author })),
    attachments: files.filter((f) => f.entityId === id).map(toAttachment),
    duplicates: dups,
    original: original[0] ?? null,
    /** Пара, к которой привязана запись (если она ещё есть в расписании). */
    lesson: lesson ? { ...lesson, startsAt: lesson.startsAt.slice(0, 5), endsAt: lesson.endsAt.slice(0, 5) } : null,
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

export type UpcomingLesson = { id: string; date: string; startsAt: string };

/**
 * Подсказки для формы «ДЗ за 20 секунд»: пара, которая идёт сейчас или только что закончилась (±20 минут),
 * и ближайшие следующие пары по каждому предмету — первая из них даёт дедлайн по умолчанию и привязку записи к паре.
 */
export async function quickAddContext(groupId: string, nowIso: string, nowMinutes: number) {
  const today = nowIso;
  // Только опубликованные недели: студент не должен видеть подсказки из черновиков.
  const upcoming = await db
    .select({ id: lessons.id, subjectId: lessons.subjectId, date: lessons.date, startsAt: lessons.startsAt, endsAt: lessons.endsAt, title: lessons.title })
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

  // Следующие пары предмета — строго после текущей (той, по которой задают); первая из них — дедлайн по умолчанию.
  const upcomingBySubject: Record<string, UpcomingLesson[]> = {};
  for (const l of upcoming) {
    if (!l.subjectId) continue;
    const isAfterNow = l.date > today || toMin(l.startsAt) > nowMinutes + 20;
    if (!isAfterNow) continue;
    const list = (upcomingBySubject[l.subjectId] ??= []);
    if (list.length < 12) list.push({ id: l.id, date: l.date, startsAt: l.startsAt.slice(0, 5) });
  }
  return { currentSubjectId: current?.subjectId ?? null, upcomingBySubject };
}

/** Первая по слоту неотменённая пара предмета в этот день из опубликованной недели — к ней привязывается запись ДЗ. */
export async function matchLesson(groupId: string, subjectId: string | null, date: string): Promise<string | null> {
  if (!subjectId) return null;
  const [l] = await db
    .select({ id: lessons.id })
    .from(lessons)
    .innerJoin(weeks, and(eq(weeks.id, lessons.weekId), eq(weeks.status, "published")))
    .where(and(eq(lessons.groupId, groupId), eq(lessons.subjectId, subjectId), eq(lessons.date, date), eq(lessons.isCancelled, false)))
    .orderBy(asc(lessons.slot))
    .limit(1);
  return l?.id ?? null;
}

/**
 * lessonId с клиента принимаем, только если пара есть в группе и совпадает с дедлайном по дате (и по предмету, если
 * он указан у обоих); иначе подбираем сами по предмету и дате. Клиенту доверять нельзя, а расписание могло смениться.
 */
export async function resolveLessonId(groupId: string, lessonId: string | null, subjectId: string | null, dueDate: string): Promise<string | null> {
  if (lessonId) {
    const [l] = await db.select({ id: lessons.id, subjectId: lessons.subjectId, date: lessons.date }).from(lessons).where(and(eq(lessons.id, lessonId), eq(lessons.groupId, groupId)));
    if (l && l.date === dueDate && (!subjectId || !l.subjectId || l.subjectId === subjectId)) return l.id;
  }
  return matchLesson(groupId, subjectId, dueDate);
}

/**
 * ДЗ для экрана расписания («К этому дню», счётчик на паре): актуальные записи с дедлайном в окне, без дублей
 * и удалённых, с коротким текстом — это едет в офлайн-кеш вместе с неделями, поэтому держим компактно.
 */
export async function listHomeworkForSchedule(groupId: string, userId: string | null, from: string, to: string): Promise<ScheduleHomework[]> {
  const rows = await db
    .select({
      id: homework.id,
      dueDate: homework.dueDate,
      lessonId: homework.lessonId,
      subjectId: homework.subjectId,
      subjectShort: subjects.shortName,
      subjectName: subjects.name,
      subjectColor: subjects.color,
      title: homework.title,
      body: homework.body,
      done: userId
        ? sql<boolean>`exists(select 1 from ${hwDone} where ${hwDone.homeworkId} = ${homework.id} and ${hwDone.userId} = ${userId})`.mapWith(Boolean)
        : sql<boolean>`false`.mapWith(Boolean),
    })
    .from(homework)
    .leftJoin(subjects, eq(subjects.id, homework.subjectId))
    .where(and(eq(homework.groupId, groupId), isNull(homework.deletedAt), isNull(homework.duplicateOfId), gte(homework.dueDate, from), lte(homework.dueDate, to)))
    .orderBy(asc(homework.dueDate), asc(homework.createdAt))
    .limit(300);
  return rows.map((r) => ({
    id: r.id,
    dueDate: r.dueDate,
    lessonId: r.lessonId,
    subjectId: r.subjectId,
    subjectShort: r.subjectShort ?? r.subjectName ?? null,
    subjectColor: r.subjectColor ?? null,
    title: r.title,
    text: r.body.replace(/\s+/g, " ").trim().slice(0, 140),
    done: r.done,
  }));
}
