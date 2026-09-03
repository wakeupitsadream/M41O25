"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activity, lessons, weeks } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { addDaysIso, mondayIso } from "@/lib/tz";
import { fail, ok, type ActionResult } from "@/lib/utils";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ");

const bump = (weekId: string) => {
  revalidatePath("/s", "layout");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/schedule/${weekId}`);
};

export async function createWeek(formData: FormData) {
  const user = await actionUser("admin");
  const parsed = z
    .object({
      startsOn: iso,
      parity: z.enum(["upper", "lower", "none"]),
      semesterId: z.string().uuid().optional().or(z.literal("")),
      copyFrom: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse({
      startsOn: formData.get("startsOn"),
      parity: formData.get("parity") ?? "none",
      semesterId: formData.get("semesterId") ?? "",
      copyFrom: formData.get("copyFrom") ?? "",
    });
  if (!parsed.success) throw new Error("Проверь дату недели");
  const startsOn = mondayIso(parsed.data.startsOn);

  const exists = await db.select({ id: weeks.id }).from(weeks).where(and(eq(weeks.groupId, user.groupId), eq(weeks.startsOn, startsOn)));
  if (exists[0]) redirect(`/admin/schedule/${exists[0].id}`);

  const [week] = await db
    .insert(weeks)
    .values({
      groupId: user.groupId,
      startsOn,
      parity: parsed.data.parity === "none" ? null : parsed.data.parity,
      semesterId: parsed.data.semesterId || null,
    })
    .returning();

  if (parsed.data.copyFrom) {
    const src = await db.select().from(weeks).where(and(eq(weeks.id, parsed.data.copyFrom), eq(weeks.groupId, user.groupId)));
    if (src[0]) {
      const srcLessons = await db.select().from(lessons).where(eq(lessons.weekId, src[0].id));
      const shift = Math.round((Date.parse(startsOn) - Date.parse(src[0].startsOn)) / 86_400_000);
      if (srcLessons.length) {
        await db.insert(lessons).values(
          srcLessons
            .filter((l) => !l.isCancelled)
            .map((l) => ({
              weekId: week.id,
              groupId: user.groupId,
              subjectId: l.subjectId,
              title: l.title,
              date: addDaysIso(l.date, shift),
              slot: l.slot,
              startsAt: l.startsAt,
              endsAt: l.endsAt,
              room: l.room,
              teacherName: l.teacherName,
              kind: l.kind,
            })),
        );
      }
    }
  }
  bump(week.id);
  redirect(`/admin/schedule/${week.id}`);
}

const lessonInput = z.object({
  id: z.string().uuid().optional(),
  weekId: z.string().uuid(),
  date: iso,
  slot: z.number().int().min(1).max(10),
  startsAt: hhmm,
  endsAt: hhmm,
  subjectId: z.string().uuid().nullable(),
  title: z.string().trim().min(1, "Укажи предмет").max(120),
  room: z.string().trim().max(40).nullable(),
  teacherName: z.string().trim().max(80).nullable(),
  kind: z.enum(["lecture", "practice", "lab", "exam", "credit", "consultation", "other"]),
  note: z.string().trim().max(200).nullable(),
}).refine((d) => d.endsAt > d.startsAt, { message: "Конец пары должен быть позже начала", path: ["endsAt"] });

export type LessonInput = z.infer<typeof lessonInput>;

export async function upsertLesson(input: LessonInput): Promise<ActionResult<{ id: string }>> {
  const user = await actionUser("admin");
  const parsed = lessonInput.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const d = parsed.data;
  const [week] = await db.select().from(weeks).where(and(eq(weeks.id, d.weekId), eq(weeks.groupId, user.groupId)));
  if (!week) return fail("Неделя не найдена");
  const published = week.status === "published";

  const values = {
    subjectId: d.subjectId,
    title: d.title,
    date: d.date,
    slot: d.slot,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    room: d.room || null,
    teacherName: d.teacherName || null,
    kind: d.kind,
    note: d.note || null,
    updatedAt: new Date(),
  };

  let id = d.id;
  if (id) {
    await db
      .update(lessons)
      .set({ ...values, modifiedAfterPublish: published })
      .where(and(eq(lessons.id, id), eq(lessons.groupId, user.groupId)));
  } else {
    const [row] = await db
      .insert(lessons)
      .values({ ...values, weekId: week.id, groupId: user.groupId, modifiedAfterPublish: published })
      .returning({ id: lessons.id });
    id = row.id;
  }
  if (published) {
    await db.insert(activity).values({
      groupId: user.groupId,
      eventType: "schedule_changed",
      entityType: "lesson",
      entityId: id,
      actorId: user.id,
      payload: { date: d.date, title: d.title },
    });
  }
  await db.update(weeks).set({ updatedAt: new Date() }).where(eq(weeks.id, week.id));
  bump(week.id);
  return ok({ id });
}

export async function toggleCancelLesson(id: string): Promise<ActionResult> {
  const user = await actionUser("admin");
  const [l] = await db.select().from(lessons).where(and(eq(lessons.id, id), eq(lessons.groupId, user.groupId)));
  if (!l) return fail("Пара не найдена");
  await db.update(lessons).set({ isCancelled: !l.isCancelled, modifiedAfterPublish: true, updatedAt: new Date() }).where(eq(lessons.id, id));
  await db.insert(activity).values({
    groupId: user.groupId,
    eventType: l.isCancelled ? "lesson_restored" : "lesson_cancelled",
    entityType: "lesson",
    entityId: id,
    actorId: user.id,
    payload: { date: l.date, title: l.title },
  });
  bump(l.weekId);
  return ok();
}

export async function deleteLesson(id: string): Promise<ActionResult> {
  const user = await actionUser("admin");
  const [l] = await db.select({ weekId: lessons.weekId }).from(lessons).where(and(eq(lessons.id, id), eq(lessons.groupId, user.groupId)));
  if (!l) return fail("Пара не найдена");
  await db.delete(lessons).where(eq(lessons.id, id));
  bump(l.weekId);
  return ok();
}

export async function setWeekStatus(weekId: string, status: "draft" | "published"): Promise<ActionResult> {
  const user = await actionUser("admin");
  const [week] = await db.select().from(weeks).where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
  if (!week) return fail("Неделя не найдена");
  await db
    .update(weeks)
    .set({ status, publishedAt: status === "published" ? new Date() : week.publishedAt, updatedAt: new Date() })
    .where(eq(weeks.id, weekId));
  if (status === "published") {
    await db.update(lessons).set({ modifiedAfterPublish: false }).where(eq(lessons.weekId, weekId));
    await db.insert(activity).values({
      groupId: user.groupId,
      eventType: "schedule_published",
      entityType: "week",
      entityId: weekId,
      actorId: user.id,
      payload: { startsOn: week.startsOn },
    });
  }
  bump(weekId);
  return ok();
}

export async function updateWeekMeta(weekId: string, data: { parity: "upper" | "lower" | null; semesterId: string | null }): Promise<ActionResult> {
  const user = await actionUser("admin");
  await db
    .update(weeks)
    .set({ parity: data.parity, semesterId: data.semesterId, updatedAt: new Date() })
    .where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
  bump(weekId);
  return ok();
}

export async function deleteWeek(weekId: string) {
  const user = await actionUser("admin");
  await db.delete(weeks).where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
  bump(weekId);
  redirect("/admin/schedule");
}
