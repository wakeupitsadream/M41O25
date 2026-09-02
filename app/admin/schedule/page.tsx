import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { CalendarPlus, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { lessons, weeks } from "@/lib/db/schema";
import { requireRole } from "@/lib/auth";
import { mondayIso } from "@/lib/tz";
import { addDaysIso, fmtRangeShort } from "@/lib/schedule/time";
import { PARITY_LABEL } from "@/lib/schedule/types";
import { Badge } from "@/components/ui/primitives";
import { pluralRu } from "@/lib/utils";

export default async function AdminSchedule() {
  const user = await requireRole("admin");
  const rows = await db
    .select({
      week: weeks,
      lessonCount: sql<number>`(select count(*) from ${lessons} where ${lessons.weekId} = ${weeks.id} and ${lessons.isCancelled} = false)`.mapWith(Number),
    })
    .from(weeks)
    .where(eq(weeks.groupId, user.groupId))
    .orderBy(desc(weeks.startsOn));
  const thisMonday = mondayIso();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[28px] font-bold leading-none">Недели</h1>
        <Link href="/admin/schedule/new" className="flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink active:bg-accent-press">
          <CalendarPlus className="size-4" /> Новая
        </Link>
      </div>
      <ul className="space-y-2">
        {rows.map(({ week, lessonCount }) => (
          <li key={week.id}>
            <Link href={`/admin/schedule/${week.id}`} className="flex items-center gap-3 rounded-lg bg-surface p-4 hairline active:bg-surface-2">
              <div className="flex-1">
                <div className="flex items-center gap-2 font-display text-[16px] font-bold">
                  {fmtRangeShort(week.startsOn, addDaysIso(week.startsOn, 5))}
                  {week.startsOn === thisMonday && <Badge tone="accent">сейчас</Badge>}
                </div>
                <div className="mt-0.5 text-[13px] text-muted">
                  {week.parity ? `${PARITY_LABEL[week.parity]} · ` : ""}
                  {lessonCount} {pluralRu(lessonCount, "пара", "пары", "пар")}
                </div>
              </div>
              <Badge tone={week.status === "published" ? "ok" : "warn"}>{week.status === "published" ? "опубл." : "черновик"}</Badge>
              <ChevronRight className="size-4 text-dim" />
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="rounded-lg bg-surface p-6 text-center text-muted hairline">Недель ещё нет — создай первую.</li>}
      </ul>
    </div>
  );
}
