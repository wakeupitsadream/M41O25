import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { quickAddContext } from "@/lib/hw/query";
import { hmToMinutes, nowHm, todayIso } from "@/lib/tz";
import { QuickAddForm } from "@/components/hw/quick-add-form";

export const metadata = { title: "Новое ДЗ" };
export const dynamic = "force-dynamic";

export default async function NewHomeworkPage() {
  const user = await requireUser();
  const today = todayIso();
  const [subjectList, ctx] = await Promise.all([
    db.select({ id: subjects.id, name: subjects.name, shortName: subjects.shortName, color: subjects.color }).from(subjects).where(and(eq(subjects.groupId, user.groupId), eq(subjects.archived, false))).orderBy(asc(subjects.name)),
    quickAddContext(user.groupId, today, hmToMinutes(nowHm())),
  ]);

  return (
    <div className="px-5">
      <header className="flex items-center gap-2 pt-safe pb-3">
        <Link href="/hw" className="-ml-2 flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-[15px] font-medium text-muted active:bg-surface-2">
          <ChevronLeft className="size-5" /> Домашка
        </Link>
      </header>
      <h1 className="mb-1 font-display text-[28px] font-bold leading-none">Что задали?</h1>
      <p className="mb-5 text-[14px] text-muted">Запись увидит вся группа. Предмет и дедлайн уже подставлены по расписанию — поправь, если не так.</p>
      <QuickAddForm subjects={subjectList} suggestedSubjectId={ctx.currentSubjectId} upcomingBySubject={ctx.upcomingBySubject} today={today} />
    </div>
  );
}
