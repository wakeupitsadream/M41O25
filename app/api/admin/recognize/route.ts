import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { attachments, groups, scheduleImports, subjects, weeks } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { storage } from "@/lib/storage";
import { recognizeSchedule } from "@/lib/ocr/recognize";
import { toDraft } from "@/lib/ocr/draft";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  weekId: z.string().uuid(),
  attachmentIds: z.array(z.string().uuid()).min(1).max(4),
  strong: z.boolean().optional(),
});

/** Скан → PolzaAI → черновик пар недели. Файлы берём из хранилища по id (тела запроса не таскаем). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "Только админ" }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Неверный запрос" }, { status: 400 });
  const { weekId, attachmentIds, strong } = parsed.data;

  const [week] = await db.select().from(weeks).where(and(eq(weeks.id, weekId), eq(weeks.groupId, user.groupId)));
  if (!week) return NextResponse.json({ error: "Неделя не найдена" }, { status: 404 });
  const [group] = await db.select().from(groups).where(eq(groups.id, user.groupId));
  const files = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.id, attachmentIds), eq(attachments.groupId, user.groupId), eq(attachments.entityType, "scan")));
  if (files.length === 0) return NextResponse.json({ error: "Сканы не найдены" }, { status: 400 });

  const images: { dataUrl: string }[] = [];
  for (const f of files) {
    const obj = await storage.get(f.fileKey);
    if (!obj) continue;
    images.push({ dataUrl: `data:${obj.contentType};base64,${obj.body.toString("base64")}` });
  }
  if (images.length === 0) return NextResponse.json({ error: "Файлы сканов недоступны" }, { status: 400 });

  const [imp] = await db
    .insert(scheduleImports)
    .values({ groupId: user.groupId, weekId, scanKeys: files.map((f) => f.fileKey), status: "uploaded" })
    .returning({ id: scheduleImports.id });

  try {
    const { result, model, attempts } = await recognizeSchedule({ images, groupShort: group.shortName, slotTimes: group.slotTimes, strong });
    const subjectList = await db
      .select({ id: subjects.id, name: subjects.name, shortName: subjects.shortName })
      .from(subjects)
      .where(and(eq(subjects.groupId, user.groupId), eq(subjects.archived, false)))
      .orderBy(asc(subjects.name));
    const draft = toDraft(result, week.startsOn, week.parity, group.slotTimes, subjectList);
    await db.update(scheduleImports).set({ status: "recognized", model, rawJson: result }).where(eq(scheduleImports.id, imp.id));
    await db.update(attachments).set({ entityId: imp.id }).where(inArray(attachments.id, files.map((f) => f.id)));
    return NextResponse.json({
      importId: imp.id,
      model,
      attempts,
      groupFound: result.group_found,
      weekType: result.week_type,
      notes: result.confidence_notes,
      draft,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Распознавание не удалось";
    await db.update(scheduleImports).set({ status: "failed", error: message }).where(eq(scheduleImports.id, imp.id));
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
