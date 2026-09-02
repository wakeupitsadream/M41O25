import Link from "next/link";
import { CheckCircle2, ChevronRight, Plus } from "lucide-react";
import { hasRole, requireUser } from "@/lib/auth";
import { listTasks } from "@/lib/group/query";
import { dueLabel } from "@/lib/hw/format";
import { todayIso } from "@/lib/tz";
import { EmptyState, Badge } from "@/components/ui/primitives";
import { SubHeader } from "@/components/group/sub-header";
import { cn } from "@/lib/utils";

export const metadata = { title: "Задачи" };
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const user = await requireUser();
  const { items, total } = await listTasks(user.groupId);
  const canPost = hasRole(user, "moderator");
  const today = todayIso();
  const open = items.filter((t) => !t.closed);
  const closed = items.filter((t) => t.closed);

  return (
    <>
      <SubHeader
        title="Задачи"
        subtitle="сдать деньги, принести справку"
        right={
          canPost ? (
            <Link href="/group/tasks/new" className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink active:bg-accent-press">
              <Plus className="size-4" /> Задача
            </Link>
          ) : undefined
        }
      />
      <div className="space-y-3 px-5">
        {items.length === 0 && <EmptyState emoji="✅" title="Долгов нет" text="Когда староста заведёт сбор или задачу — здесь будет видно, кто уже сдал." />}
        {open.map((t) => <TaskRow key={t.id} t={t} total={total} today={today} />)}
        {closed.length > 0 && (
          <>
            <div className="pt-3 text-[12px] font-semibold uppercase tracking-wide text-dim">Закрытые</div>
            {closed.map((t) => <TaskRow key={t.id} t={t} total={total} today={today} />)}
          </>
        )}
      </div>
    </>
  );
}

function TaskRow({ t, total, today }: { t: Awaited<ReturnType<typeof listTasks>>["items"][number]; total: number; today: string }) {
  const pct = total ? Math.round((t.checked / total) * 100) : 0;
  const due = t.dueDate ? dueLabel(t.dueDate, today) : null;
  return (
    <Link href={`/group/tasks/${t.id}`} className={cn("block rounded-lg bg-surface p-4 hairline active:bg-surface-2", t.closed && "opacity-60")}>
      <div className="flex items-center gap-2">
        {t.closed && <CheckCircle2 className="size-4 text-ok" />}
        <span className="flex-1 font-display text-[16px] font-bold leading-snug">{t.title}</span>
        {due && !t.closed && <Badge tone={due.tone}>{due.text}</Badge>}
        <ChevronRight className="size-4 text-dim" />
      </div>
      {t.description && <p className="mt-1.5 line-clamp-2 text-[14px] text-muted">{t.description}</p>}
      {t.trackChecks && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[12px] text-muted tnum">
            <span>
              сдали {t.checked} из {total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </Link>
  );
}
