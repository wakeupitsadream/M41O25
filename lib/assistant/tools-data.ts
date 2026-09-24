import "server-only";
import { and, asc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { attachments, homework, hwEdits, subjects, users, type Role } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/auth";
import { getSchedulePayload } from "@/lib/schedule/query";
import { lessonsOn, semesterPhase, semestersOf } from "@/lib/schedule/derive";
import type { SchedulePayload } from "@/lib/schedule/types";
import { listBirthdays, listContacts, listNews, listPolls, listQuestions, listTasks } from "@/lib/group/query";
import { addDaysIso, mondayIso, nowHm, toTz, todayIso } from "@/lib/tz";
import { displayName } from "@/lib/utils";
import { weekdayRu } from "./compact";
import { lessonLine, type ContextInput } from "./context";

/*
 * Чтение данных группы для инструментов помощника и контекста (docs/AI-CHAT.md §6, таблица инструментов).
 * Только чтение и только то, что студент и так видит в приложении: groupId и userId приходят из сессии, модель
 * их не передаёт. Отдаём плоские объекты без null-полей — каждый лишний ключ стоит токенов; обрезка до ~4000
 * символов — в lib/assistant/tools.ts.
 *
 * Чего здесь нет намеренно (§6, «Запрещено»): invite_code, колонок users кроме имени/ника/роли, чужих и своих
 * галочек hw_done, поимённых голосов, года рождения, сессий, пушей, квот, ошибок, импортов сканов, черновиков недель.
 */

const ROLE_RU: Record<Role, string> = { student: "студент", moderator: "модератор", admin: "админ" };
const CONTACT_KIND_RU = { teacher: "преподаватель", dean: "деканат", other: "другое" } as const;

/** Убираем null/undefined/false/пустые строки и массивы: модели они ничего не говорят, а токены съедают. */
function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined || v === false || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out as Partial<T>;
}

/** Момент времени → «YYYY-MM-DD HH:MM» в поясе группы (сервер на Vercel живёт в UTC). */
const localStamp = (iso: string | Date) => format(toTz(iso), "yyyy-MM-dd HH:mm");
const localDate = (iso: string | Date) => format(toTz(iso), "yyyy-MM-dd");

/** Шаблон для ILIKE из пользовательской строки: % и _ — буквально, а не подстановки. */
const likePattern = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

// ---------- Расписание ----------

/** Понедельники опубликованных недель: день вне них — «не опубликовано», а не «пар нет». */
const publishedMondays = (p: SchedulePayload) => new Set(p.weeks.map((w) => w.startsOn));

/**
 * Пары по дням за период (docs/AI-CHAT.md §6, get_schedule): только опубликованные недели из getSchedulePayload,
 * пара — строкой lessonLine (время, предмет и его короткое имя, вид, аудитория, преподаватель, отмена, примечание).
 */
export async function scheduleRange(groupId: string, from: string, to: string) {
  const payload = await getSchedulePayload(groupId, null);
  const published = publishedMondays(payload);
  const days = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) {
    if (!published.has(mondayIso(d))) days.push({ date: d, weekday: weekdayRu(d), unpublished: true });
    else days.push({ date: d, weekday: weekdayRu(d), lessons: lessonsOn(payload.weeks, d).map(lessonLine) });
  }
  return { from, to, days };
}

// ---------- Домашка ----------

export type HomeworkQuery = { from: string; to: string; subject?: string | null };

/**
 * Домашка с полным текстом и блоками «Дополнить» — своя выборка, а не listHomework: там галочки «сделал» (их модели
 * не отдаём ни свои, ни чужие), счётчики комментариев и лимит по «актуальным». Дубли (duplicate_of_id) и удалённые
 * не показываем — как в расписании. Предмет ищется по названию, короткому имени и вариантам написания со сканов.
 */
export async function homeworkRange(groupId: string, q: HomeworkQuery) {
  const where: SQL[] = [eq(homework.groupId, groupId), isNull(homework.deletedAt), isNull(homework.duplicateOfId), gte(homework.dueDate, q.from), lte(homework.dueDate, q.to)];
  const subject = q.subject?.trim();
  if (subject) {
    const p = likePattern(subject);
    where.push(
      or(
        ilike(subjects.name, p),
        ilike(subjects.shortName, p),
        sql`exists (select 1 from unnest(${subjects.aliases}) as a(v) where a.v ilike ${p})`,
        ilike(homework.title, p),
      )!,
    );
  }
  const rows = await db
    .select({
      id: homework.id,
      dueDate: homework.dueDate,
      title: homework.title,
      body: homework.body,
      createdAt: homework.createdAt,
      subjectName: subjects.name,
      authorFull: users.fullName,
      authorNick: users.nickname,
      files: sql<number>`(select count(*) from ${attachments} where ${attachments.entityType} = 'homework' and (${attachments.entityId} = ${homework.id} or ${attachments.entityId} in (select ${hwEdits.id} from ${hwEdits} where ${hwEdits.homeworkId} = ${homework.id} and ${hwEdits.deletedAt} is null)))`.mapWith(Number),
    })
    .from(homework)
    .leftJoin(subjects, eq(subjects.id, homework.subjectId))
    .innerJoin(users, eq(users.id, homework.createdBy))
    .where(and(...where))
    .orderBy(asc(homework.dueDate), asc(homework.createdAt))
    .limit(40);

  const ids = rows.map((r) => r.id);
  const edits = ids.length
    ? await db
        .select({ homeworkId: hwEdits.homeworkId, text: hwEdits.text, createdAt: hwEdits.createdAt, authorFull: users.fullName, authorNick: users.nickname })
        .from(hwEdits)
        .innerJoin(users, eq(users.id, hwEdits.authorId))
        .where(and(inArray(hwEdits.homeworkId, ids), isNull(hwEdits.deletedAt)))
        .orderBy(asc(hwEdits.createdAt))
    : [];

  return {
    from: q.from,
    to: q.to,
    ...(subject ? { subject } : {}),
    items: rows.map((r) =>
      compact({
        dueDate: r.dueDate,
        weekday: weekdayRu(r.dueDate),
        subject: r.subjectName,
        title: r.title,
        body: r.body.trim(),
        author: displayName({ fullName: r.authorFull, nickname: r.authorNick }),
        files: r.files > 0 ? r.files : null,
        additions: edits
          .filter((e) => e.homeworkId === r.id)
          .map((e) => ({ author: displayName({ fullName: e.authorFull, nickname: e.authorNick }), date: localDate(e.createdAt), text: e.text.trim() })),
      }),
    ),
  };
}

