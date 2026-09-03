import "server-only";
import { fileHref } from "@/lib/files/token";
import { and, asc, count, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activity, anonQuestions, attachments, contacts, news, pollOptions, pollVotes, polls, reactions, taskChecks, tasks, users } from "@/lib/db/schema";

export type Person = { id: string; fullName: string; nickname: string | null; avatarEmoji: string; color: string };
const person = { id: users.id, fullName: users.fullName, nickname: users.nickname, avatarEmoji: users.avatarEmoji, color: users.color };

export const REACTION_EMOJI = ["🔥", "👍", "💀", "❤️"] as const;

export type ReactionSummary = { emoji: string; count: number; mine: boolean }[];

async function reactionsFor(entityType: "news" | "homework" | "task", ids: string[], userId: string) {
  if (ids.length === 0) return new Map<string, ReactionSummary>();
  const rows = await db
    .select({
      entityId: reactions.entityId,
      emoji: reactions.emoji,
      n: count(),
      mine: sql<boolean>`bool_or(${reactions.userId} = ${userId})`.mapWith(Boolean),
    })
    .from(reactions)
    .where(and(eq(reactions.entityType, entityType), inArray(reactions.entityId, ids)))
    .groupBy(reactions.entityId, reactions.emoji);
  const map = new Map<string, ReactionSummary>();
  for (const r of rows) {
    const list = map.get(r.entityId) ?? [];
    list.push({ emoji: r.emoji, count: r.n, mine: r.mine });
    map.set(r.entityId, list);
  }
  return map;
}

export async function hubCounts(groupId: string, userId: string, feedSeenAt: Date | null) {
  const since = feedSeenAt ?? new Date(0);
  const [[{ unread }], [{ openTasks }], [{ openPolls }], [{ unanswered }]] = await Promise.all([
    db
      .select({ unread: count() })
      .from(activity)
      .where(and(eq(activity.groupId, groupId), gt(activity.createdAt, since), sql`${activity.actorId} is distinct from ${userId}`)),
    db.select({ openTasks: count() }).from(tasks).where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt), isNull(tasks.closedAt))),
    db.select({ openPolls: count() }).from(polls).where(and(eq(polls.groupId, groupId), isNull(polls.deletedAt), isNull(polls.closedAt), or(isNull(polls.closesAt), gt(polls.closesAt, new Date())))),
    db.select({ unanswered: count() }).from(anonQuestions).where(and(eq(anonQuestions.groupId, groupId), isNull(anonQuestions.deletedAt), isNull(anonQuestions.answerBody))),
  ]);
  return { unread, openTasks, openPolls, unanswered };
}

export async function unreadCount(groupId: string, userId: string, feedSeenAt: Date | null) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(activity)
    .where(and(eq(activity.groupId, groupId), gt(activity.createdAt, feedSeenAt ?? new Date(0)), sql`${activity.actorId} is distinct from ${userId}`));
  return n;
}

// ---------- Новости ----------

export async function listNews(groupId: string, userId: string) {
  const rows = await db
    .select({ item: news, author: person })
    .from(news)
    .innerJoin(users, eq(users.id, news.authorId))
    .where(and(eq(news.groupId, groupId), isNull(news.deletedAt)))
    .orderBy(desc(sql`${news.pinnedAt} is not null`), desc(news.pinnedAt), desc(news.createdAt))
    .limit(100);
  const ids = rows.map((r) => r.item.id);
  const [reactMap, files] = await Promise.all([
    reactionsFor("news", ids, userId),
    ids.length ? db.select().from(attachments).where(and(eq(attachments.entityType, "news"), inArray(attachments.entityId, ids))) : Promise.resolve([]),
  ]);
  return rows.map((r) => ({
    id: r.item.id,
    title: r.item.title,
    body: r.item.body,
    pinned: Boolean(r.item.pinnedAt),
    createdAt: r.item.createdAt.toISOString(),
    author: r.author,
    reactions: reactMap.get(r.item.id) ?? [],
    attachments: files.filter((f) => f.entityId === r.item.id).map((f) => ({ id: f.id, name: f.fileName, mime: f.mime, size: f.sizeBytes, url: fileHref(f.id) })),
  }));
}

export type NewsItem = Awaited<ReturnType<typeof listNews>>[number];

// ---------- Задачи ----------

export async function listTasks(groupId: string) {
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        task: tasks,
        author: person,
        checked: sql<number>`(select count(*) from ${taskChecks} tc join ${users} u on u.id = tc.user_id where tc.task_id = ${tasks.id} and u.status = 'active')`.mapWith(Number),
      })
      .from(tasks)
      .innerJoin(users, eq(users.id, tasks.createdBy))
      .where(and(eq(tasks.groupId, groupId), isNull(tasks.deletedAt)))
      .orderBy(asc(sql`${tasks.closedAt} is not null`), asc(tasks.dueDate), desc(tasks.createdAt))
      .limit(100),
    db.select({ total: count() }).from(users).where(and(eq(users.groupId, groupId), eq(users.status, "active"))),
  ]);
  return {
    total,
    items: rows.map((r) => ({
      id: r.task.id,
      title: r.task.title,
      description: r.task.description,
      dueDate: r.task.dueDate,
      trackChecks: r.task.trackChecks,
      closed: Boolean(r.task.closedAt),
      createdAt: r.task.createdAt.toISOString(),
      author: r.author,
      checked: r.checked,
    })),
  };
}

