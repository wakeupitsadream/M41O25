import Link from "next/link";
import { Plus } from "lucide-react";
import { hasRole, requireUser } from "@/lib/auth";
import { listPolls } from "@/lib/group/query";
import { EmptyState } from "@/components/ui/primitives";
import { SubHeader } from "@/components/group/sub-header";
import { PollCard } from "@/components/group/poll-card";

export const metadata = { title: "Опросы" };
export const dynamic = "force-dynamic";

export default async function PollsPage() {
  const user = await requireUser();
  const items = await listPolls(user.groupId, user.id);
  const open = items.filter((p) => !p.closed);
  const closed = items.filter((p) => p.closed);

  return (
    <>
      <SubHeader
        title="Опросы"
        subtitle={open.length ? `${open.length} активных` : "решаем вместе"}
        right={
          <Link href="/group/polls/new" className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink active:bg-accent-press">
            <Plus className="size-4" /> Опрос
          </Link>
        }
      />
      <div className="space-y-3 px-5">
        {items.length === 0 && <EmptyState emoji="🗳️" title="Тишина" text="«Когда переносим пару?», «Куда идём после сессии?» — создай опрос, ответят за минуту." />}
        {open.map((p) => <PollCard key={p.id} poll={p} me={{ id: user.id, isMod: hasRole(user, "moderator"), isAdmin: hasRole(user, "admin") }} />)}
        {closed.length > 0 && (
          <>
            <div className="pt-3 text-[12px] font-semibold uppercase tracking-wide text-dim">Закрытые</div>
            {closed.map((p) => <PollCard key={p.id} poll={p} me={{ id: user.id, isMod: hasRole(user, "moderator"), isAdmin: hasRole(user, "admin") }} />)}
          </>
        )}
      </div>
    </>
  );
}
