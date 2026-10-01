"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { lessons, scheduleImports, subjects, weeks } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { addDaysIso } from "@/lib/tz";
import { asUuid, fail, ok, type ActionResult } from "@/lib/utils";
import { wrapAction } from "@/lib/actions";
import { pickNewLessons, type ApplyMode } from "@/lib/ocr/apply";
import { aliasesToLearn, MAX_ALIAS_LENGTH } from "@/lib/ocr/match";
import { isoDate } from "@/lib/validation";
import { homework } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const draftLesson = z.object({
  date: isoDate,
  slot: z.number().int().min(1).max(10),
  startsAt: z.string().regex(hhmm, "Время начала"),
  endsAt: z.string().regex(hhmm, "Время конца"),
  title: z.string().trim().min(1).max(120),
  /** Название как в скане — для автообучения алиасов; если не передано, берём title. */
  scanTitle: z.string().trim().max(MAX_ALIAS_LENGTH).optional(),
  subjectId: z.string().uuid().nullable(),
  room: z.string().trim().max(40).nullable(),
  teacherName: z.string().trim().max(80).nullable(),
  kind: z.enum(["lecture", "practice", "lab", "exam", "credit", "consultation", "other"]),
});

export type ApplyDraftItem = z.infer<typeof draftLesson>;
export type ApplyDraftResult = { count: number; skipped: number; learned: number };

/**
 * Черновик распознавания → пары недели.
 * `replace` — существующие пары недели удаляются (пользователь подтверждает в UI); `add-missing` — добавляются только те,
 * для которых в неделе ещё нет пары на ту же дату и номер.
 * Побочный эффект-обучение: если строка привязана к предмету, а название из скана не совпадает с его name/shortName/aliases,
 * это написание сохраняется в aliases — в следующий раз предмет найдётся точно.
 */
export async function applyDraft(weekId: string, importId: string | null, items: ApplyDraftItem[], applyMode: ApplyMode): Promise<ActionResult<ApplyDraftResult>> {
  return wrapAction(async () => {
    const user = await actionUser("admin");
    if (!asUuid(weekId) || (importId !== null && !asUuid(importId))) return fail("Неделя не найдена");
    if (applyMode !== "replace" && applyMode !== "add-missing") return fail("Неизвестный режим применения");
    const parsed = z.array(draftLesson).max(80).safeParse(items);
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      const idx = typeof i.path[0] === "number" ? i.path[0] : -1;
      const l = idx >= 0 ? items[idx] : null;
      return fail(`Некорректная пара${l ? ` (${l.date}, №${l.slot})` : ""}: ${i.message}`);
    }
    const [week] = await db.select().from(weeks).where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
    if (!week) return fail("Неделя не найдена");

    const bad = parsed.data.findIndex((l) => l.endsAt <= l.startsAt);
    if (bad >= 0) return fail(`Пара ${parsed.data[bad].date} №${parsed.data[bad].slot}: конец раньше начала`);

    const subjectRows = await db
      .select({ id: subjects.id, name: subjects.name, shortName: subjects.shortName, aliases: subjects.aliases })
      .from(subjects)
      .where(eq(subjects.groupId, user.groupId));
    const knownIds = new Set(subjectRows.map((s) => s.id));
    const foreign = parsed.data.find((l) => l.subjectId && !knownIds.has(l.subjectId));
    if (foreign) return fail(`Пара ${foreign.date} №${foreign.slot}: предмет не из справочника группы`);

    const learn = aliasesToLearn(
      parsed.data.map((l) => ({ subjectId: l.subjectId, title: l.scanTitle || l.title })),
      subjectRows,
    );

    let skipped = 0;
    await db.transaction(async (tx) => {
      let toInsert = parsed.data;
      if (applyMode === "replace") {
        await tx.delete(lessons).where(eq(lessons.weekId, weekId));
      } else {
        const existing = await tx.select({ date: lessons.date, slot: lessons.slot }).from(lessons).where(eq(lessons.weekId, weekId));
        const picked = pickNewLessons(parsed.data, existing);
        toInsert = picked.add;
        skipped = picked.skipped.length;
      }
      if (toInsert.length) {
        await tx.insert(lessons).values(
          toInsert.map((l) => ({
            weekId,
            groupId: user.groupId,
            subjectId: l.subjectId,
            title: l.title,
            date: l.date,
            slot: l.slot,
            startsAt: l.startsAt,
            endsAt: l.endsAt,
            room: l.room || null,
            teacherName: l.teacherName || null,
            kind: l.kind,
            modifiedAfterPublish: week.status === "published",
          })),
        );
      }
      // «Заменить все» удалил старые пары, и ДЗ, записанные «к паре», потеряли lesson_id (FK set null).
      // Привязываем их заново к новой паре того же предмета в тот же день — иначе в карточке ДЗ пропадает строка
      // «к паре …», а чинить это можно было только правкой каждой записи.
      if (applyMode === "replace") {
        const weekEnd = addDaysIso(week.startsOn, 6);
        await tx.execute(sql`
          update ${homework} h set lesson_id = (
            select l.id from ${lessons} l
            where l.group_id = h.group_id and l.subject_id = h.subject_id and l.date = h.due_date and not l.is_cancelled
            order by l.slot limit 1
          )
          where h.group_id = ${user.groupId} and h.lesson_id is null and h.subject_id is not null and h.deleted_at is null
            and h.due_date between ${week.startsOn} and ${weekEnd}
        `);
      }
      for (const [subjectId, fresh] of learn) {
        const current = subjectRows.find((s) => s.id === subjectId)?.aliases ?? [];
        await tx
          .update(subjects)
          .set({ aliases: [...current, ...fresh] })
          .where(and(eq(subjects.id, subjectId), eq(subjects.groupId, user.groupId)));
      }
      if (importId) await tx.update(scheduleImports).set({ status: "applied" }).where(and(eq(scheduleImports.id, importId), eq(scheduleImports.groupId, user.groupId)));
      await tx.update(weeks).set({ updatedAt: new Date() }).where(eq(weeks.id, weekId));
    });
    revalidatePath("/s", "layout");
    revalidatePath(`/admin/schedule/${weekId}`);
    revalidatePath("/admin/schedule");
    if (learn.size) revalidatePath("/admin/subjects");
    const learned = [...learn.values()].reduce((n, a) => n + a.length, 0);
    return ok({ count: parsed.data.length - skipped, skipped, learned });
  });
}