export async function getTask(groupId: string, id: string) {
  const [row] = await db
    .select({ task: tasks, author: person })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.createdBy))
    .where(and(eq(tasks.id, id), eq(tasks.groupId, groupId), isNull(tasks.deletedAt)));
  if (!row) return null;
  const [students, checks] = await Promise.all([
    db.select(person).from(users).where(and(eq(users.groupId, groupId), eq(users.status, "active"))).orderBy(asc(users.fullName)),
    db.select({ userId: taskChecks.userId, checkedAt: taskChecks.checkedAt }).from(taskChecks).where(eq(taskChecks.taskId, id)),
  ]);
  const checkedSet = new Map(checks.map((c) => [c.userId, c.checkedAt]));
  return {
    id: row.task.id,
    title: row.task.title,
    description: row.task.description,
    dueDate: row.task.dueDate,
    trackChecks: row.task.trackChecks,
    closed: Boolean(row.task.closedAt),
    createdAt: row.task.createdAt.toISOString(),
    author: row.author,
    people: students.map((s) => ({ ...s, checkedAt: checkedSet.get(s.id)?.toISOString() ?? null })),
  };
}

// ---------- Опросы ----------

export async function listPolls(groupId: string, userId: string) {
  const rows = await db
    .select({ poll: polls, author: person })
    .from(polls)
    .innerJoin(users, eq(users.id, polls.createdBy))
    .where(and(eq(polls.groupId, groupId), isNull(polls.deletedAt)))
    .orderBy(asc(sql`${polls.closedAt} is not null`), desc(polls.createdAt))
    .limit(60);
  const ids = rows.map((r) => r.poll.id);
  if (ids.length === 0) return [];
  const [options, votes] = await Promise.all([
    db.select().from(pollOptions).where(inArray(pollOptions.pollId, ids)).orderBy(asc(pollOptions.position)),
    db
      .select({ pollId: pollVotes.pollId, optionId: pollVotes.optionId, userId: pollVotes.userId, voter: person })
      .from(pollVotes)
      .innerJoin(users, eq(users.id, pollVotes.userId))
      .where(inArray(pollVotes.pollId, ids)),
  ]);
  return rows.map((r) => {
    const pv = votes.filter((v) => v.pollId === r.poll.id);
    const voters = new Set(pv.map((v) => v.userId)).size;
    return {
      id: r.poll.id,
      question: r.poll.question,
      isAnonymous: r.poll.isAnonymous,
      isMulti: r.poll.isMulti,
      closesAt: r.poll.closesAt?.toISOString() ?? null,
      closed: Boolean(r.poll.closedAt) || (r.poll.closesAt ? r.poll.closesAt < new Date() : false),
      createdAt: r.poll.createdAt.toISOString(),
      author: r.author,
      voters,
      myVotes: pv.filter((v) => v.userId === userId).map((v) => v.optionId),
      options: options
        .filter((o) => o.pollId === r.poll.id)
        .map((o) => {
          const ov = pv.filter((v) => v.optionId === o.id);
          return { id: o.id, text: o.text, count: ov.length, voters: r.poll.isAnonymous ? [] : ov.map((v) => v.voter) };
        }),
    };
  });
}

export type PollItem = Awaited<ReturnType<typeof listPolls>>[number];

// ---------- Контакты, дни рождения ----------

export const listContacts = (groupId: string) => db.select().from(contacts).where(eq(contacts.groupId, groupId)).orderBy(asc(contacts.kind), asc(contacts.position), asc(contacts.name));

export async function listBirthdays(groupId: string, todayIso: string) {
  const rows = await db
    .select({ ...person, birthday: users.birthday })
    .from(users)
    .where(and(eq(users.groupId, groupId), eq(users.status, "active"), sql`${users.birthday} is not null`));
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  return rows
    .map((u) => {
      const [, m, d] = (u.birthday as string).split("-").map(Number);
      // 29 февраля в невисокосный год празднуем 28-го, а не 1 марта (Date.UTC переполняет месяц).
      const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const dayFor = (y: number) => (m === 2 && d === 29 && !isLeap(y) ? 28 : d);
      let next = Date.UTC(ty, m - 1, dayFor(ty));
      if (next < today) next = Date.UTC(ty + 1, m - 1, dayFor(ty + 1));
      const daysUntil = Math.round((next - today) / 86_400_000);
      return { ...u, birthday: u.birthday as string, daysUntil, monthDay: `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}` };
    })
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

// ---------- Анонимные вопросы ----------

export async function listQuestions(groupId: string) {
  const rows = await db
    .select({ q: anonQuestions, answerer: person })
    .from(anonQuestions)
    .leftJoin(users, eq(users.id, anonQuestions.answeredBy))
    .where(and(eq(anonQuestions.groupId, groupId), isNull(anonQuestions.deletedAt)))
    .orderBy(desc(anonQuestions.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.q.id,
    body: r.q.body,
    createdAt: r.q.createdAt.toISOString(),
    answerBody: r.q.answerBody,
    answeredAt: r.q.answeredAt?.toISOString() ?? null,
    answerer: r.answerer?.id ? r.answerer : null,
  }));
}

// ---------- Лента ----------

export async function listFeed(groupId: string, userId: string, limit = 60) {
  const rows = await db
    .select({ a: activity, actor: person })
    .from(activity)
    .leftJoin(users, eq(users.id, activity.actorId))
    .where(and(eq(activity.groupId, groupId), sql`${activity.actorId} is distinct from ${userId}`))
    .orderBy(desc(activity.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.a.id,
    eventType: r.a.eventType,
    entityType: r.a.entityType,
    entityId: r.a.entityId,
    payload: (r.a.payload ?? {}) as Record<string, unknown>,
    createdAt: r.a.createdAt.toISOString(),
    actor: r.actor?.id ? r.actor : null,
  }));
}

export type FeedItem = Awaited<ReturnType<typeof listFeed>>[number];

export { ne };
