"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { groups, semesters, subjects, type SlotTime } from "@/lib/db/schema";
import { actionUser } from "@/lib/auth";
import { generateInviteSuffix, ok, type ActionResult } from "@/lib/utils";
import { invitePrefix } from "@/lib/invite";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ---------- Предметы ----------

const subjectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  shortName: z.string().trim().max(30).optional().or(z.literal("")),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  defaultTeacher: z.string().trim().max(80).optional().or(z.literal("")),
  defaultRoom: z.string().trim().max(40).optional().or(z.literal("")),
});

const readSubject = (fd: FormData) => ({
  name: fd.get("name"),
  shortName: fd.get("shortName") ?? "",
  color: fd.get("color") ?? "",
  defaultTeacher: fd.get("defaultTeacher") ?? "",
  defaultRoom: fd.get("defaultRoom") ?? "",
});

export async function createSubject(formData: FormData) {
  const admin = await actionUser("admin");
  const parsed = subjectSchema.safeParse(readSubject(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const d = parsed.data;
  await db.insert(subjects).values({
    groupId: admin.groupId,
    name: d.name,
    shortName: d.shortName || null,
    color: d.color || null,
    defaultTeacher: d.defaultTeacher || null,
    defaultRoom: d.defaultRoom || null,
  });
  revalidatePath("/admin/subjects");
  revalidatePath("/s", "layout");
}

export async function updateSubject(id: string, formData: FormData) {
  const admin = await actionUser("admin");
  const parsed = subjectSchema.safeParse(readSubject(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const d = parsed.data;
  await db
    .update(subjects)
    .set({ name: d.name, shortName: d.shortName || null, color: d.color || null, defaultTeacher: d.defaultTeacher || null, defaultRoom: d.defaultRoom || null })
    .where(and(eq(subjects.id, id), eq(subjects.groupId, admin.groupId)));
  revalidatePath("/admin/subjects");
  revalidatePath("/s", "layout");
  redirect("/admin/subjects");
}

export async function toggleSubjectArchived(id: string): Promise<ActionResult> {
  const admin = await actionUser("admin");
  const [s] = await db.select().from(subjects).where(and(eq(subjects.id, id), eq(subjects.groupId, admin.groupId)));
  if (s) await db.update(subjects).set({ archived: !s.archived }).where(eq(subjects.id, id));
  revalidatePath("/admin/subjects");
  return ok();
}

// ---------- Семестры ----------

const semesterSchema = z.object({
  title: z.string().trim().min(2).max(60),
  startsOn: iso,
  endsOn: iso,
  sessionStartsOn: iso.optional().or(z.literal("")),
});

const readSemester = (fd: FormData) => ({
  title: fd.get("title"),
  startsOn: fd.get("startsOn"),
  endsOn: fd.get("endsOn"),
  sessionStartsOn: fd.get("sessionStartsOn") ?? "",
});

export async function createSemester(formData: FormData) {
  const admin = await actionUser("admin");
  const parsed = semesterSchema.safeParse(readSemester(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const d = parsed.data;
  await db.insert(semesters).values({
    groupId: admin.groupId,
    title: d.title,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    sessionStartsOn: d.sessionStartsOn || null,
  });
  revalidatePath("/admin/semesters");
  revalidatePath("/s", "layout");
}

export async function updateSemester(id: string, formData: FormData) {
  const admin = await actionUser("admin");
  const parsed = semesterSchema.safeParse(readSemester(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  const d = parsed.data;
  await db
    .update(semesters)
    .set({ title: d.title, startsOn: d.startsOn, endsOn: d.endsOn, sessionStartsOn: d.sessionStartsOn || null })
    .where(and(eq(semesters.id, id), eq(semesters.groupId, admin.groupId)));
  revalidatePath("/admin/semesters");
  revalidatePath("/s", "layout");
}

export async function deleteSemester(id: string): Promise<ActionResult> {
  const admin = await actionUser("admin");
  await db.delete(semesters).where(and(eq(semesters.id, id), eq(semesters.groupId, admin.groupId)));
  revalidatePath("/admin/semesters");
  revalidatePath("/s", "layout");
  return ok();
}

// ---------- Настройки группы ----------

export async function rotateInviteCode(): Promise<ActionResult<{ code: string }>> {
  const admin = await actionUser("admin");
  const code = `${invitePrefix(admin.group.shortName)}-${generateInviteSuffix()}`;
  await db.update(groups).set({ inviteCode: code }).where(eq(groups.id, admin.groupId));
  revalidatePath("/admin/settings");
  revalidatePath("/admin");
  return ok({ code });
}

export async function updateSlotTimes(formData: FormData) {
  const admin = await actionUser("admin");
  const rows: SlotTime[] = [];
  for (let slot = 1; slot <= 8; slot++) {
    const start = String(formData.get(`start${slot}`) ?? "").trim();
    const end = String(formData.get(`end${slot}`) ?? "").trim();
    if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) rows.push({ slot, start, end });
  }
  if (rows.length === 0) throw new Error("Нужна хотя бы одна пара");
  await db.update(groups).set({ slotTimes: rows }).where(eq(groups.id, admin.groupId));
  revalidatePath("/admin/settings");
  revalidatePath("/s", "layout");
}

export async function updateGroupName(formData: FormData) {
  const admin = await actionUser("admin");
  const name = String(formData.get("name") ?? "").trim();
  const shortName = String(formData.get("shortName") ?? "").trim();
  if (shortName.length < 2) throw new Error("Слишком короткий шифр группы");
  await db.update(groups).set({ name: name || `Группа ${shortName}`, shortName }).where(eq(groups.id, admin.groupId));
  revalidatePath("/admin/settings");
}
