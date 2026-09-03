import Link from "next/link";
import { notFound } from "next/navigation";
import { asUuid } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";
import { hasRole, requireUser } from "@/lib/auth";
import { duplicateCandidates, getHomework } from "@/lib/hw/query";
import { todayIso } from "@/lib/tz";
import { HwDetail } from "@/components/hw/hw-detail";

export const metadata = { title: "Домашка" };
export const dynamic = "force-dynamic";

export default async function HomeworkDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = asUuid((await params).id);
  if (!id) notFound();
  const hw = await getHomework(user.groupId, id, user.id);
  if (!hw) notFound();
  const [candidates, subjectList] = await Promise.all([
    hw.duplicateOfId ? Promise.resolve([]) : duplicateCandidates(user.groupId, hw.id, hw.subjectId),
    db.select({ id: subjects.id, name: subjects.name, shortName: subjects.shortName, color: subjects.color }).from(subjects).where(and(eq(subjects.groupId, user.groupId), eq(subjects.archived, false))).orderBy(asc(subjects.name)),
  ]);
  const isAdmin = hasRole(user, "admin");

  return (
    <div className="px-5">
      <header className="flex items-center gap-2 pt-safe pb-2">
        <Link href="/hw" className="-ml-2 flex h-10 items-center gap-1 rounded-full pl-2 pr-3.5 text-[15px] font-medium text-muted active:bg-surface-2">
          <ChevronLeft className="size-5" /> Домашка
        </Link>
      </header>
      <HwDetail
        hw={{
          id: hw.id,
          title: hw.title,
          body: hw.body,
          dueDate: hw.dueDate,
          createdAt: hw.createdAt.toISOString(),
          subject: hw.subject,
          author: hw.author,
          done: hw.done,
          duplicateOfId: hw.duplicateOfId,
          duplicateMarkedBy: hw.duplicateMarkedBy,
          original: hw.original,
          duplicates: hw.duplicates,
          edits: hw.edits.map((e) => ({ id: e.id, text: e.text, createdAt: e.createdAt.toISOString(), author: e.author })),
          comments: hw.comments.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt.toISOString(), author: c.author })),
          attachments: hw.attachments,
          reactions: hw.reactions,
        }}
        me={{ id: user.id, isAdmin, showDone: user.showHwDone }}
        today={todayIso()}
        candidates={candidates}
        subjects={subjectList}
      />
    </div>
  );
}
