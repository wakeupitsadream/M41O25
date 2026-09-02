import Link from "next/link";
import { Plus } from "lucide-react";
import { hasRole, requireUser } from "@/lib/auth";
import { listNews } from "@/lib/group/query";
import { EmptyState } from "@/components/ui/primitives";
import { SubHeader } from "@/components/group/sub-header";
import { NewsCard } from "@/components/group/news-card";

export const metadata = { title: "Новости" };
export const dynamic = "force-dynamic";

export default async function NewsPage() {
  const user = await requireUser();
  const items = await listNews(user.groupId, user.id);
  const canPost = hasRole(user, "moderator");

  return (
    <>
      <SubHeader
        title="Новости"
        subtitle={`${items.length ? items.length : "пока нет"} ${items.length ? "записей" : ""}`}
        right={
          canPost ? (
            <Link href="/group/news/new" className="flex h-10 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-accent-ink active:bg-accent-press">
              <Plus className="size-4" /> Написать
            </Link>
          ) : undefined
        }
      />
      <div className="space-y-3 px-5">
        {items.length === 0 && <EmptyState emoji="📣" title="Тишина" text={canPost ? "Напиши первое объявление — оно появится здесь и в ленте «Что нового»." : "Объявления старосты появятся здесь."} />}
        {items.map((n) => (
          <NewsCard key={n.id} item={n} canManage={canPost} isAdmin={hasRole(user, "admin")} meId={user.id} />
        ))}
      </div>
    </>
  );
}
