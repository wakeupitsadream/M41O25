import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, lessons, semesters, subjects, weeks } from "@/lib/db/schema";
import { todayIso, addDaysIso } from "@/lib/tz";
import type { SchedulePayload, ScheduleWeek } from "./types";

/** Текущий семестр: тот, в который попадает сегодня; иначе ближайший будущий; иначе последний прошедший. */
export async function getCurrentSemester(groupId: string) {
  const today = todayIso();
  const all = await db.select().from(semesters).where(eq(semesters.groupId, groupId)).orderBy(asc(semesters.startsOn));
  return (
    all.find((s) => s.startsOn <= today && s.endsOn >= today) ??
    all.find((s) => s.startsOn > today) ??
    all.at(-1) ??
    null
  );
}

/** Опубликованные недели с парами — то, что видят студенты (и что кешируется офлайн). */
export async function getSchedulePayload(groupId: string): Promise<SchedulePayload> {
  const [group] = await db.select({ shortName: groups.shortName, slotTimes: groups.slotTimes }).from(groups).where(eq(groups.id, groupId));
  const semester = await getCurrentSemester(groupId);
  const today = todayIso();

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

  return {
    group: { shortName: group?.shortName ?? "", slotTimes: group?.slotTimes ?? [] },
    semester: semester
      ? { id: semester.id, title: semester.title, startsOn: semester.startsOn, endsOn: semester.endsOn, sessionStartsOn: semester.sessionStartsOn }
      : null,
    weeks: [...byWeek.values()],
    generatedAt: new Date().toISOString(),
  };
}
