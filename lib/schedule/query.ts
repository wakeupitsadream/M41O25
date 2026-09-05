import "server-only";
import { and, asc, desc, eq, gte, lt, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, lessons, semesters, subjects, weeks } from "@/lib/db/schema";
import { todayIso, addDaysIso } from "@/lib/tz";
import { listHomeworkForSchedule } from "@/lib/hw/query";
import type { SchedulePayload, ScheduleSemester, ScheduleWeek } from "./types";
import type { PrevLesson } from "@/lib/ocr/diff";

type SemesterRow = typeof semesters.$inferSelect;

const listSemesters = (groupId: string) => db.select().from(semesters).where(eq(semesters.groupId, groupId)).orderBy(asc(semesters.startsOn));

/** Из списка по возрастанию startsOn: идёт семестр → идёт его хвост (до 60 дней после endsOn и до начала следующего) → ближайший будущий → последний. */
function pickCurrentSemester(all: SemesterRow[], today: string): SemesterRow | null {
  const nextStart = (s: { startsOn: string }) => all.find((n) => n.startsOn > s.startsOn)?.startsOn ?? null;
  return (
    all.find((s) => s.startsOn <= today && s.endsOn >= today) ??
    all.find((s) => s.endsOn < today && today <= addDaysIso(s.endsOn, 60) && (nextStart(s) === null || today < nextStart(s)!)) ??
    all.find((s) => s.startsOn > today) ??
    all.at(-1) ??
    null
  );
}

/** Текущий семестр: тот, в который попадает сегодня; иначе ближайший будущий; иначе последний прошедший. */
export async function getCurrentSemester(groupId: string) {
  return pickCurrentSemester(await listSemesters(groupId), todayIso());
}

const toSemester = (s: SemesterRow): ScheduleSemester => ({
  id: s.id,
  title: s.title,
  startsOn: s.startsOn,
  endsOn: s.endsOn,
  sessionStartsOn: s.sessionStartsOn,
});

/**
 * Опубликованные недели с парами и ДЗ к дням — то, что видят студенты (и что кешируется офлайн).
 * userId нужен только для личных галочек «сделал» у ДЗ; без него все done = false.
 * С `semesterId` — окно архивного семестра группы (для сетки прошлых семестров); чужой или неизвестный id → текущий.
 */
export async function getSchedulePayload(groupId: string, userId: string | null = null, semesterId?: string | null): Promise<SchedulePayload> {
  const [group] = await db.select({ shortName: groups.shortName, slotTimes: groups.slotTimes }).from(groups).where(eq(groups.id, groupId));
  const today = todayIso();
  const all = await listSemesters(groupId);
  const semester = (semesterId ? all.find((s) => s.id === semesterId) : null) ?? pickCurrentSemester(all, today);

  // Окно: семестр с запасом в неделю до и два месяца после (сессия), либо ±60 дней от сегодня.
  const from = semester ? addDaysIso(semester.startsOn, -7) : addDaysIso(today, -60);
  const to = semester ? addDaysIso(semester.endsOn, 60) : addDaysIso(today, 60);

  const weekRows = await db
    .select()
    .from(weeks)
    .where(and(eq(weeks.groupId, groupId), eq(weeks.status, "published"), gte(weeks.startsOn, from), lte(weeks.startsOn, to)))
    .orderBy(asc(weeks.startsOn));

  const lessonRows = weekRows.length
    ? await db
        .select({
          lesson: lessons,
          subjectShort: subjects.shortName,
          subjectColor: subjects.color,
        })
        .from(lessons)
        .leftJoin(subjects, eq(subjects.id, lessons.subjectId))
        .where(and(eq(lessons.groupId, groupId), gte(lessons.date, from), lte(lessons.date, addDaysIso(to, 7))))
        .orderBy(asc(lessons.date), asc(lessons.slot), desc(lessons.createdAt))
    : [];

  const byWeek = new Map<string, ScheduleWeek>();
  for (const w of weekRows) {
    byWeek.set(w.id, { id: w.id, startsOn: w.startsOn, parity: w.parity, publishedAt: w.publishedAt?.toISOString() ?? null, lessons: [] });
  }
  for (const { lesson, subjectShort, subjectColor } of lessonRows) {
    const w = byWeek.get(lesson.weekId);
    if (!w) continue;
    w.lessons.push({
      id: lesson.id,
      date: lesson.date,
      slot: lesson.slot,
      startsAt: lesson.startsAt.slice(0, 5),
      endsAt: lesson.endsAt.slice(0, 5),
      title: lesson.title,
      subjectId: lesson.subjectId,
      subjectShort,
      subjectColor,
      room: lesson.room,
      teacherName: lesson.teacherName,
      kind: lesson.kind,
      note: lesson.note,
      isCancelled: lesson.isCancelled,
      modifiedAfterPublish: lesson.modifiedAfterPublish,
    });
  }

  // ДЗ едет в том же ответе: экран дня работает офлайн, а лишний запрос на каждый заход в расписание не нужен.
  // Окно шире назад на месяц: архивные записи ещё видны на прошедших днях.
  const homeworkList = await listHomeworkForSchedule(groupId, userId, addDaysIso(today, -30), addDaysIso(to, 7));

  return {
    group: { shortName: group?.shortName ?? "", slotTimes: group?.slotTimes ?? [] },
    semester: semester ? toSemester(semester) : null,
    semesters: all.map(toSemester),
    weeks: [...byWeek.values()],
    homework: homeworkList,
    generatedAt: new Date().toISOString(),
  };
}

export type PreviousWeek = { id: string; startsOn: string; parity: "upper" | "lower" | null; lessons: PrevLesson[] };

/**
 * Последняя опубликованная неделя до указанной даты — той же чётности, если чётность задана.
 * Нужна черновику скана: показать, что новое, что изменилось и какие пары пропали.
 */
export async function getPreviousPublishedWeek(groupId: string, beforeStartsOn: string, parity: "upper" | "lower" | null): Promise<PreviousWeek | null> {
  const [week] = await db
    .select({ id: weeks.id, startsOn: weeks.startsOn, parity: weeks.parity })
    .from(weeks)
    .where(and(eq(weeks.groupId, groupId), eq(weeks.status, "published"), lt(weeks.startsOn, beforeStartsOn), ...(parity ? [eq(weeks.parity, parity)] : [])))
    .orderBy(desc(weeks.startsOn))
    .limit(1);
  if (!week) return null;
  const rows = await db
    .select()
    .from(lessons)
    .where(and(eq(lessons.weekId, week.id), eq(lessons.isCancelled, false)))
    .orderBy(asc(lessons.date), asc(lessons.slot));
  return {
    ...week,
    lessons: rows.map((l) => ({
      date: l.date,
      slot: l.slot,
      title: l.title,
      subjectId: l.subjectId,
      room: l.room,
      teacherName: l.teacherName,
      kind: l.kind,
      startsAt: l.startsAt.slice(0, 5),
      endsAt: l.endsAt.slice(0, 5),
    })),
  };
}
