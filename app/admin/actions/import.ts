"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { lessons, scheduleImports, weeks } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/utils";

const draftLesson = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.number().int().min(1).max(10),
  startsAt: z.string().regex(/^\d{2}:\d{2}$/),
  endsAt: z.string().regex(/^\d{2}:\d{2}$/),
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
    if (!parsed.success) return fail("В черновике есть некорректные пары — поправь подсвеченные");
    const [week] = await db.select().from(weeks).where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
    if (!week) return fail("Неделя не найдена");

    if (replace) await db.delete(lessons).where(eq(lessons.weekId, weekId));
    if (parsed.data.length) {
      await db.insert(lessons).values(
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
    if (importId) await db.update(scheduleImports).set({ status: "applied" }).where(and(eq(scheduleImports.id, importId), eq(scheduleImports.groupId, user.groupId)));
    await db.update(weeks).set({ updatedAt: new Date() }).where(eq(weeks.id, weekId));
    revalidatePath("/s", "layout");
    revalidatePath(`/admin/schedule/${weekId}`);
    revalidatePath("/admin/schedule");
    return ok({ count: parsed.data.length });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Не удалось применить");
  }
}
