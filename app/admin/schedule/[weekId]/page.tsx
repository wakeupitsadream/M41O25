import { notFound } from "next/navigation";
import { asUuid } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, lessons, semesters, subjects, weeks } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { WeekEditor } from "@/components/admin/week-editor";

export default async function WeekEditorPage({ params }: { params: Promise<{ weekId: string }> }) {
  const user = await requireRole("admin");
  const weekId = asUuid((await params).weekId);
  if (!weekId) notFound();
  const [week] = await db.select().from(weeks).where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
  if (!week) notFound();

  const [group] = await db.select({ slotTimes: groups.slotTimes }).from(groups).where(eq(groups.id, user.groupId));
  const [rows, subjectList, semList] = await Promise.all([
    db.select().from(lessons).where(eq(lessons.weekId, weekId)).orderBy(asc(lessons.date), asc(lessons.slot)),
    db.select().from(subjects).where(and(eq(subjects.groupId, user.groupId), eq(subjects.archived, false))).orderBy(asc(subjects.name)),
    db.select().from(semesters).where(eq(semesters.groupId, user.groupId)).orderBy(asc(semesters.startsOn)),
  ]);

  return (
    <WeekEditor
      week={{ id: week.id, startsOn: week.startsOn, parity: week.parity, status: week.status, semesterId: week.semesterId }}
      lessons={rows.map((l) => ({
        id: l.id,
        date: l.date,
        slot: l.slot,
        startsAt: l.startsAt.slice(0, 5),
        endsAt: l.endsAt.slice(0, 5),
        subjectId: l.subjectId,
        title: l.title,
        room: l.room,
        teacherName: l.teacherName,
        kind: l.kind,
        note: l.note,
        isCancelled: l.isCancelled,
        modifiedAfterPublish: l.modifiedAfterPublish,
      }))}
      subjects={subjectList.map((s) => ({ id: s.id, name: s.name, shortName: s.shortName, color: s.color, defaultTeacher: s.defaultTeacher, defaultRoom: s.defaultRoom }))}
      semesters={semList.map((s) => ({ id: s.id, title: s.title }))}
      slotTimes={group?.slotTimes ?? []}
    />
  );
}