// ---------- Новости, опросы, задачи ----------

export async function newsList(groupId: string, userId: string, limit: number) {
  const rows = await listNews(groupId, userId);
  return {
    items: rows.slice(0, limit).map((n) =>
      compact({ date: localStamp(n.createdAt), title: n.title, body: n.body.trim(), pinned: n.pinned, author: displayName(n.author), files: n.attachments.length || null }),
    ),
  };
}

/** Счётчики по вариантам и число проголосовавших — да; кто за что — нет, даже в неанонимных (§6). */
export async function pollsList(groupId: string, userId: string, openOnly: boolean) {
  const rows = await listPolls(groupId, userId);
  return {
    items: rows
      .filter((p) => !openOnly || !p.closed)
      .slice(0, 15)
      .map((p) =>
        compact({
          question: p.question,
          options: p.options.map((o) => ({ text: o.text, votes: o.count })),
          voters: p.voters,
          multi: p.isMulti,
          closed: p.closed,
          closesAt: p.closesAt && !p.closed ? localStamp(p.closesAt) : null,
          date: localDate(p.createdAt),
        }),
      ),
  };
}

export async function tasksList(groupId: string, openOnly: boolean) {
  const { total, items } = await listTasks(groupId);
  return {
    items: items
      .filter((t) => !openOnly || !t.closed)
      .slice(0, 20)
      .map((t) =>
        compact({
          title: t.title,
          description: t.description?.trim(),
          dueDate: t.dueDate,
          closed: t.closed,
          done: t.trackChecks ? `${t.checked} из ${total}` : null,
          author: displayName(t.author),
        }),
      ),
  };
}

// ---------- Люди ----------

export async function contactsList(groupId: string, query: string | null) {
  const rows = await listContacts(groupId);
  const q = query?.trim().toLowerCase();
  return {
    items: rows
      .filter((c) => !q || [c.name, c.roleOrSubject, c.note].some((f) => f?.toLowerCase().includes(q)))
      .map((c) =>
        compact({ name: c.name, kind: CONTACT_KIND_RU[c.kind], roleOrSubject: c.roleOrSubject, phone: c.phone, email: c.email, messenger: c.messenger, note: c.note }),
      ),
  };
}

/** Дни рождения — «DD.MM» и через сколько дней; года нет (возраст — личное). */
export async function birthdaysList(groupId: string, days: number) {
  const rows = await listBirthdays(groupId, todayIso());
  return {
    today: todayIso(),
    items: rows.filter((b) => b.daysUntil <= days).map((b) => ({ name: displayName(b), date: b.monthDay, inDays: b.daysUntil })),
  };
}

/** Состав группы: только имя, ник и роль активных — ни дня рождения, ни последнего входа, ни PIN-статуса. */
export async function membersList(groupId: string, query: string | null) {
  const q = query?.trim();
  const rows = await db
    .select({ fullName: users.fullName, nickname: users.nickname, role: users.role })
    .from(users)
    .where(and(eq(users.groupId, groupId), eq(users.status, "active"), ...(q ? [or(ilike(users.fullName, likePattern(q)), ilike(users.nickname, likePattern(q)))!] : [])))
    .orderBy(asc(users.fullName));
  return { total: rows.length, items: rows.map((u) => compact({ fullName: u.fullName, nickname: u.nickname, role: ROLE_RU[u.role] })) };
}

/** Анонимные вопросы: автора нет по устройству таблицы, отвечающий — по имени. */
export async function questionsList(groupId: string, limit: number) {
  const rows = await listQuestions(groupId);
  return {
    items: rows.slice(0, limit).map((q) =>
      compact({ date: localDate(q.createdAt), question: q.body.trim(), answer: q.answerBody?.trim(), answeredBy: q.answerer ? displayName(q.answerer) : null }),
    ),
  };
}

// ---------- Контекст запроса ----------

/**
 * Данные для buildContext (lib/assistant/context.ts): одно чтение расписания (getSchedulePayload уже включает
 * домашку к дням с коротким текстом) — пары сегодня и завтра, домашка на три дня, фаза семестра, звонки.
 */
export async function loadContextInput(user: SessionUser): Promise<ContextInput> {
  const payload = await getSchedulePayload(user.groupId, null);
  const today = todayIso();
  const published = publishedMondays(payload);
  const dayOf = (date: string) => ({ date, lessons: published.has(mondayIso(date)) ? lessonsOn(payload.weeks, date) : null });
  const last = addDaysIso(today, 2);
  return {
    today,
    now: nowHm(),
    phase: semesterPhase(semestersOf(payload), today),
    parity: payload.weeks.find((w) => w.startsOn === mondayIso(today))?.parity ?? null,
    user: { fullName: user.fullName, role: user.role },
    slotTimes: payload.group.slotTimes,
    days: [dayOf(today), dayOf(addDaysIso(today, 1))],
    homework: (payload.homework ?? []).filter((h) => h.dueDate >= today && h.dueDate <= last),
  };
}
