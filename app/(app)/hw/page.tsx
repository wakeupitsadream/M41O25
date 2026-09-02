import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { Archive, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { subjects } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { listHomework } from "@/lib/hw/query";
import { dueHeading } from "@/lib/hw/format";
import { todayIso } from "@/lib/tz";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { HwCard } from "@/components/hw/hw-card";
import { cn } from "@/lib/utils";

export const metadata = { title: "Домашка" };
export const dynamic = "force-dynamic";

export default async function HomeworkPage({ searchParams }: { searchParams: Promise<{ archive?: string; subject?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const archive = sp.archive === "1";
  const subjectId = sp.subject ?? null;
  const today = todayIso();

  const [items, subjectList] = await Promise.all([
    listHomework(user.groupId, user.id, { archive, subjectId }),
    db.select().from(subjects).where(and(eq(subjects.groupId, user.groupId), eq(subjects.archived, false))).orderBy(asc(subjects.name)),
  ]);
  const visible = items.filter((i) => !i.duplicateOfId);

  const groups: { key: string; title: string; items: typeof visible }[] = [];
  for (const it of visible) {
    const last = groups[groups.length - 1];
    if (last && last.key === it.dueDate) last.items.push(it);
    else groups.push({ key: it.dueDate, title: archive ? it.dueDate.split("-").reverse().join(".") : dueHeading(it.dueDate, today), items: [it] });
  }

  const href = (params: { archive?: boolean; subject?: string | null }) => {
    const q = new URLSearchParams();
    if (params.archive ?? archive) q.set("archive", "1");
    const s = params.subject === undefined ? subjectId : params.subject;
    if (s) q.set("subject", s);
    const str = q.toString();
    return `/hw${str ? `?${str}` : ""}`;
  };

  return (
    <>
      <PageHeader
        title={archive ? "Архив" : "Домашка"}
        subtitle={archive ? "дедлайн прошёл" : `${visible.length ? `${visible.length} актуальных` : "всё сдано"}`}
        right={
          <Link
            href={href({ archive: !archive })}
            className={cn("grid size-10 place-items-center rounded-full hairline active:scale-95", archive ? "bg-fg text-bg" : "bg-surface-2 text-fg")}
            aria-label={archive ? "К актуальным" : "Архив"}
          >
            <Archive className="size-[18px]" />
          </Link>
        }
      />

      <div className="mb-4 flex gap-2 overflow-x-auto px-5 scrollbar-none">
        <Link href={href({ subject: null })} className={cn("shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold", !subjectId ? "bg-fg text-bg" : "bg-surface-2 text-muted hairline")}>
          Все
        </Link>
        {subjectList.map((s) => (
          <Link
            key={s.id}
            href={href({ subject: s.id === subjectId ? null : s.id })}
            className={cn("shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold transition", s.id === subjectId ? "text-bg" : "bg-surface-2 text-muted hairline")}
            style={s.id === subjectId ? { background: s.color ?? "#F4F4F6" } : undefined}
          >
            {s.shortName ?? s.name}
          </Link>
        ))}
      </div>

      <div className="space-y-6 px-5">
        {groups.length === 0 &&
          (archive ? (
            <EmptyState emoji="🗄️" title="Архив пуст" text="Сюда переезжают записи, у которых прошёл дедлайн." />
          ) : (
            <EmptyState
              emoji="🎉"
              title="ДЗ нет. Живём"
              text="Когда что-то зададут — нажми плюс и запиши за 20 секунд. Увидят все."
              action={
                <Link href="/hw/new" className="inline-flex h-12 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-accent-ink active:bg-accent-press">
                  <Plus className="size-4" /> Записать ДЗ
                </Link>
              }
            />
          ))}
        {groups.map((g) => (
          <section key={g.key} className="space-y-2.5">
            <h2 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">{g.title}</h2>
            {g.items.map((item, i) => (
              <HwCard key={item.id} item={item} today={today} showDone={user.showHwDone} index={i} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
