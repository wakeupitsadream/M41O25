"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { lessons, scheduleImports, weeks } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/utils";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const validDate = (v: string) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const draftLesson = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(validDate, "Некорректная дата"),
  slot: z.number().int().min(1).max(10),
  startsAt: z.string().regex(hhmm, "Время начала"),
  endsAt: z.string().regex(hhmm, "Время конца"),
  title: z.string().trim().min(1).max(120),
  subjectId: z.string().uuid().nullable(),
  room: z.string().trim().max(40).nullable(),
  teacherName: z.string().trim().max(80).nullable(),
  kind: z.enum(["lecture", "practice", "lab", "exam", "credit", "consultation", "other"]),
});

/** Черновик распознавания → пары недели. Существующие пары недели заменяются (пользователь подтверждает в UI). */
export async function applyDraft(weekId: string, importId: string | null, items: z.infer<typeof draftLesson>[], replace: boolean): Promise<ActionResult<{ count: number }>> {
  try {
    const user = await actionUser("admin");
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
    await db.transaction(async (tx) => {
    if (replace) await tx.delete(lessons).where(eq(lessons.weekId, weekId));
    if (parsed.data.length) {
      await tx.insert(lessons).values(
        parsed.data.map((l) => ({
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
    if (importId) await tx.update(scheduleImports).set({ status: "applied" }).where(and(eq(scheduleImports.id, importId), eq(scheduleImports.groupId, user.groupId)));
    await tx.update(weeks).set({ updatedAt: new Date() }).where(eq(weeks.id, weekId));
    });
    revalidatePath("/s", "layout");
    revalidatePath(`/admin/schedule/${weekId}`);
    revalidatePath("/admin/schedule");
    return ok({ count: parsed.data.length });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Не удалось применить");
  }
}
