"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { activity, lessons, subjects, weeks } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import type { PushEvent } from "@/lib/push/format";
import { notifyQuietly } from "@/lib/push/send";
import { lessonChangeSummary } from "@/lib/schedule/lesson-change";
import { addDaysIso, mondayIso, todayIso } from "@/lib/tz";
import { asUuid, fail, ok, type ActionResult } from "@/lib/utils";
import { wrapAction, wrapForm } from "@/lib/actions";
import { isoDate } from "@/lib/validation";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Время в формате ЧЧ:ММ");

const bump = (weekId: string) => {
  revalidatePath("/s", "layout");
  revalidatePath("/admin/schedule");
  revalidatePath(`/admin/schedule/${weekId}`);
};

type LessonForPush = { title: string; subjectId: string | null; date: string; startsAt: string };

/** Короткое имя предмета для заголовка пуша («Матан»); пара без предмета или предмет без short_name — null. */
async function shortSubject(subjectId: string | null): Promise<string | null> {
  if (!subjectId) return null;
  const [s] = await db.select({ shortName: subjects.shortName }).from(subjects).where(eq(subjects.id, subjectId));
  return s?.shortName ?? null;
}

/**
 * Пуш о паре в ОПУБЛИКОВАННОЙ неделе — после ответа, как у новостей (app/(app)/group/actions.ts, createNews):
 * расписание уже исправлено, и упавшая рассылка его не откатит и не задержит. Вызывающий сам проверяет статус недели:
 * черновик студенты не видят. Прошедшие дни молчат — об отмене вчерашней пары сообщать некому. Короткое имя предмета
 * подтягиваем уже внутри after(), вне запроса; не нашлось — в заголовок пойдёт название пары.
 */
function pushLesson(user: { id: string; groupId: string }, kind: "lesson_cancelled" | "lesson_restored" | "lesson_changed", lesson: LessonForPush, what?: string | null) {
  if (lesson.date < todayIso()) return;
  after(async () => {
    const subject = await shortSubject(lesson.subjectId).catch(() => null);
    // Время из базы — «08:30:00» (колонка time), из формы — «08:30»; в пуше всегда без секунд.
    const base = { title: lesson.title, subject, date: lesson.date, startsAt: lesson.startsAt.slice(0, 5) };
    const event: PushEvent = kind === "lesson_changed" ? { kind, ...base, what } : { kind, ...base };
    await notifyQuietly(event, { groupId: user.groupId, exceptUserId: user.id });
  });
}

export async function createWeek(_prev: FormState, formData: FormData): Promise<FormState> {
  return wrapForm(async () => {
    const user = await actionUser("admin");
    const parsed = z
      .object({
        startsOn: isoDate,
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
    if (!parsed.success) return { error: "Проверь дату недели: нужна существующая дата в формате ГГГГ-ММ-ДД" };
    const startsOn = mondayIso(parsed.data.startsOn);

    const exists = await db.select({ id: weeks.id }).from(weeks).where(and(eq(weeks.groupId, user.groupId), eq(weeks.startsOn, startsOn)));
    if (exists[0]) redirect(`/admin/schedule/${exists[0].id}`);

    // Неделя и скопированные пары — одной транзакцией: упавшая вставка пар не оставит пустую неделю.
    // Двойной тап по «Создать» ловится уникальным индексом (group_id, starts_on): второй запрос получает 23505,
    // и мы ведём его на уже созданную неделю, а не на экран ошибки.
    let weekId: string;
    try {
      weekId = await db.transaction(async (tx) => {
        const [week] = await tx
          .insert(weeks)
          .values({
            groupId: user.groupId,
            startsOn,
            parity: parsed.data.parity === "none" ? null : parsed.data.parity,
            semesterId: parsed.data.semesterId || null,
          })
          .returning({ id: weeks.id });
        if (parsed.data.copyFrom) {
          const [src] = await tx.select().from(weeks).where(and(eq(weeks.id, parsed.data.copyFrom), eq(weeks.groupId, user.groupId)));
          if (src) {
            const srcLessons = await tx.select().from(lessons).where(eq(lessons.weekId, src.id));
            const shift = Math.round((Date.parse(startsOn) - Date.parse(src.startsOn)) / 86_400_000);
            const copy = srcLessons.filter((l) => !l.isCancelled);
            if (copy.length) {
              await tx.insert(lessons).values(
                copy.map((l) => ({
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
        return week.id;
      });
    } catch (e) {
      if ((e as { cause?: { code?: string }; code?: string }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") {
        const [again] = await db.select({ id: weeks.id }).from(weeks).where(and(eq(weeks.groupId, user.groupId), eq(weeks.startsOn, startsOn)));
        if (again) redirect(`/admin/schedule/${again.id}`);
      }
      throw e;
    }
    bump(weekId);
    redirect(`/admin/schedule/${weekId}`);
  });
}

const lessonInput = z.object({
  id: z.string().uuid().optional(),
  weekId: z.string().uuid(),
  date: isoDate,
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
  return wrapAction(async () => {
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
    // Что сказать студентам в пуше: новой паре — «добавлена пара», правке — перечень отличий от прежней версии;
    // null — ничего значимого не поменялось (открыли и сохранили), и пуш не уходит.
    let what: string | null;
    if (id) {
      const [prev] = await db.select().from(lessons).where(and(eq(lessons.id, id), eq(lessons.groupId, user.groupId)));
      if (!prev) return fail("Пара не найдена");
      await db
        .update(lessons)
        .set({ ...values, modifiedAfterPublish: published })
        .where(eq(lessons.id, id));
      what = lessonChangeSummary(prev, values);
    } else {
      const [row] = await db
        .insert(lessons)
        .values({ ...values, weekId: week.id, groupId: user.groupId, modifiedAfterPublish: published })
        .returning({ id: lessons.id });
      id = row.id;
      what = "добавлена пара";
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
      if (what !== null) pushLesson(user, "lesson_changed", d, what);
    }
    await db.update(weeks).set({ updatedAt: new Date() }).where(eq(weeks.id, week.id));
    bump(week.id);
    return ok({ id });
  });
}

/** Пара вместе со статусом её недели: опубликована ли она, решает, уйдёт ли студентам пуш. */
const lessonWithWeek = (id: string, groupId: string) =>
  db
    .select({ lesson: lessons, weekStatus: weeks.status })
    .from(lessons)
    .innerJoin(weeks, eq(weeks.id, lessons.weekId))
    .where(and(eq(lessons.id, id), eq(lessons.groupId, groupId)));

export async function toggleCancelLesson(id: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser("admin");
    if (!asUuid(id)) return fail("Пара не найдена");
    const [row] = await lessonWithWeek(id, user.groupId);
    if (!row) return fail("Пара не найдена");
    const l = row.lesson;
    await db.update(lessons).set({ isCancelled: !l.isCancelled, modifiedAfterPublish: true, updatedAt: new Date() }).where(eq(lessons.id, id));
    await db.insert(activity).values({
      groupId: user.groupId,
      eventType: l.isCancelled ? "lesson_restored" : "lesson_cancelled",
      entityType: "lesson",
      entityId: id,
      actorId: user.id,
      payload: { date: l.date, title: l.title },
    });
    if (row.weekStatus === "published") pushLesson(user, l.isCancelled ? "lesson_restored" : "lesson_cancelled", l);
    bump(l.weekId);
    return ok();
  });
}

export async function deleteLesson(id: string): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser("admin");
    if (!asUuid(id)) return fail("Пара не найдена");
    const [row] = await lessonWithWeek(id, user.groupId);
    if (!row) return fail("Пара не найдена");
    const l = row.lesson;
    const published = row.weekStatus === "published";
    await db.transaction(async (tx) => {
      await tx.delete(lessons).where(eq(lessons.id, id));
      // Из опубликованной недели пара не должна пропадать молча: для студента это та же отмена, только без зачёркнутой
      // строки. Событие в ленту «Что нового» (и точка на вкладке) с пометкой deleted — редактор обещает, что правки видны.
      if (published) {
        await tx.insert(activity).values({
          groupId: user.groupId,
          eventType: "lesson_cancelled",
          entityType: "lesson",
          entityId: id,
          actorId: user.id,
          payload: { date: l.date, title: l.title, deleted: true },
        });
      }
    });
    if (published) pushLesson(user, "lesson_cancelled", l);
    bump(l.weekId);
    return ok();
  });
}

export async function setWeekStatus(weekId: string, status: "draft" | "published"): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser("admin");
    if (!asUuid(weekId) || (status !== "draft" && status !== "published")) return fail("Неделя не найдена");
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
      // Пуш — после ответа, как у новостей. Уже прошедшая неделя (архив, скан задним числом) его не заслуживает:
      // будить двадцать телефонов не из-за чего.
      if (addDaysIso(week.startsOn, 6) >= todayIso()) {
        after(() => notifyQuietly({ kind: "week_published", startsOn: week.startsOn }, { groupId: user.groupId, exceptUserId: user.id }));
      }
    }
    bump(weekId);
    return ok();
  });
}

export async function updateWeekMeta(weekId: string, data: { parity: "upper" | "lower" | null; semesterId: string | null }): Promise<ActionResult> {
  return wrapAction(async () => {
    const user = await actionUser("admin");
    const parity = data.parity === "upper" || data.parity === "lower" ? data.parity : null;
    const semesterId = asUuid(data.semesterId);
    if (!asUuid(weekId)) return fail("Неделя не найдена");
    await db
      .update(weeks)
      .set({ parity, semesterId, updatedAt: new Date() })
      .where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
    bump(weekId);
    return ok();
  });
}

export async function deleteWeek(weekId: string) {
  const user = await actionUser("admin");
  const id = asUuid(weekId);
  if (id) {
    await db.delete(weeks).where(and(eq(weeks.id, id), eq(weeks.groupId, user.groupId)));
    bump(id);
  }
  redirect("/admin/schedule");
}
